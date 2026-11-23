import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export async function digestFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

type VerificationConfig = {
  anchors: string;
  c2pa: string;
  detector: string;
  expectedSize?: { width: number; height: number };
  expectedWatermarkId?: string;
};

const assertions = z.object({ assertions: z.array(z.object({ label: z.string(), data: z.unknown() })) });
const sourceActions = z.object({ actions: z.array(z.object({ action: z.string(), digitalSourceType: z.string().optional() })) });
const aiSourceTypes = new Set([
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
]);
export const videoWatermarkId = z.string().regex(/^[0-9a-f]{32}$/);

function execute(command: string, args: string[], file: string, config: VerificationConfig, signal: AbortSignal) {
  const tool = isAbsolute(command) ? '/work/validator' : command;
  const sandbox = [
    '--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--dir', '/etc', '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache', '--dev', '/dev', '--proc', '/proc',
    '--size', '268435456', '--tmpfs', '/tmp', '--dir', '/work', '--ro-bind', file, '/work/video.mp4',
    '--ro-bind', config.anchors, '/work/anchors.pem',
    ...(isAbsolute(command) ? ['--ro-bind', command, tool] : []),
    '--clearenv', '--setenv', 'HOME', '/tmp', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'PATH', '/usr/bin',
    '--chdir', '/work', '/usr/bin/prlimit', '--as=3221225472', '--cpu=300', '--core=0', '--', tool, ...args,
  ];
  return new Promise<unknown>((resolve, reject) => {
    execFile('bwrap', sandbox, { signal, timeout: 300000, maxBuffer: 4_000_000, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) return reject(new Error('Verification utility failed.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid verification report.')); }
    });
  });
}

const result = z.object({ code: z.string() });
const verdict = z.object({ success: z.array(result), failure: z.array(result).optional() });
export function validateVideoReports(c2pa: unknown, streams: unknown, detector: unknown, digest: string,
  expectedSize?: VerificationConfig['expectedSize'], expectedWatermarkId?: string) {
  const report = z.object({
    active_manifest: z.string().min(1), manifests: z.record(z.string(), z.unknown()),
    validation_results: z.object({ activeManifest: verdict }), validation_status: z.array(result).optional(),
  }).parse(c2pa);
  const manifest = report.validation_results.activeManifest;
  const successes = new Set(manifest.success.map(entry => entry.code));
  if (!Object.hasOwn(report.manifests, report.active_manifest) || manifest.failure?.length || report.validation_status?.length ||
    !['claimSignature.validated', 'signingCredential.trusted', 'assertion.bmffHash.match'].every(code => successes.has(code))) {
    throw new Error('Video manifest failed trust or content binding validation.');
  }
  if (expectedWatermarkId) {
    const claim = assertions.parse(report.manifests[report.active_manifest]);
    const actions = claim.assertions.filter(assertion => /^c2pa\.actions(?:\.v[12])?$/.test(assertion.label));
    if (!actions.some(({ data }) => sourceActions.parse(data).actions.some(action =>
      action.action === 'c2pa.created' && action.digitalSourceType && aiSourceTypes.has(action.digitalSourceType)))) {
      throw new Error('The signed video does not identify AI generation.');
    }
  }
  const { streams: tracks } = z.object({ streams: z.array(z.object({
    codec_type: z.string(), width:z.number().optional(),height:z.number().optional(),nb_read_frames: z.coerce.number().int().positive().optional(),
  })) }).parse(streams);
  const picture=tracks.find(track=>track.codec_type==='video');
  if(expectedSize && (picture?.width!==expectedSize.width || picture?.height!==expectedSize.height)) throw new Error('Unexpected video dimensions.');
  const frames = picture?.nb_read_frames;
  if (!frames || !tracks.some(track => track.codec_type === 'audio')) throw new Error('Missing video or narration.');
  const marks = z.object({
    sha256: z.literal(digest), decodedFrames: z.literal(frames), visibleLabel: z.literal('ИИ'),
    visibleLabelFrames: z.literal(frames), watermarkScheme: z.string().min(1), watermarkFrames: z.literal(frames),
    ...(expectedWatermarkId && { watermarkId: z.literal(videoWatermarkId.parse(expectedWatermarkId)) }),
  }).parse(detector);
  return { sha256: digest, frames, watermarkScheme: marks.watermarkScheme, manifest: report.active_manifest };
}

export async function verifyVideo(path: string, config:VerificationConfig, signal: AbortSignal) {
  const digest = await digestFile(path);
  const c2pa = await execute(config.c2pa, ['/work/video.mp4', 'trust', '--trust_anchors', '/work/anchors.pem'], path, config, signal);
  const streams = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-count_frames',
    '-show_entries', 'stream=codec_type,nb_read_frames,width,height', '-of', 'json', '/work/video.mp4'], path, config, signal);
  const marks = await execute(config.detector, ['/work/video.mp4'], path, config, signal);
  return validateVideoReports(c2pa, streams, marks, digest, config.expectedSize, config.expectedWatermarkId);
}
