import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ApiError } from '../errors';
import { recognizeImage } from './alem-media';
import { convert } from './page-import';

export const sourceImageLimit = 10_000_000;
const maxScanPages = 8;

async function ocrPage(job: string, filename: string, jpeg: Buffer, signal: AbortSignal) {
  signal.throwIfAborted();
  try {
    return (await recognizeImage(jpeg, signal)).trim();
  } catch {
    signal.throwIfAborted();
    try {
      return (await convert(job, 'tesseract', [filename, 'stdout', '-l', 'eng+kaz+rus'])).trim();
    } catch {
      throw new ApiError(502, 'The OCR provider is temporarily unavailable.');
    }
  }
}

export async function extractScan(format: 'pdf' | 'png' | 'jpg' | 'jpeg', bytes: Buffer, signal: AbortSignal) {
  const job = await mkdtemp(join(tmpdir(), 'sabaq-ocr-'));
  try {
    if (format !== 'pdf') {
      const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' });
      if ((await image.metadata()).format !== (format === 'png' ? 'png' : 'jpeg')) throw new ApiError(422, 'Unreadable image.');
      const jpeg = await image.rotate().resize({ width: 2250, height: 2250, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: 'white' }).jpeg({ quality: 92 }).toBuffer();
      await writeFile(join(job, 'page.jpg'), jpeg, { mode: 0o600 });
      return await ocrPage(job, 'page.jpg', jpeg, signal);
    }
    await writeFile(join(job, 'source.pdf'), bytes, { mode: 0o600 });
    const info = await convert(job, 'pdfinfo', ['source.pdf']);
    const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1]);
    if (!Number.isInteger(pages) || pages < 1) throw new ApiError(422, 'Unreadable PDF.');
    if (pages > maxScanPages) throw new ApiError(413, 'Scanned PDFs can have up to eight pages.');
    await convert(job, 'pdftocairo', ['-jpeg', '-jpegopt', 'quality=92', '-scale-to', '2250', '-f', '1', '-l', String(pages), 'source.pdf', 'page']);
    const recognized: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const filename = `page-${page}.jpg`;
      recognized.push(await ocrPage(job, filename, await readFile(join(job, filename)), signal));
    }
    return recognized.filter(Boolean).join('\n\n');
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}
