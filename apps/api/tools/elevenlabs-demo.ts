import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spokenNarration } from '@sabaq/lesson/narration';
import { synthesizeElevenLabs } from '../src/video/elevenlabs';

// Use fixed, fictional notes for a repeatable provider smoke test.
const sample = [
  'Бүгін біз судың көлемін салыстырамыз. Үстелге екі мөлдір ыдыс қойыңыз.',
  'Бірінші ыдысқа 250 миллилитр, ал екінші ыдысқа 500 миллилитр су құйыңыз.',
  'Суды өлшеуіш стақанмен өлшеп, нәтижені кестеге жазыңыз.',
  'Екінші ыдыстағы су бірінші ыдыстағыдан екі есе көп. Енді бір ыдыстан екіншісіне аздап су құйып көріңіз.',
  'Судың жалпы көлемі өзгерді ме? Жауабыңызды сыныпта талқылаңыз.',
].join(' ');

const output = resolve('.data/elevenlabs-demo/kazakh.mp3');
try {
  const audio = await synthesizeElevenLabs({
    key: process.env.ELEVENLABS_API_KEY ?? '',
    voiceId: process.env.STUDIO_ELEVENLABS_DEMO_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
    text: spokenNarration(sample, 'kk'), language: 'kk',
  });
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, audio, { mode: 0o600, flag: 'wx' });
  console.log(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to synthesize Kazakh demo narration.');
  process.exitCode = 1;
}
