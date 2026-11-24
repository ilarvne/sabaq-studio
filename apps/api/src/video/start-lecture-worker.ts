import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { defaultDatabase } from '../runtime-paths';
import { elevenLabsVoice } from './elevenlabs';
import { createHostedLectureWorker } from './hosted-lecture-worker';

export async function startBundledLectureWorker() {
  if (process.env.STUDIO_AUTH_MODE === 'gateway' || process.env.STUDIO_VIDEO_LOCAL_WORKER !== '1' || process.env.STUDIO_VIDEO_WORKER_URL?.trim()) return;

  const key = process.env.STUDIO_VIDEO_WORKER_KEY?.trim() || randomBytes(32).toString('hex');
  const version = process.env.STUDIO_VIDEO_PIPELINE_VERSION?.trim() || 'lecture-v2-timed-captions';
  const embedder = process.env.STUDIO_VIDEO_MARK_EMBEDDER?.trim();
  const signingManifest = process.env.STUDIO_VIDEO_SIGNING_MANIFEST?.trim();
  const detector = process.env.STUDIO_VIDEO_MARK_VERIFIER?.trim();
  const anchors = process.env.STUDIO_VIDEO_C2PA_ANCHORS?.trim();
  const c2pa = process.env.STUDIO_VIDEO_C2PATOOL?.trim();
  const port = Number(process.env.STUDIO_VIDEO_WORKER_PORT || 9700);
  if (!embedder || !signingManifest || !detector || !anchors || !c2pa ||
    ![embedder, signingManifest, detector, anchors, c2pa].every(isAbsolute) || !elevenLabsVoice() ||
    !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Set ElevenLabs and absolute marking, verification, and C2PA paths.');
  }
  await Promise.all([
    access(embedder, constants.X_OK), access(detector, constants.X_OK), access(c2pa, constants.X_OK),
    access(signingManifest, constants.R_OK), access(anchors, constants.R_OK),
  ]);
  const db = resolve(process.env.STUDIO_DB_PATH || defaultDatabase);
  const directory = process.env.STUDIO_VIDEO_WORKER_STORAGE ? resolve(process.env.STUDIO_VIDEO_WORKER_STORAGE)
    : resolve(dirname(db), 'lecture-worker');
  const worker = createHostedLectureWorker({ key, version, directory, embedder, signingManifest, c2pa });
  try {
    process.env.STUDIO_VIDEO_WORKER_URL = await worker.listen({ host: '127.0.0.1', port });
    process.env.STUDIO_VIDEO_WORKER_KEY = key;
    process.env.STUDIO_VIDEO_PIPELINE_VERSION = version;
    process.env.STUDIO_VIDEO_REGION ||= 'global';
    return worker;
  } catch (error) {
    await worker.close();
    throw error;
  }
}
