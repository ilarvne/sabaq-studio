import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sourceFileFormats } from '@sabaq/contracts/source-files';
import { z } from 'zod';
import type { StudioAccess } from '../access/access';
import { ApiError } from '../errors';
import { canRecognizeImage } from './alem-media';
import { registerDictation } from './dictation';
import { extractScan, sourceImageLimit } from './source-ocr';
import { maxSourceText, type SourceLibrary } from './source-library';

const maxBytes = 20_000_000;
const docxReader = fileURLToPath(new URL('./extract_docx.py', import.meta.url));
const uploadQuery = z.object({name:z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f/\\]+$/u),ocr:z.literal('alem').optional()});
const supportedFormat = z.enum(sourceFileFormats);

function extract(format: 'pdf' | 'docx', bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdf = format === 'pdf';
    const child = execFile(pdf ? 'pdftotext' : 'python3', pdf
      ? ['-enc', 'UTF-8', '-nopgbrk', '-', '-'] : ['-I', docxReader], {
      timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: maxSourceText * 4 + 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout.replace(/\r\n?/g, '\n').trim());
    });
    child.stdin?.on('error', () => { /* execFile reports process errors in its callback. */ });
    child.stdin?.end(bytes);
  });
}

type Upload = { Params: { format: string }; Body: Buffer; Querystring: { ocr?: string } };
type File = { Params: { id: string } };
type Extraction = {text:string} | {status:number;error:string};
const failure = (status: number, error: string) => ({status,error});

export async function sourceRoutes(app: FastifyInstance, {library,access}: {library:SourceLibrary;access:StudioAccess}) {
  let active = 0;
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  registerDictation(app);

  async function read(format: string, bytes: Buffer, allowOcr: boolean, reply: FastifyReply, textFiles = false): Promise<Extraction> {
    if (!Buffer.isBuffer(bytes)) return failure(415,'unsupported');
    if (textFiles && (format === 'txt' || format === 'md')) {
      try {
        const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
        if (!text || text.includes('\0')) return failure(422,'unreadable');
        if (text.length > maxSourceText) return failure(413,'limit');
        return {text};
      } catch { return failure(422,'unreadable'); }
    }
    const image = format === 'jpg' || format === 'jpeg' || format === 'png';
    const scan = canRecognizeImage();
    if (format !== 'pdf' && format !== 'docx' && (!image || !scan)) return failure(415,'unsupported');
    if (image && bytes.length > sourceImageLimit) return failure(413,'limit');
    if (image && !allowOcr) return failure(422,'scan');
    if ((format === 'pdf' && !bytes.subarray(0, 1024).includes('%PDF-')) ||
        (format === 'docx' && !bytes.subarray(0, 2).equals(Buffer.from('PK')))) {
      return failure(422,'unreadable');
    }
    if (active >= 2) return failure(429,'busy');
    active++;
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    reply.raw.once('close', disconnect);
    try {
      let text = format === 'pdf' || format === 'docx' ? await extract(format, bytes) : '';
      if (!text && scan && (format === 'pdf' || image)) {
        if (!allowOcr) return failure(422,'scan');
        const deadline = AbortSignal.any([abort.signal, AbortSignal.timeout(145_000)]);
        text = (await extractScan(format, bytes, deadline)).replace(/\r\n?/g, '\n').trim();
      }
      if (!text || text.includes('\0')) return failure(422,'unreadable');
      if (text.length > maxSourceText) return failure(413,'limit');
      return { text };
    } catch (error) {
      const code = (error as { code?: string | number }).code;
      if (error instanceof ApiError && error.status >= 500) return failure(error.status,'unavailable');
      if (code === 'ENOENT') return failure(503,'unavailable');
      if ((error instanceof ApiError && error.status === 413) || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || (format === 'docx' && code === 3)) {
        return failure(413,'limit');
      }
      return failure(422,'unreadable');
    } finally {
      reply.raw.off('close', disconnect);
      active--;
    }
  }

  app.post<Upload>('/api/sources/extract/:format', { bodyLimit: maxBytes }, async (req, reply) => {
    const result = await read(req.params.format, req.body, req.query.ocr === 'alem', reply);
    return 'error' in result ? reply.code(result.status).send({error:result.error}) : result;
  });
  app.get('/api/source-files', async req => library.list(access.principal(req)));
  app.get<File>('/api/source-files/:id', async req => library.details(req.params.id,access.principal(req)));
  app.post<Upload>('/api/source-files/:format', {bodyLimit:maxBytes}, async (req,reply) => {
    const format = supportedFormat.safeParse(req.params.format);
    if (!format.success || !Buffer.isBuffer(req.body)) return reply.code(415).send({error:'unsupported'});
    const {name,ocr} = uploadQuery.parse(req.query);
    const principal = access.principal(req);
    const present = library.findUpload(name, format.data, req.body, principal);
    if (present) return present;
    const result = await read(format.data, req.body, ocr === 'alem', reply, true);
    if ('error' in result) return reply.code(result.status).send({error:result.error});
    return reply.code(201).send(library.save(name, format.data, req.body, result.text, principal));
  });
  app.get<File>('/api/source-files/:id/download', async (req,reply) => {
    const file = library.original(req.params.id,access.principal(req));
    const name = encodeURIComponent(file.name.toWellFormed()).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
    return reply.type('application/octet-stream').header('X-Content-Type-Options','nosniff')
      .header('Content-Disposition', "attachment; filename*=UTF-8''"+name).send(Buffer.from(file.original));
  });
  app.delete<File>('/api/source-files/:id', async (req,reply) => {
    library.delete(req.params.id,access.principal(req));
    return reply.code(204).send();
  });
}
