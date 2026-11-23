import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../errors';
import { canTranscribe, mediaCapabilities, mediaLanguage, transcribeSpeech } from './alem-media';
import { convert } from './page-import';

const formats = { ogg: 'ogg', webm: 'matroska', mp4: 'mov', wav: 'wav' };
const query = z.object({ format: z.enum(['ogg', 'webm', 'mp4', 'wav']) });
const params = z.object({ language: mediaLanguage });

export function registerDictation(app: FastifyInstance) {
  let active = 0;
  app.get('/api/media/capabilities', async () => mediaCapabilities());
  app.post<{ Body: Buffer }>('/api/media/transcriptions/:language', { bodyLimit: 4_000_000 }, async (req, reply) => {
    const { language } = params.parse(req.params);
    const { format } = query.parse(req.query);
    if (!canTranscribe(language)) throw new ApiError(503, 'Transcription is unavailable.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(422, 'Upload a recording.');
    if (active >= 2) throw new ApiError(429, 'Transcription is busy.');
    active++;
    const abort = new AbortController();
    const disconnect = () => abort.abort();
    reply.raw.once('close', disconnect);
    let job: string | undefined;
    try {
      job = await mkdtemp(join(tmpdir(), 'sabaq-dictation-'));
      await writeFile(join(job, 'input'), req.body, { mode: 0o600 });
      await convert(job, 'ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-f', formats[format], '-i', 'input',
        '-map', '0:a:0', '-t', '60', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'speech.wav',
      ]);
      const wav = await readFile(join(job, 'speech.wav'));
      let text: string;
      try {
        text = await transcribeSpeech(new Uint8Array(wav), language, abort.signal);
      } catch {
        throw new ApiError(502, 'Transcription is temporarily unavailable.');
      }
      return { text };
    } finally {
      reply.raw.off('close', disconnect);
      active--;
      if (job) await rm(job, { recursive: true, force: true });
    }
  });
}
