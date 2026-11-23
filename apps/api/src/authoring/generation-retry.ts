import { setTimeout as sleep } from 'node:timers/promises';

export class GenerationHttpError extends Error {
  constructor(public status: number, service: string, readonly retryAfter: string | null = null) {
    super(`${service} request failed (HTTP ${status}).`);
  }
}

function retryDelay(error: unknown, attempt: number) {
  const backoff = 250 * 2 ** attempt;
  if (error instanceof GenerationHttpError) {
    if (![408,425,429,500,502,503,504].includes(error.status)) return;
    if (error.retryAfter) {
      const seconds = /^\d+$/u.test(error.retryAfter) ? Number(error.retryAfter) * 1000 : Date.parse(error.retryAfter) - Date.now();
      if (Number.isFinite(seconds)) {
        if (seconds > 10000) return;
        return Math.max(backoff,seconds);
      }
    }
    return backoff;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || (error instanceof TypeError && error.message === 'fetch failed'))) return backoff;
}

/** Retry only temporary worker failures, for at most three attempts. Cancellation also stops the backoff. */
export async function runGenerationStep<T>(step: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt=0; ;attempt++) {
    signal.throwIfAborted();
    try { return await step(); }
    catch (error) {
      signal.throwIfAborted();
      const delay = retryDelay(error,attempt);
      if (delay === undefined || attempt >= 2) throw error;
      await sleep(delay,undefined,{signal});
    }
  }
}
