import { execFile } from 'node:child_process';
import { copyFile, link, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { videoFrame } from '@sabaq/contracts/video';

type Frame = ReturnType<typeof videoFrame>;
const fps = 25;

export function runOfflineMedia(stage: string, program: string, args: string[], signal: AbortSignal, cwd?: string) {
  const sandbox = ['--unshare-net', '--unshare-pid', '--die-with-parent', '--new-session', '--dev-bind', '/', '/',
    '--proc', '/proc', '--', program, ...args];
  const { PATH, HOME, LANG, LD_LIBRARY_PATH, CUDA_VISIBLE_DEVICES, HF_HOME, HF_HUB_CACHE, XDG_CACHE_HOME, VIRTUAL_ENV } = process.env;
  return new Promise<string>((accept, reject) => {
    execFile('bwrap', sandbox, { cwd, signal, timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 4_000_000,
      env: { PATH, HOME, LANG, LD_LIBRARY_PATH, CUDA_VISIBLE_DEVICES, HF_HOME, HF_HUB_CACHE, XDG_CACHE_HOME, VIRTUAL_ENV,
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    }, (error, stdout) => error ? reject(new Error(`${stage} failed.`)) : accept(stdout));
  });
}

async function requireOutput(path: string, stage: string) {
  const file = await stat(path).catch(() => undefined);
  if (!file?.isFile() || !file.size) throw new Error(`${stage} produced no media.`);
}

export async function probeLocalDuration(path: string, signal: AbortSignal) {
  const value = Number(await runOfflineMedia('Media inspection', 'ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration', '-of', 'csv=p=0', resolve(path),
  ], signal));
  if (!Number.isFinite(value) || value <= 0) throw new Error('Media duration is unavailable.');
  return value;
}

type AvatarInputs = { recording: string; narration: string; workDirectory: string };

export async function prepareAvatarInputs(options: AvatarInputs, signal: AbortSignal) {
  const work = resolve(options.workDirectory);
  const source = join(work, 'teacher.mp4');
  const audio = join(work, 'narration.wav');
  const duration = await probeLocalDuration(options.narration, signal);
  await runOfflineMedia('Teacher video preparation', 'ffmpeg', [
    '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', resolve(options.recording),
    '-map', '0:v:0', '-an', '-vf', `fps=${fps},scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', '-t', String(duration), source,
  ], signal);
  await runOfflineMedia('Narration preparation', 'ffmpeg', [
    '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', resolve(options.narration),
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', audio,
  ], signal);
  return { recording: source, narration: audio };
}

export async function runMuseTalk(options: AvatarInputs & { checkout: string; python: string }, signal: AbortSignal) {
  const work = resolve(options.workDirectory);
  // The upstream inference script interpolates its media paths into shell commands.
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(work)) throw new Error('Use a MuseTalk scratch directory with simple path segments.');
  const { recording, narration } = await prepareAvatarInputs(options, signal);
  const config = join(work, 'musetalk.json');
  const result = join(work, 'musetalk');
  // JSON is accepted by OmegaConf as YAML. Only private, normalized paths reach the upstream CLI.
  await writeFile(config, JSON.stringify({ lecture: { video_path: recording, audio_path: narration, result_name: 'avatar.mp4' } }), { mode: 0o600, flag: 'wx' });
  await runOfflineMedia('MuseTalk inference', options.python, [
    '-m', 'scripts.inference', '--inference_config', config, '--result_dir', result,
    '--unet_model_path', 'models/musetalkV15/unet.pth', '--unet_config', 'models/musetalkV15/musetalk.json',
    '--version', 'v15', '--fps', String(fps),
  ], signal, options.checkout);
  const output = join(result, 'v15', 'avatar.mp4');
  await requireOutput(output, 'MuseTalk');
  return output;
}

export async function composeAvatarScene(options: {
  frame: Frame; slide: string; avatar?: string; narration: string;
  captionFile?: string; output: string; duration: number;
}, signal: AbortSignal) {
  const { frame, duration, avatar } = options;
  const { labelBox, captionBox, avatarBox } = frame;
  if (!!avatar !== !!avatarBox || (options.captionFile && !captionBox) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Invalid composition inputs.');
  }
  const output = resolve(options.output);
  const work = await mkdtemp(join(dirname(output), '.compose-'));
  try {
    if (options.captionFile) await copyFile(options.captionFile, join(work, 'captions.srt'));
    const inputs = ['-loop', '1', '-framerate', String(fps), '-protocol_whitelist', 'file', '-i', resolve(options.slide)];
    if (avatar) inputs.push('-protocol_whitelist', 'file', '-i', resolve(avatar));
    inputs.push('-protocol_whitelist', 'file', '-i', resolve(options.narration));
    const filters = [`[0:v]scale=${frame.width}:${frame.height},setsar=1[slide]`];
    let picture = '[slide]';
    if (avatarBox) {
      const { x, y, width, height } = avatarBox;
      filters.push(`[1:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x10131d,setsar=1[avatar]`,
        `${picture}[avatar]overlay=${x}:${y}:eof_action=repeat[withavatar]`);
      picture = '[withavatar]';
    }
    if (captionBox && options.captionFile) {
      const { x, y, width, height } = captionBox;
      // Render into its own strip so oversized or misplaced captions cannot reach the slide.
      const fontSize = Math.min(80, Math.round(9000 / height));
      filters.push(`color=c=0x10131d:s=${width}x${height}:r=${fps},subtitles=filename=captions.srt:force_style='FontName=DejaVu Sans,Alignment=2,MarginV=34,FontSize=${fontSize}'[captions]`,
        `${picture}[captions]overlay=${x}:${y}[withcaptions]`);
      picture = '[withcaptions]';
    }
    const { x, y, width, height } = labelBox;
    filters.push(`${picture}drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=0x10131d:t=fill,` +
      `drawtext=font=DejaVu Sans:text=ИИ:fontcolor=white:fontsize=${Math.floor(height * .45)}:` +
      `x=${x}+(${width}-text_w)/2:y=${y}+(${height}-text_h)/2[picture]`);
    await runOfflineMedia('Video composition', 'ffmpeg', [
      '-nostdin', '-v', 'error', '-filter_complex_threads', '1', ...inputs, '-filter_complex', filters.join(';'),
      '-map', '[picture]', '-map', `${avatar ? 2 : 1}:a:0`, '-map_metadata', '-1', '-map_chapters', '-1',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-af', 'apad', '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '160k', '-movflags', '+faststart', '-t', String(duration), output,
    ], signal, work);
    await requireOutput(output, 'Video composition');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function assembleAvatarScenes(scenePaths: readonly string[], output: string, signal: AbortSignal) {
  if (scenePaths.length === 0) throw new Error('The lecture has no scenes.');
  const destination = resolve(output);
  const work = await mkdtemp(join(dirname(destination), '.assemble-'));
  try {
    const list = ['ffconcat version 1.0'];
    for (const [index, source] of scenePaths.entries()) {
      signal.throwIfAborted();
      const name = `scene-${index}.mp4`;
      const target = join(work, name);
      try { await link(source, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await copyFile(source, target);
      }
      list.push(`file '${name}'`);
    }
    await writeFile(join(work, 'scenes.ffconcat'), list.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    await runOfflineMedia('Lecture assembly', 'ffmpeg', [
      '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-protocol_whitelist', 'file', '-i', 'scenes.ffconcat',
      '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', destination,
    ], signal, work);
    await requireOutput(destination, 'Lecture assembly');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function markAndSign(options: {
  input: string; workDirectory: string; watermarkId: string; embedder: string;
  signingManifest: string; c2pa: string; output: string;
}, signal: AbortSignal) {
  if (!/^[a-f0-9]{32}$/.test(options.watermarkId)) throw new Error('Invalid export watermark identifier.');
  const marked = resolve(options.workDirectory, 'watermarked.mp4');
  await runOfflineMedia('Invisible watermarking', options.embedder, [resolve(options.input), marked, options.watermarkId], signal);
  await requireOutput(marked, 'Invisible watermarking');
  await runOfflineMedia('C2PA signing', options.c2pa, [
    marked, '--manifest', resolve(options.signingManifest), '--create', 'compositeWithTrainedAlgorithmicMedia', '--output', resolve(options.output),
  ], signal);
  await requireOutput(options.output, 'C2PA signing');
}
