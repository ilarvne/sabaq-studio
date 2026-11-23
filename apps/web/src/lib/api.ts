import type { Deck } from '@sabaq/lesson/types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { message?: string; deck?: Deck; moderationConfirmation?: string }) {
    super(body.message ?? 'Request failed');
  }
}

export async function request<T>(path: string, options?: {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  onSuccess?: (headers: Headers) => void;
}): Promise<T> {
  const response = await fetch('/api' + path, {
    method: options?.method ?? 'GET',
    cache: 'no-store',
    signal: options?.signal,
    headers: options?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body);
  options?.onSuccess?.(response.headers);
  return body as T;
}

export const runLimitMessage = {
  en:'Two lessons are already generating. Wait for one to finish or cancel it.',
  ru:'Одновременно можно формировать два урока. Дождитесь завершения одного из них или отмените его.',
  kk:'Бір уақытта екі сабақ дайындауға болады. Біреуі аяқталғанша күтіңіз немесе оны тоқтатыңыз.',
};
