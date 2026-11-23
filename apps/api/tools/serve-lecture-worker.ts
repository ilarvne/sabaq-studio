import { resolve, isAbsolute } from 'node:path';
import { createHostedLectureWorker } from '../src/video/hosted-lecture-worker';
import { elevenLabsVoice } from '../src/video/elevenlabs';

const key = process.env.STUDIO_VIDEO_WORKER_KEY?.trim();
const version = process.env.STUDIO_VIDEO_PIPELINE_VERSION?.trim();
const embedder = process.env.STUDIO_VIDEO_MARK_EMBEDDER?.trim();
const signingManifest = process.env.STUDIO_VIDEO_SIGNING_MANIFEST?.trim();
const c2pa = process.env.STUDIO_VIDEO_C2PATOOL?.trim() || 'c2patool';
const port = Number(process.env.STUDIO_VIDEO_WORKER_PORT ?? '9700');
if (!key || key.length < 32 || !version || !embedder || !isAbsolute(embedder) || !signingManifest || !isAbsolute(signingManifest) ||
    !elevenLabsVoice() || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Configure the lecture worker key, pipeline version, watermark embedder, signing manifest, and ElevenLabs narration.');
}
const worker = createHostedLectureWorker({ key, version, embedder, signingManifest, c2pa,
  directory: resolve(process.env.STUDIO_VIDEO_WORKER_STORAGE || '.data/lecture-worker') });
const address = await worker.listen({ host: '127.0.0.1', port });
console.log(`Lecture worker listening at ${address}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void worker.close(); });
