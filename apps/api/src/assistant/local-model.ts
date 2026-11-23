import { z } from 'zod';

export function loopbackService(value: string | undefined) {
  if (!value?.trim()) return;
  try {
    const url = new URL(value.trim());
    if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return;
    return url;
  } catch {
    return undefined;
  }
}

const installedModels = z.object({models:z.array(z.object({
  name:z.string(),digest:z.string().min(1),details:z.object({format:z.string()}),
  remote_model:z.string().nullish(),remote_host:z.string().nullish(),
}))});

/** Ollama can relay cloud models. Inspect the local inventory before sending lesson text. */
export async function findLocalModel(origin:URL, model:string, signal:AbortSignal) {
  if (/(?:^|[:/-])cloud(?:$|[:/-])/i.test(model)) return;
  try {
    const response = await fetch(new URL('/api/tags',origin),{
      redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),
    });
    if (!response.ok) return;
    const result = installedModels.safeParse(await response.json());
    if (!result.success) return;
    const tag = result.data.models.find(item=>item.name===model || item.name===model+':latest');
    if (tag?.details.format && !tag.remote_model && !tag.remote_host) return {name:tag.name,digest:tag.digest};
  } catch {
    signal.throwIfAborted();
  }
}
