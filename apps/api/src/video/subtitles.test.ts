import assert from 'node:assert/strict';
import test from 'node:test';
import { speechChunks, subtitleCues, subtitleSrt } from './subtitles';

test('captions follow measured speech after silence and clip to audio duration', () => {
  const characters = Array.from('Сәлем! Қош келдіңіз.');
  const starts = characters.map((_, i) => i < 6 ? 2 + i * 0.12 : 5 + (i - 6) * 0.12);
  const ends = starts.map(start => start + 0.09);
  const cues = subtitleCues(characters.join(''), 6.3, 34, {
    characters, character_start_times_seconds: starts, character_end_times_seconds: ends,
  });
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { lines: ['Сәлем!'], start: 2, end: 2.8 });
  assert.equal(cues[1].start, 5.12);
  assert.equal(cues[1].end, 6.3);
  assert.match(subtitleSrt(cues), /00:00:02,000 --> 00:00:02,800\nСәлем!/u);
});

test('long notes stay within the speech request and caption line bounds', () => {
  const text = ('Судың көлемі өзгерді. Кестеге жазыңыз. ').repeat(240).trim();
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' '), text);
  assert.ok(chunks.every(chunk => chunk.length <= 4800));
  const cues = subtitleCues('Ө'.repeat(81) + ' Кестеге жазыңыз.', 12, 34);
  assert.ok(cues.every(cue => cue.lines.length <= 2 && cue.lines.every(line => Array.from(line).length <= 34)));
  assert.ok(cues.every((cue, i) => !i || cue.start >= cues[i - 1].end));
});
