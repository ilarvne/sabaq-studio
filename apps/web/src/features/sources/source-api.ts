import { useEffect, useState } from 'react';
import type { SourceFile } from '@sabaq/contracts/source-files';
import type { Locale } from '@sabaq/lesson/types';
import { ApiError, request } from '@/lib/api';
import { isOcrImage } from '@/lib/media';

export const sourceFileAccept = (ocr: boolean) => '.txt,.md,.pdf,.docx' + (ocr ? ',.png,.jpg,.jpeg' : '');
const ocrConsent = {
  en: 'Send this scan to Alem to extract its text?',
  kk: 'Мәтінін тану үшін скан-көшірмені Alem қызметіне жібересіз бе?',
  ru: 'Отправить этот скан в Alem для распознавания текста?',
};

export function sourceFilePath(id: string) {
  return '/source-files/' + encodeURIComponent(id);
}

export async function uploadSourceFile(file: File, locale: Locale, ocr: boolean, signal: AbortSignal): Promise<SourceFile> {
  const name = file.name.trim();
  const format = name.split('.').at(-1)?.toLowerCase();
  const image = isOcrImage(format);
  if (!format || (!['txt', 'md', 'pdf', 'docx'].includes(format) && !(ocr && image))) throw new ApiError(415, {});
  if (!file.size || file.size > (image ? 10_000_000 : 20_000_000)) throw new ApiError(413, {});

  const upload = (useOcr: boolean) => {
    const query = new URLSearchParams({name});
    if (useOcr) query.set('ocr', 'alem');
    return fetch('/api/source-files/' + format + '?' + query, {
      method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file,
      signal: AbortSignal.any([signal, AbortSignal.timeout(useOcr ? 200_000 : 30_000)]),
    });
  };
  const approveOcr = () => {
    signal.throwIfAborted();
    if (!window.confirm(ocrConsent[locale])) throw new DOMException('OCR declined', 'AbortError');
  };
  if (image) approveOcr();
  let response = await upload(image);
  let body = await response.json();
  if (ocr && format === 'pdf' && response.status === 422 && body.error === 'scan') {
    approveOcr();
    response = await upload(true);
    body = await response.json();
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body as SourceFile;
}

export function useSourceFiles(enabled = true) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void request<SourceFile[]>('/source-files', {signal:controller.signal}).then(setFiles)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, revision]);
  return {files, loading, failed, refresh: () => setRevision(current => current + 1)};
}
