import { createHash, randomBytes, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, link, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { videoFrame, type VideoSettings } from '@sabaq/contracts/video';
import { spokenNarration } from '@sabaq/lesson/narration';
import type { Deck } from '@sabaq/lesson/types';
import { renderVideoSteps } from '../src/media/render-export';
import { catalogRoot, defaultDatabase } from '../src/runtime-paths';
import { composeAvatarScene, markAndSign, prepareAvatarInputs, probeLocalDuration, runMuseTalk, runOfflineMedia } from '../src/video/avatar-composition';
import { syncLipSync } from '../src/video/sync-lipsync';
import { digestFile, verifyVideo } from '../src/video/video-verification';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const pilotAuthorization = z.object({
  subjectRef: z.string().regex(/^[A-Za-z0-9_-]{12,160}$/), policy: z.string().min(1).max(160),
  use: z.literal('one-slide-avatar-pilot'), processor: z.enum(['sync-labs', 'local']), state: z.literal('active'),
  expiresAt: z.iso.datetime(), recordingSha256: sha256, narrationSha256: sha256, notesSha256: sha256,
}).strict();
const pilotInput = z.object({
  deck: z.string().min(1), slideId: z.string().min(1), recording: z.string().min(1),
  narration: z.string().min(1), captions: z.string().min(1),
  authorization: z.string().min(1), authorizationSignature: z.string().min(1),
  outputDirectory: z.string().min(1), mediaDirectory: z.string().min(1).optional(),
  position: z.enum(['left', 'right']).default('right'), processor: z.enum(['sync-labs', 'local']).default('sync-labs'),
}).strict();

function pathSetting(key: string) {
  const value = process.env[key]?.trim();
  if (!value || !isAbsolute(value)) throw new Error(`${key} must be an absolute path.`);
  return value;
}

function pilotError(message: string) { console.error(message); process.exitCode = 1; }

async function selectSlide(path: string, id: string) {
  const source = JSON.parse(await readFile(path, 'utf8')) as Deck;
  const slide = source.slides?.find(entry => entry.id === id);
  if (source.language !== 'kk' || slide?.status !== 'ready' || !slide.notes?.trim()) {
    throw new Error('Choose one ready Kazakh slide with speaker notes.');
  }
  return { deck: { ...source, slides: [slide] }, notes: spokenNarration(slide.notes.trim(), 'kk') };
}

async function renderPilotAvatar(input: {
  processor: 'local' | 'sync-labs'; recording: string; narration: string;
  workDirectory: string; outputDirectory: string; audioLength: number; exportId: string;
}, authorize: () => Promise<unknown>, signal: AbortSignal) {
  if (input.processor === 'local') return runMuseTalk({ ...input,
    checkout: pathSetting('STUDIO_MUSETALK_CHECKOUT'), python: pathSetting('STUDIO_MUSETALK_PYTHON'),
  }, signal);
  const apiKey = process.env.STUDIO_SYNC_API_KEY?.trim();
  const outputOrigins = process.env.STUDIO_SYNC_OUTPUT_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
  if (!apiKey || !outputOrigins?.length) throw new Error('Configure STUDIO_SYNC_API_KEY and STUDIO_SYNC_OUTPUT_ORIGINS.');
  if (await probeLocalDuration(input.recording, signal) < input.audioLength) throw new Error('Record a video at least as long as the speech audio.');
  const prepared = await prepareAvatarInputs(input, signal);
  await authorize();
  return syncLipSync({ ...prepared, output: join(input.workDirectory, 'synced.mp4'), apiKey, outputOrigins,
    idempotencyKey: input.exportId,
    onGeneration: generation => writeFile(join(input.outputDirectory, `sync-${input.exportId}.json`),
      JSON.stringify(generation), { mode: 0o600, flag: 'wx' }),
  }, signal);
}

async function run(manifest: string, signal: AbortSignal) {
  const config = pilotInput.parse(JSON.parse(await readFile(manifest, 'utf8')));
  const base = dirname(resolve(manifest));
  const path = (name: string) => resolve(base, name);
  const outputDirectory = path(config.outputDirectory);
  const output = join(outputDirectory, 'lecture.mp4');
  const outputStat = await stat(outputDirectory);
  if (!outputStat.isDirectory() || (outputStat.mode & 0o077) !== 0 || outputStat.uid !== process.getuid?.()) {
    throw new Error('Use a private output directory owned by the current user (mode 0700).');
  }
  if (await stat(output).then(() => true, () => false)) throw new Error('The output directory already contains lecture.mp4.');
  const { deck, notes } = await selectSlide(path(config.deck), config.slideId);
  const recording = path(config.recording);
  const narration = path(config.narration);
  const captions = path(config.captions);
  const authority = await readFile(pathSetting('STUDIO_AVATAR_PILOT_CONSENT_KEY'));
  const authorized = async () => {
    const [data, signature, recordingSha256, narrationSha256] = await Promise.all([
      readFile(path(config.authorization)), readFile(path(config.authorizationSignature)), digestFile(recording), digestFile(narration),
    ]);
    if (!verify(null, data, authority, signature)) throw new Error('The operator’s avatar authorization signature is invalid.');
    const grant = pilotAuthorization.parse(JSON.parse(data.toString('utf8')));
    const notesSha256 = createHash('sha256').update(notes).digest('hex');
    if (Date.parse(grant.expiresAt) <= Date.now() || grant.processor !== config.processor || grant.recordingSha256 !== recordingSha256 ||
      grant.narrationSha256 !== narrationSha256 || grant.notesSha256 !== notesSha256) {
      throw new Error('The avatar authorization expired or its asset digests changed.');
    }
    signal.throwIfAborted();
    return grant;
  };

  const settings: VideoSettings = { language: 'kk', aspect: '16:9', position: config.position, avatarPlacement: 'corner', captions: true };
  const frame = videoFrame(settings);
  const verification = {
    detector: pathSetting('STUDIO_VIDEO_MARK_VERIFIER'), anchors: pathSetting('STUDIO_VIDEO_C2PA_ANCHORS'),
    c2pa: process.env.STUDIO_VIDEO_C2PATOOL?.trim() || 'c2patool',
    expectedWatermarkId: randomBytes(16).toString('hex'), expectedSize: { width: frame.width, height: frame.height },
  };
  const tools = {
    embedder: pathSetting('STUDIO_VIDEO_MARK_EMBEDDER'), signingManifest: pathSetting('STUDIO_VIDEO_SIGNING_MANIFEST'),
  };
  const grant = await authorized();
  await Promise.all([access(verification.anchors, constants.R_OK), access(tools.signingManifest, constants.R_OK),
    access(tools.embedder, constants.X_OK), access(verification.detector, constants.X_OK)]).catch(() => {
    throw new Error('Configure accessible signing credentials and both watermark utilities.');
  });
  if (await realpath(tools.embedder) === await realpath(verification.detector)) throw new Error('Configure an independent watermark verifier.');
  await runOfflineMedia('C2PA tool preflight', verification.c2pa, ['--version'], signal);
  const duration = 30;
  const audioLength = await probeLocalDuration(narration, signal);
  if (audioLength < 20 || audioLength > duration) throw new Error('Prepare between 20 and 30 seconds of Kazakh narration for the 30-second pilot.');
  const work = await mkdtemp(join(outputDirectory, '.avatar-pilot-'));
  try {
    const slide = join(work, 'slide.png');
    const unsigned = join(work, 'composed.mp4');
    const signed = join(work, 'signed.mp4');
    const authorizedVideo = join(work, 'consented-recording');
    const authorizedAudio = join(work, 'consented-narration');
    await Promise.all([copyFile(recording, authorizedVideo), copyFile(narration, authorizedAudio)]);
    if (await digestFile(authorizedVideo) !== grant.recordingSha256 || await digestFile(authorizedAudio) !== grant.narrationSha256) {
      throw new Error('Authorized input changed while preparing the pilot.');
    }
    const generated = config.mediaDirectory ? path(config.mediaDirectory) : resolve(dirname(process.env.STUDIO_DB_PATH || defaultDatabase), 'media');
    const images = await renderVideoSteps(deck, { catalog: catalogRoot, generated }, settings, 1, signal);
    if (images.length !== 1) throw new Error('The slide renderer returned an incomplete scene.');
    await writeFile(slide, images[0], { mode: 0o600, flag: 'wx' });
    const avatar = await renderPilotAvatar({ processor: config.processor, recording: authorizedVideo, narration: authorizedAudio,
      workDirectory: work, outputDirectory, audioLength, exportId: verification.expectedWatermarkId,
    }, authorized, signal);
    const avatarLength = await probeLocalDuration(avatar, signal);
    if (Math.abs(avatarLength - audioLength) > 1) throw new Error('Lip-sync output differs from the narration by more than one second.');
    await composeAvatarScene({ frame, slide, avatar, narration: authorizedAudio, captionFile: captions, duration, output: unsigned }, signal);
    await markAndSign({ ...tools, input: unsigned, workDirectory: work, watermarkId: verification.expectedWatermarkId, c2pa: verification.c2pa, output: signed }, signal);
    const proof = await verifyVideo(signed, verification, signal);
    if (proof.frames !== duration * 25) throw new Error('The verified pilot does not contain exactly 30 seconds of video.');
    const current = await authorized();
    if (current.subjectRef !== grant.subjectRef || current.policy !== grant.policy ||
      current.recordingSha256 !== grant.recordingSha256 || current.narrationSha256 !== grant.narrationSha256) {
      throw new Error('The avatar authorization changed during the pilot.');
    }
    await chmod(signed, 0o600);
    // Publish exactly the verified bytes, with no overwrite or post-signing transcode.
    await link(signed, output);
    console.log(JSON.stringify({ file: output, duration, exportId: verification.expectedWatermarkId, ...proof }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const usage = 'Usage: bun --no-env-file apps/api/tools/avatar-pilot.ts INPUT.json\n       bun --no-env-file apps/api/tools/avatar-pilot.ts --narration-text DECK.json SLIDE_ID';
const controller = new AbortController();
const abort = () => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
try {
  const { values, positionals } = parseArgs({ options: { help: { type: 'boolean' }, 'narration-text': { type: 'boolean' } }, allowPositionals: true });
  if (values.help) console.log(usage);
  else if (values['narration-text'] && positionals.length === 2) process.stdout.write((await selectSlide(positionals[0], positionals[1])).notes);
  else if (!values['narration-text'] && positionals.length === 1) await run(positionals[0], controller.signal);
  else pilotError(usage);
} catch (error) {
  pilotError(error instanceof z.ZodError ? 'Check the pilot configuration or authorization fields.' :
    error instanceof Error ? error.message : 'Avatar pilot failed.');
} finally {
  process.off('SIGINT', abort);
  process.off('SIGTERM', abort);
}
