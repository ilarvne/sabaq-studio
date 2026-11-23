import type { SpeechAlignment } from './elevenlabs';

type TimedWord = { text: string; start: number; end: number };
export type SubtitleCue = { lines: string[]; start: number; end: number };

export function speechChunks(text: string) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 4800) {
    const window = remaining.slice(0, 4800);
    const lastSentence = [...window.matchAll(/[.!?…]\s+/gu)].at(-1)?.index;
    const lastSpace = window.search(/\s\S*$/u);
    const end = lastSentence !== undefined && lastSentence >= 2400 ? lastSentence + 1 : lastSpace >= 2400 ? lastSpace : 4800;
    const boundary = /[\uD800-\uDBFF]/u.test(remaining[end - 1]) ? end - 1 : end;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function timedWords(text: string, duration: number, alignment?: SpeechAlignment): TimedWord[] {
  const characters = alignment?.characters ?? Array.from(text);
  const words: TimedWord[] = [];
  let word: TimedWord | undefined;
  for (const [index, charactersAtTime] of characters.entries()) {
    const start = Math.min(duration, alignment?.character_start_times_seconds[index] ?? duration * index / characters.length);
    const end = Math.min(duration, alignment?.character_end_times_seconds[index] ?? duration * (index + 1) / characters.length);
    for (const character of charactersAtTime.replace(/[\p{Cc}<>{}\\]/gu, ' ')) {
      if (/\s/u.test(character)) {
        if (word) words.push(word);
        word = undefined;
      } else if (word) {
        word.text += character;
        word.end = end;
      } else word = { text: character, start, end };
    }
  }
  if (word) words.push(word);
  return words;
}

export function subtitleCues(text: string, duration: number, lineLimit: number, alignment?: SpeechAlignment): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let pending: SubtitleCue | undefined;
  const flush = () => {
    if (pending) cues.push(pending);
    pending = undefined;
  };
  for (const word of timedWords(text, duration, alignment)) {
    const symbols = Array.from(word.text);
    for (let index = 0; index < symbols.length; index += lineLimit) {
      const text = symbols.slice(index, index + lineLimit).join('');
      const start = word.start + (word.end - word.start) * index / symbols.length;
      const end = word.start + (word.end - word.start) * Math.min(index + lineLimit, symbols.length) / symbols.length;
      const last = pending?.lines.at(-1);
      const fits = !!last && Array.from(last).length + Array.from(text).length < lineLimit;
      if (pending && (start - pending.end > 0.8 || start - pending.start >= 4.5 || (!fits && pending.lines.length === 2))) flush();
      if (!pending) pending = { lines: [text], start, end };
      else {
        if (fits) pending.lines[pending.lines.length - 1] += ` ${text}`;
        else pending.lines.push(text);
        pending.end = end;
      }
      if (/[.!?…]$/u.test(text) && pending.end - pending.start >= 1.6) flush();
    }
  }
  flush();
  return cues.flatMap((cue, i) => {
    const end = Math.min(duration, cues[i + 1]?.start ?? duration, Math.max(cue.end, cue.start + 0.8));
    return end - cue.start >= 0.06 ? [{ ...cue, end }] : [];
  });
}

function srtTimestamp(seconds: number) {
  return new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23).replace('.', ',');
}

export function subtitleSrt(cues: SubtitleCue[]) {
  return cues.map(({ lines, start, end }, index) =>
    `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${lines.join('\n')}\n`).join('\n');
}
