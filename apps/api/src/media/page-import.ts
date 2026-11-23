import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import type { StudioStore } from '../persistence/storage';
import { ApiError } from '../errors';
import { extractEditablePptx } from './pptx-import';

const limit = 40;
const imageFormats = ['png', 'jpg', 'jpeg', 'webp'];

// Limit each converter to installed system files, its job directory and a private network namespace.
export async function convert(job: string, command: string, args: string[]) {
  return new Promise<string>((accept, reject) => {
    execFile('bwrap', [
      '--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
      '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/bin', '/bin',
      '--dir', '/etc', '--ro-bind-try', '/etc/fonts', '/etc/fonts', '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
      '--size', '268435456', '--tmpfs', '/tmp', '--dev', '/dev', '--proc', '/proc', '--bind', job, '/job', '--chdir', '/job',
      '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
      '--setenv', 'SAL_USE_VCLPLUGIN', 'svp', '--setenv', 'OMP_NUM_THREADS', '2',
      '/usr/bin/prlimit', '--as=3221225472', '--cpu=45', '--fsize=100000000', '--nofile=256', '--core=0',
      '--', command, ...args,
    ], { timeout: 50_000, maxBuffer: 100_000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      if (!error) return accept(stdout);
      const missing = error.code === 'ENOENT' || /failed to execute|No such file or directory|Creating new namespace failed|Operation not permitted/i.test(stderr);
      reject(new ApiError(missing ? 503 : 422, missing ? 'The isolated slide importer is unavailable.' : 'This file could not be read.'));
    });
  });
}

export async function importPages(bytes: Buffer, format: string, title: string, language: Locale, mediaRoot: string, store: StudioStore, owner?: { org: string; subject: string }, creationId?:string, mode: 'image' | 'editable' = 'image') {
  const hash=creationId && store.usage.fingerprint([
    format,title,language,createHash('sha256').update(bytes).digest('hex'),...(mode === 'editable' ? [mode] : []),
  ]);
  function replay() {
    const previous=creationId && store.usage.previous(creationId,owner);
    if(!previous) return;
    if(previous.hash!==hash) throw new ApiError(409,'This creation request already produced another lesson.');
    return store.get<Deck>('decks',previous.deck);
  }
  const existing=replay();
  if(existing) return existing;
  const image = imageFormats.includes(format);
  if (mode === 'editable' && format !== 'pptx') throw new ApiError(415, 'Editable import requires a PPTX file.');
  if (!image && format !== 'pdf' && format !== 'pptx') throw new ApiError(415, 'Choose PPTX, PDF or an image.');
  if (!bytes.length || bytes.length > (image ? 10_000_000 : 20_000_000)) throw new ApiError(413, 'File size exceeds the import limit.');
  if ((format === 'pdf' && !bytes.subarray(0, 1024).includes('%PDF-')) || (format === 'pptx' && !bytes.subarray(0, 2).equals(Buffer.from('PK')))) {
    throw new ApiError(422, 'File contents do not match the format.');
  }
  const job = await mkdtemp(join(tmpdir(), 'sabaq-pages-'));
  const saved: string[] = [];
  try {
    const input = 'source.' + format;
    await writeFile(join(job, input), bytes, { mode: 0o600 });
    const editable = mode === 'editable' ? await extractEditablePptx(job,convert) : undefined;
    let pages = editable?.length ?? 1;
    if (image) {
      const coder = format === 'jpg' || format === 'jpeg' ? 'JPEG' : format.toUpperCase();
      await convert(job, 'magick', ['-limit', 'memory', '96MiB', '-limit', 'disk', '96MiB', '-limit', 'area', '16MP',
        coder + ':' + input + '[0]', '-auto-orient', '-resize', '1920x1080', 'PNG24:page-1.png']);
    } else if (!editable || editable.some(slide => !slide.editable || slide.slide.freeLayout)) {
      if (format === 'pptx') {
        if (!editable) await convert(job, 'python3', ['-I', '-c', [
          'import sys, zipfile',
          'with zipfile.ZipFile("source.pptx") as package:',
          '    members = package.infolist()',
          '    valid = len(members) <= 4096 and "ppt/presentation.xml" in package.namelist()',
          '    valid = valid and sum(entry.file_size for entry in members) <= 256_000_000',
          '    valid = valid and all(not entry.flag_bits & 1 for entry in members)',
          '    sys.exit(0 if valid else 2)',
        ].join('\n')]);
      }
      const renderPages = async (stem:string) => {
        if (format==='pptx') await convert(job, 'soffice', ['-env:UserInstallation=file:///tmp/lo', '--headless', '--norestore', '--nodefault',
          '--convert-to', 'pdf:impress_pdf_Export:{"PageRange":{"type":"string","value":"1-41"},"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
          '--outdir','/job',stem+'.pptx']);
        const pdf=stem+'.pdf';
        const info=await convert(job,'pdfinfo',[pdf]);
        const count=Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1]);
        if (!Number.isInteger(count) || count<1 || count>limit || (editable && count!==editable.length))
          throw new ApiError(422,'Import a file with 1–40 readable pages.');
        await convert(job,'pdftocairo',['-png','-scale-to','1920','-f','1','-l',String(count),pdf,'page']);
        return count;
      };
      const masked=editable?.flatMap((source,i)=>source.editable && source.slide.freeLayout ? [i] : []) ?? [];
      if(masked.length && editable) {
        try {
          await writeFile(join(job,'mask-pages.json'),JSON.stringify(masked),{mode:0o600});
          await convert(job,'python3',['-I','extract_pptx.py','--mask']);
          pages=await renderPages('masked');
        } catch {
          // Preserve source fidelity when a producer-specific package cannot be round-tripped through the mask.
          for(const i of masked) editable[i]={editable:false,notes:editable[i].notes};
          pages=await renderPages('source');
        }
      } else pages=await renderPages('source');
    }

    await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    async function saveImage(bytes: Buffer) {
      const name = randomBytes(32).toString('hex') + '.png';
      const location = join(mediaRoot,name);
      const file = await open(location,'wx',0o600);
      saved.push(location);
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
      return '/api/media/' + name;
    }
    const pageRaster = async (i:number) => {
      const path=join(job,'page-'+String(i).padStart(String(pages).length,'0')+'.png');
      const raster=sharp(path,{limitInputPixels:4_000_000});
      const {width,height}=await raster.metadata();
      const bytes=await raster.resize(1920,1080,{fit:'contain',background:'white'}).flatten({background:'white'}).png().toBuffer();
      return {bytes,aspect:width!/height!};
    };
    const slides: Slide[] = [];
    for (let i = 1; i <= pages; i++) {
      const base = {id:randomUUID(),status:'ready' as const,lessonPart:'lesson',version:0};
      const caption = title + ' · ' + i;
      const source = editable?.[i-1];
      if (source?.editable) {
        const picture = source.picture && {
          src:await saveImage(await readFile(source.picture.path)),alt:source.picture.alt,provenance:{source:'upload' as const},
        };
        const importedArtwork=source.slide.freeLayout ? await saveImage((await pageRaster(i)).bytes) : undefined;
        slides.push({...base,...source.slide,title:source.slide.title || caption,...(picture && {image:picture}),...(importedArtwork && {importedArtwork})});
        continue;
      }
      const raster=await pageRaster(i);
      slides.push({...base,layout:'image-full',importedPage:true,importedPageAspect:raster.aspect,title:caption,notes:source?.notes ?? '',body:'',
        image:{src:await saveImage(raster.bytes),alt:caption}});
    }
    const deck: Deck = {
      id: randomUUID(), title, topic: title, language, theme: 'notebook', brand:store.organizationBrand(owner?.org), provider: 'fixture', revision: 0,
      phase: 'editing', outlineStatus: 'complete', updatedAt: new Date().toISOString(), slides,
      outline: slides.map(({ id, title, layout, body }) => ({ id, title, layout, summary:body })),
    };
    const selected=store.transaction(() => {
      const previous=replay();
      if(previous) return previous;
      store.saveRevision(deck,editable ? 'Imported editable PowerPoint' : 'Imported slide images');
      if (owner) store.db.prepare('INSERT INTO deck_owners(deck_id,org,subject) VALUES(?,?,?)').run(deck.id, owner.org, owner.subject);
      store.usage.attach(deck,owner,creationId,hash);
      return deck;
    });
    if(selected.id!==deck.id) await Promise.all(saved.map(file=>rm(file,{force:true})));
    return selected;
  } catch (error) {
    await Promise.all(saved.map(file => rm(file, { force: true })));
    throw error;
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}
