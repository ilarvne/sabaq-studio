import type { Locale } from '@sabaq/lesson/types';
import { z } from 'zod';
import { readBounded } from '../media/bounded-response';

export function elevenLabsVoice() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.STUDIO_ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb';
  return key && /^[A-Za-z\d]{10,40}$/.test(voiceId) ? { key, voiceId } : undefined;
}

type SpeechRequest = {
  key: string; voiceId: string; text: string; language: Locale; signal?: AbortSignal;
};

async function requestSpeech(options: SpeechRequest, timed: boolean) {
  const text = options.text.trim();
  if (!options.key.trim() || !/^[A-Za-z\d]{10,40}$/.test(options.voiceId) || !text || text.length > 5000) {
    throw new Error('ElevenLabs requires a key, a voice ID, and 1–5,000 characters of narration.');
  }
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${options.voiceId}${timed ? '/with-timestamps' : ''}`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, {
    method: 'POST', redirect: 'error',
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: { 'xi-api-key': options.key, 'Content-Type': 'application/json', Accept: timed ? 'application/json' : 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_v3', language_code: options.language }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ElevenLabs rejected the narration request (HTTP ${response.status}).`);
  }
  if (response.headers.get('Content-Type')?.split(';', 1)[0] !== (timed ? 'application/json' : 'audio/mpeg')) {
    await response.body?.cancel();
    throw new Error('ElevenLabs returned an unexpected audio format.');
  }
  const bytes = await readBounded(response, timed ? 12_000_000 : 8_000_000);
  if (!bytes?.length) throw new Error('ElevenLabs returned no usable audio.');
  return bytes;
}

export function synthesizeElevenLabs(options: SpeechRequest) {
  return requestSpeech(options, false);
}

const alignmentSchema = z.object({
  characters: z.array(z.string().max(32)).max(50_000),
  character_start_times_seconds: z.array(z.number().finite().nonnegative()).max(50_000),
  character_end_times_seconds: z.array(z.number().finite().nonnegative()).max(50_000),
});
export type SpeechAlignment = z.infer<typeof alignmentSchema>;
const timedSpeechSchema = z.object({
  audio_base64: z.base64().min(4).max(10_670_000),
  alignment: z.unknown().optional(), normalized_alignment: z.unknown().optional(),
});

function parseAlignment(value: unknown) {
  const parsed = alignmentSchema.safeParse(value);
  if (!parsed.success) return;
  const alignment = parsed.data;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!characters.length || starts.length !== characters.length || ends.length !== characters.length || !ends.at(-1) ||
    starts.some((time, index) => time > ends[index] || (index > 0 && (time < starts[index - 1] || ends[index] < ends[index - 1])))) return;
  return alignment;
}

export async function synthesizeTimedElevenLabs(options: SpeechRequest) {
  const bytes = await requestSpeech(options, true);
  const data = timedSpeechSchema.parse(JSON.parse(bytes.toString('utf8')));
  return { audio: Buffer.from(data.audio_base64, 'base64'), alignment: parseAlignment(data.normalized_alignment) ?? parseAlignment(data.alignment) };
}
