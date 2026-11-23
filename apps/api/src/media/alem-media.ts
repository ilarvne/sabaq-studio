import { z } from 'zod';
import type { Locale } from '@sabaq/lesson/types';
import { allowedProviderEndpoint } from '../access/provider-origins';
import { readBounded } from './bounded-response';

const transcriptions = 'https://llm.alem.ai/v1/audio/transcriptions';
const completions = 'https://llm.alem.ai/v1/chat/completions';
const languages = ['kk', 'ru', 'en'] as const;
export const mediaLanguage = z.enum(languages);

function transcriptionKey(language: Locale) {
  return language === 'kk' ? process.env.ALEM_STT_KK_API_KEY?.trim() : process.env.ALEM_STT_API_KEY?.trim();
}

export function canTranscribe(language: Locale) {
  return Boolean(transcriptionKey(language)) && allowedProviderEndpoint(transcriptions);
}

export function mediaCapabilities() {
  return { transcription: languages.filter(canTranscribe), ocr: canRecognizeImage() };
}

export function canRecognizeImage() {
  return Boolean(process.env.ALEM_OCR_API_KEY?.trim()) && allowedProviderEndpoint(completions);
}

async function readResult<T>(response: Response, schema: z.ZodType<T>) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Alem media service is unavailable.');
  }
  const bytes = await readBounded(response, 500_000);
  if (!bytes) throw new Error('Alem media response exceeded its size limit.');
  return schema.parse(JSON.parse(bytes.toString('utf8')));
}

const transcript = z.object({ text: z.string().max(12_000) });

export async function transcribeSpeech(wav: Uint8Array<ArrayBuffer>, language: Locale, signal: AbortSignal) {
  const key = transcriptionKey(language);
  if (!key || !allowedProviderEndpoint(transcriptions)) throw new Error('Alem transcription is disabled.');
  const body = new FormData();
  body.set('model', language === 'kk' ? 'speech-to-text-kk' : 'speech-to-text');
  body.set('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  if (language !== 'kk') body.set('language', language);
  const response = await fetch(transcriptions, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}` }, body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
  return (await readResult(response, transcript)).text.trim();
}

const textResult = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(100_000) }) })).min(1) });

export async function recognizeImage(jpeg: Buffer, signal: AbortSignal) {
  const key = process.env.ALEM_OCR_API_KEY?.trim();
  if (!key || !allowedProviderEndpoint(completions)) throw new Error('Alem OCR is disabled.');
  const response = await fetch(completions, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-ocr', temperature: 0, stream: false,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpeg.toString('base64') } },
        { type: 'text', text: 'Free OCR.' },
      ] }],
    }),
  });
  return (await readResult(response, textResult)).choices[0].message.content;
}
