import { useEffect, useState } from 'react';
import type { Locale } from '@sabaq/lesson/types';
import { request } from './api';

type MediaCapabilities = { transcription: Locale[]; ocr: boolean };
const disabled: MediaCapabilities = { transcription: [], ocr: false };

export function useMediaCapabilities() {
  const [capabilities, setCapabilities] = useState(disabled);
  useEffect(() => {
    const controller = new AbortController();
    void request<MediaCapabilities>('/media/capabilities', { signal: controller.signal }).then(setCapabilities).catch(() => {});
    return () => controller.abort();
  }, []);
  return capabilities;
}

export function isOcrImage(format: string | undefined): format is 'png' | 'jpg' | 'jpeg' {
  return format === 'png' || format === 'jpg' || format === 'jpeg';
}
