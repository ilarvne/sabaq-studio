import { openAsBlob } from 'node:fs';
import { open as openFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const api = 'https://api.sync.so';
const limit = 125_000_000;
const generationResult = z.object({
  id: z.uuid(), status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'NO_OP', 'FAILED', 'REJECTED']),
  outputUrl: z.string().nullish(),
  input: z.array(z.object({ assetId: z.uuid().nullish() })).optional(),
});

type Generation = { id: string; assetIds: string[] };
type SyncOptions = { apiKey: string; outputOrigins: readonly string[]; idempotencyKey: string;
  recording: string; narration: string; output: string; onGeneration: (generation: Generation) => Promise<void> };

async function validPayload(path: string, type: string) {
  const file = await stat(path);
  if (!file.isFile() || !file.size || file.size > limit) throw new Error('The hosted avatar input is outside the pilot media limits.');
  return openAsBlob(path, { type });
}

export async function syncLipSync(options: SyncOptions, signal: AbortSignal, request: typeof fetch = fetch) {
  const { apiKey, outputOrigins, idempotencyKey, output } = options;
  if (!apiKey.trim() || !outputOrigins.length || !/^[A-Za-z0-9._~-]{1,128}$/.test(idempotencyKey)) {
    throw new Error('Configure the Sync Labs key, approved output origins, and a valid request identifier.');
  }
  const headers = { 'x-api-key': apiKey };
  const form = new FormData();
  form.set('model', 'sync-3');
  form.set('options', JSON.stringify({ sync_mode: 'cut_off', active_speaker_detection: { auto_detect: false } }));
  form.set('video', await validPayload(options.recording, 'video/mp4'), 'recording.mp4');
  form.set('audio', await validPayload(options.narration, 'audio/wav'), 'narration.wav');
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(900_000)]);
  const create = await request(`${api}/v2/generate`, {
    method: 'POST', body: form, headers: { ...headers, 'Idempotency-Key': idempotencyKey }, redirect: 'error', signal: runSignal,
  });
  if (!create.ok) {
    await create.body?.cancel();
    throw new Error(`Sync Labs could not start lip sync (HTTP ${create.status}).`);
  }
  let current = generationResult.parse(await create.json());
  const id = current.id;
  try {
    const assetIds = current.input?.flatMap(input => input.assetId ? [input.assetId] : []) ?? [];
    await options.onGeneration({ id, assetIds });
    while (current.status === 'PENDING' || current.status === 'PROCESSING') {
      await delay(10_000, undefined, { signal: runSignal });
      const progress = await request(`${api}/v2/generate/${id}`, { headers, redirect: 'error', signal: runSignal });
      if (!progress.ok) {
        await progress.body?.cancel();
        if ([429, 502, 503, 504].includes(progress.status)) continue;
        throw new Error(`Sync Labs could not read lip-sync progress (HTTP ${progress.status}).`);
      }
      current = generationResult.parse(await progress.json());
      if (current.id !== id) throw new Error('Sync Labs returned a different generation.');
    }
    if (current.status !== 'COMPLETED' || !current.outputUrl) throw new Error(`Sync Labs did not lip-sync the video (${current.status}).`);
    const url = new URL(current.outputUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !outputOrigins.includes(url.origin)) {
      throw new Error('Sync Labs returned an unapproved download origin.');
    }
    // This is a signed media link. Never forward the provider API key.
    const media = await request(url, { redirect: 'error', signal: runSignal });
    const type = media.headers.get('content-type')?.split(';')[0];
    if (!media.ok || !media.body || !['video/mp4', 'video/quicktime', 'application/octet-stream'].includes(type ?? '') ||
      Number(media.headers.get('content-length')) > limit) {
      await media.body?.cancel();
      throw new Error('Sync Labs returned invalid avatar media.');
    }
    const file = await openFile(output, 'wx', 0o600);
    const reader = media.body.getReader();
    let size = 0;
    try {
      for (;;) {
        runSignal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error('Sync Labs avatar media exceeds the pilot limit.');
        await file.writeFile(value);
      }
      if (!size) throw new Error('Sync Labs returned an empty avatar.');
    } finally {
      await reader.cancel().catch(() => {});
      await file.close();
    }
    return output;
  } finally {
    // Terminal generations support deletion. A private receipt survives cancellation for operator cleanup.
    const response = await request(`${api}/v2/generations/${id}`, {
      method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(12_000),
    }).catch(() => undefined);
    await response?.body?.cancel().catch(() => {});
  }
}
