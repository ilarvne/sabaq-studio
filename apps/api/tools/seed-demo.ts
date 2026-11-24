import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { defaultImageCrop } from '@sabaq/lesson/image-crop';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { SourceLibrary } from '../src/media/source-library';
import { StudioStore } from '../src/persistence/storage';
import { kindnessLessons } from './demo-kindness';
import type { DemoLesson } from './demo-lesson';
import { seedlingLessons } from './demo-seedlings';

function makeDeck(lesson: DemoLesson, updatedAt: string): Deck {
  const key = `${lesson.key}-${lesson.language}`;
  const slides = lesson.slides.map((slide, index): Slide => ({
    ...slide,
    id: `s${String(index + 1).padStart(2, '0')}`,
    status: 'ready',
    version: 0,
  }));
  return {
    id: key,
    title: slides[0].title,
    topic: lesson.topic,
    language: lesson.language,
    theme: lesson.theme,
    template: lesson.template,
    updatedAt,
    revision: 0,
    provider: 'fixture',
    phase: 'editing',
    outlineStatus: 'complete',
    outline: slides.map(slide => ({
      id: slide.id, title: slide.title, summary: slide.body, layout: slide.layout,
      role: slide.design?.variant,
    })),
    slides,
    source: { name: `${key}.txt`, text: lesson.sourceText },
  };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: 'boolean', short: 'h' } },
});
const [destination] = positionals;
if (values.help || positionals.length !== 1) {
  const usage = 'Usage: bun run seed:demo <new-directory>';
  if (values.help) console.log(usage);
  else console.error(usage);
  process.exit(values.help ? 0 : 1);
}

const directory = resolve(destination);
const dbPath = resolve(directory, 'studio.sqlite');
const languages: Locale[] = ['kk', 'ru', 'en'];
const schoolyard = languages.map((language): Deck => {
  const deck = makeFixtureDeck(language);
  const slides = deck.slides.map(slide => slide.image && slide.layout !== 'image-full'
    ? { ...slide, image: { ...slide.image, crop: defaultImageCrop } }
    : slide);
  return { ...deck, slides, outlineStatus: 'complete' };
});
const updatedAt = schoolyard[0].updatedAt;
// Offline editor drafts are keyed by deck ID. A fresh namespace prevents replay after a reset.
const seedId = randomBytes(8).toString('hex');
const decks = [...schoolyard, ...[...seedlingLessons, ...kindnessLessons].map(lesson => makeDeck(lesson, updatedAt))]
  .map(deck => ({ ...deck, id: `demo-${seedId}-${deck.id}` }));
const sources = new Map(decks.flatMap(({ source }) => source ? [[source.name, source] as const] : []));

try {
  mkdirSync(directory, { mode: 0o700 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  console.error(`Choose a new directory. ${directory} already exists.`);
  process.exit(1);
}
const store = new StudioStore(dbPath);
try {
  const library = new SourceLibrary(store);
  library.saveLegacyAttachments([...sources.values()]);
  store.transaction(() => {
    for (const deck of decks) store.saveRevision(deck, 'demo seed');
  });
} finally {
  store.db.close();
}
console.log(`Created ${decks.length} demo lessons and ${sources.size} source files in ${dbPath}`);
