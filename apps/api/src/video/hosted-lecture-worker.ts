import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { videoFrame } from '@sabaq/contracts/video';
import { z } from 'zod';
import { ApiError } from '../errors';
import { assembleAvatarScenes, composeAvatarScene, markAndSign, probeLocalDuration, runOfflineMedia } from './avatar-composition';
import { elevenLabsVoice, synthesizeElevenLabs, synthesizeTimedElevenLabs } from './elevenlabs';
import { speechChunks, subtitleCues, subtitleSrt, type SubtitleCue } from './subtitles';
import { videoWatermarkId } from './video-verification';

const id = z.string().regex(/^[a-f0-9]{64}$/);
const locale = z.enum(['kk', 'ru', 'en']);
const base = z.object({ label: z.literal('ИИ'), pipelineVersion: z.string() });
const scene = base.extend({
  imagePng: z.base64().max(14_000_000), narration: z.string().max(60_000),
  sourceLanguage: locale, language: locale, captions: z.boolean(),
  position: z.literal('none'), aspect: z.enum(['16:9', '9:16', '1:1']),
  avatarId: z.null().optional(), subjectRef: z.undefined().optional(),
  quiz: z.object({ pauseSeconds: z.literal(4) }).optional(),
});
const assembly = base.extend({ sceneIds: z.array(id).min(1).max(480), watermarkId: videoWatermarkId, subjectRef: z.undefined().optional() });
const digest = (value: string) => createHash('sha256').update(value).digest();

async function makeSpeech(data: z.infer<typeof scene>, voice: NonNullable<ReturnType<typeof elevenLabsVoice>>, work: string, signal: AbortSignal) {
  const chunks = speechChunks(data.narration);
  const cues: SubtitleCue[] = [];
  const partNames: string[] = [];
  let duration = 0;
  if (!chunks.length) {
    const narration = join(work, 'silence.wav');
    await runOfflineMedia('Silent scene', 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '3', narration], signal);
    return { narration, duration: 3, cues, cleanup: [narration] };
  }
  for (const [index, text] of chunks.entries()) {
    const options = { ...voice, text, language: data.language, signal };
    const speech = data.captions ? await synthesizeTimedElevenLabs(options) : { audio: await synthesizeElevenLabs(options), alignment: undefined };
    const mp3 = join(work, `speech-${index}.mp3`);
    await writeFile(mp3, speech.audio, { mode: 0o600 });
    const partName = `part-${index}.wav`;
    const part = join(work, partName);
    await runOfflineMedia('Narration audio', 'ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', mp3,
      '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', part], signal);
    await rm(mp3);
    const length = await probeLocalDuration(part, signal);
    if (data.captions) {
      const lineLimit = data.aspect === '16:9' ? 42 : 34;
      cues.push(...subtitleCues(text, length, lineLimit, speech.alignment)
        .map(cue => ({ ...cue, start: cue.start + duration, end: cue.end + duration })));
    }
    duration += length;
    partNames.push(partName);
  }
  const parts = partNames.map(name => join(work, name));
  if (parts.length === 1) return { narration: parts[0], duration, cues, cleanup: parts };
  const list = join(work, 'speech.ffconcat');
  const narration = join(work, 'speech.wav');
  await writeFile(list, 'ffconcat version 1.0\n' + partNames.map(name => `file '${name}'\n`).join(''), { mode: 0o600 });
  await runOfflineMedia('Narration assembly', 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-protocol_whitelist', 'file', '-i', list, '-c:a', 'copy', narration], signal);
  return { narration, duration, cues, cleanup: [...parts, list, narration] };
}

export function createHostedLectureWorker(options: {
  key: string; version: string; directory: string; embedder: string; signingManifest: string; c2pa: string;
}) {
  const app = Fastify({ logger: false, bodyLimit: 15_000_000 });
  const authorization = digest(`Bearer ${options.key}`);
  const active = new Set<string>();
  app.addHook('onRequest', async req => {
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), authorization)) throw new ApiError(401, 'Worker authorization required.');
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.code(422).send({ error: 'Unsupported lecture worker input.' });
    console.error('Lecture worker:', error instanceof Error ? error.message : 'Processing failed.');
    return reply.code(500).send({ error: 'Lecture media generation failed.' });
  });

  async function artifact(req: FastifyRequest, reply: FastifyReply, kind: 'scenes'|'exports', cacheSignature: unknown, name: string,
    build: (work: string, result: string, signal: AbortSignal) => Promise<void>) {
    const key = id.parse(req.headers['idempotency-key']);
    const root = join(options.directory, kind);
    const destination = join(root, key);
    const signature = digest(JSON.stringify(cacheSignature)).toString('hex');
    const existing = await readFile(join(destination, 'signature'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing) {
      if (existing !== signature) throw new ApiError(409, 'The idempotency key already identifies another request.');
      return { key, file: join(destination, name) };
    }
    if (active.size) throw new ApiError(503, 'The lecture worker is busy.');
    active.add(key);
    const abort = new AbortController();
    const stop = () => { if (!reply.raw.writableFinished) abort.abort(); };
    reply.raw.once('close', stop);
    let work: string | undefined;
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      work = await mkdtemp(join(root, '.work-'));
      await build(work, join(work, name), abort.signal);
      abort.signal.throwIfAborted();
      await writeFile(join(work, 'signature'), signature, { mode: 0o600 });
      await rename(work, destination);
      work = undefined;
      return { key, file: join(destination, name) };
    } finally {
      if (work) await rm(work, { recursive: true, force: true });
      active.delete(key);
      reply.raw.off('close', stop);
    }
  }

  app.post('/scenes', async (req, reply) => {
    const data = scene.parse(req.body);
    if (data.pipelineVersion !== options.version) throw new ApiError(409, 'The video pipeline version changed.');
    if (data.sourceLanguage !== data.language) throw new ApiError(422, 'Create a translated lesson before exporting video in another language.');
    const voice = elevenLabsVoice();
    if (!voice) throw new ApiError(503, 'Configure ElevenLabs narration.');
    const { key } = await artifact(req, reply, 'scenes', [data, voice.voiceId], 'scene.mp4', async (work, output, signal) => {
      const frame = videoFrame(data);
      const image = Buffer.from(data.imagePng, 'base64');
      if (image.length < 33 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== frame.width || image.readUInt32BE(20) !== frame.height) {
        throw new ApiError(422, 'The scene must use the reserved video frame.');
      }
      const slide = join(work, 'slide.png');
      await writeFile(slide, image, { mode: 0o600 });
      const speech = await makeSpeech(data, voice, work, signal);
      const captionFile = speech.cues.length ? join(work, 'captions.srt') : undefined;
      if (captionFile) await writeFile(captionFile, subtitleSrt(speech.cues), { mode: 0o600 });
      await composeAvatarScene({ frame, slide, narration: speech.narration, captionFile, output,
        duration: speech.duration + (data.quiz?.pauseSeconds ?? 0) }, signal);
      await Promise.all([slide, ...speech.cleanup, ...(captionFile ? [captionFile] : [])].map(file => rm(file)));
    });
    return { sceneId: key };
  });

  app.post('/assemble', async (req, reply) => {
    const data = assembly.parse(req.body);
    if (data.pipelineVersion !== options.version) throw new ApiError(409, 'The video pipeline version changed.');
    const { file } = await artifact(req, reply, 'exports', data, 'signed.mp4', async (work, output, signal) => {
      const input = join(work, 'assembled.mp4');
      const files = data.sceneIds.map(key => join(options.directory, 'scenes', key, 'scene.mp4'));
      await assembleAvatarScenes(files, input, signal);
      await markAndSign({ ...options, workDirectory: work, watermarkId: data.watermarkId, input, output }, signal);
      await Promise.all([rm(input), rm(join(work, 'watermarked.mp4'))]);
    });
    return reply.type('video/mp4').header('Cache-Control', 'no-store').send(createReadStream(file));
  });
  return app;
}
