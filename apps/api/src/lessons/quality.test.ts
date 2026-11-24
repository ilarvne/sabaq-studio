import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { catalogRoot, defaultMediaRoot } from '../runtime-paths';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { QualityIssue } from '@sabaq/contracts/quality';
import type { Deck } from '@sabaq/lesson/types';
import { reviewSlides } from './quality';
import { Studio } from './studio';
import { StudioStore } from '../persistence/storage';
import { measureSlideQuality } from '../media/render-export';

const roots = { catalog: catalogRoot, generated: defaultMediaRoot };
const signal = () => new AbortController().signal;
const empty = (deck: Deck) => Object.fromEntries(deck.slides.map(slide => [slide.id, [] as QualityIssue[]]));

test('slide quality checks editable text against the artwork pixels it covers', async t => {
  const generated = await mkdtemp(join(tmpdir(), 'sabaq-contrast-'));
  t.after(() => rm(generated, { recursive: true, force: true }));
  const deck = makeFixtureDeck('en');
  const slide = {
    ...deck.slides[0], title: 'Field notes', body: 'Write a short observation.',
    layout: 'body' as const, image: undefined, design: undefined,
    freeLayout: { items: [
      { id: 'title' as const, x: 5, y: 5, w: 80, h: 17, rotation: 0 },
      { id: 'body' as const, x: 5, y: 28, w: 80, h: 50, rotation: 0 },
    ] },
  };
  const artwork = [
    { id: 'light', background: '#ffffff', filename: 'a'.repeat(64) + '.png' },
    { id: 'dark', background: '#000000', filename: 'b'.repeat(64) + '.png' },
  ];
  await Promise.all(artwork.map(({ background, filename }) => sharp({
    create: { width: 320, height: 180, channels: 3, background },
  }).png().toFile(join(generated, filename))));
  deck.theme = 'notebook';
  deck.slides = artwork.map(({ id, filename }) => ({ ...slide, id, importedArtwork: '/api/media/' + filename }));
  const report = await measureSlideQuality(deck, { ...roots, generated }, signal());
  assert.ok(!report.light.includes('contrast'));
  assert.ok(!report.light.includes('contrast-review'));
  assert.ok(report.dark.includes('contrast'));
});

test('slide quality flags chart graphics with insufficient contrast against the plot', async () => {
  const deck = makeFixtureDeck('en');
  // The lesson-part label also uses the accent color. Isolate the chart marks.
  const chart = { ...deck.slides.find(slide => slide.chart)!, lessonPart: 'lesson' };
  deck.slides = [chart];
  const builtIn = await measureSlideQuality(deck, roots, signal());
  assert.ok(!builtIn[chart.id].includes('graphic-contrast'));
  deck.powerPointStyle = {
    name: 'Light chart', paper: '#ffffff', ink: '#141414', accent: '#cccccc', tint: '#ffffff',
    headingFont: 'Arial', bodyFont: 'Arial', layouts: [],
  };
  const report = await measureSlideQuality(deck, roots, signal());
  assert.ok(report[chart.id].includes('graphic-contrast'));
  assert.ok(!report[chart.id].includes('contrast'));
});

test('the arranged layout stops shrinking a long word at the minimum text size', async () => {
  const deck = makeFixtureDeck('en');
  const slide = {
    ...deck.slides[0], title: 'Field notes', body: 'Incomprehensibly'.repeat(40),
    layout: 'split' as const, design: undefined, image: undefined, additionalImages: undefined,
  };
  deck.slides = [slide];
  const report = await measureSlideQuality(deck, roots, signal());
  assert.ok(report[slide.id].includes('overflow'));
  assert.ok(!report[slide.id].includes('small-type'));
});

test('deck review detects and repairs a third consecutive generated layout', async () => {
  const deck = makeFixtureDeck('en');
  const seed = deck.slides.find(slide => slide.layout === 'body' && !slide.image)!;
  deck.slides = ['first', 'second', 'third', 'fourth'].map(id =>
    ({ ...seed, id, design: undefined, layout: 'body' }));
  const checked = await reviewSlides(deck, roots, {}, signal(), async sample => empty(sample));
  assert.ok(checked.reports.third.issues.includes('repeated-layout'));
  const fixed = await reviewSlides(deck, roots, { third: seed.version }, signal(), async sample => empty(sample));
  assert.equal(fixed.slides[2].layout, 'stacked');
  assert.ok(fixed.slides.every(slide => !fixed.reports[slide.id].issues.includes('repeated-layout')));
  assert.equal(fixed.slides[2].body, seed.body);
});

test('automatic repairs preserve chart data and use measured layouts without changing teacher-authored slides', async () => {
  const deck = makeFixtureDeck('kk');
  const chart = deck.slides.find(slide => !!slide.chart)!;
  chart.chart!.alt = '';
  const protectedSlide = deck.slides.find(slide => slide.image && slide.id !== chart.id)!;
  protectedSlide.image!.alt = '';
  deck.slides = [chart, protectedSlide];
  const measure = async (sample: Deck) => Object.fromEntries(sample.slides.map(slide => [
    slide.id, slide.layout === 'stacked' ? [] : ['overflow'] as QualityIssue[],
  ]));
  const result = await reviewSlides(deck, roots, { [chart.id]: chart.version }, signal(), measure);
  assert.equal(result.state, 'reviewed');
  assert.equal(result.slides[0].layout, 'stacked');
  assert.match(result.slides[0].chart!.alt, /Бағандық диаграмма/u);
  assert.deepEqual(result.slides[0].chart!.series, chart.chart!.series);
  assert.deepEqual(result.slides[0].evidence, chart.evidence);
  assert.deepEqual(result.reports[chart.id].issues, []);
  assert.deepEqual(result.reports[protectedSlide.id].issues, ['missing-alt', 'overflow']);
  assert.equal(protectedSlide.layout, result.slides[1].layout);
  assert.equal(chart.chart!.alt, '');
});

test('unknown or regressive geometry preserves the original layout and reports the remaining issues', async () => {
  const deck = makeFixtureDeck('ru');
  deck.slides = [{ ...deck.slides[0], title: '', body: '', image: undefined, layout: 'body' }];
  const slide = deck.slides[0];
  const eligible = { [slide.id]: slide.version };
  const result = await reviewSlides(deck, roots, eligible, signal(), async sample => ({
    [slide.id]: sample.slides[0].layout === 'stacked' ? ['contrast'] : ['overlap'],
  }));
  assert.equal(result.slides[0].title, deck.outline[0].title);
  assert.equal(result.slides[0].layout, 'body');
  assert.deepEqual(result.reports[slide.id].issues, ['empty-content', 'overlap']);
  const failed = await reviewSlides(deck, roots, eligible, signal(), async () => ({}));
  assert.equal(failed.state, 'unavailable');
  assert.deepEqual(failed.reports[slide.id].issues, ['empty-content']);
});

test('readable-fit repair preserves verbatim Kazakh facts and skips authored or regressive changes', async () => {
  const deck = makeFixtureDeck('kk');
  const lead = 'Екі өлшемді салыстырыңыз.';
  const detail = 'Бірінші ыдыста 12,5 мл су бар. Екінші ыдыста 27 мл су бар.';
  const seed = { ...deck.slides[0], layout: 'centered' as const, image: undefined, design: undefined,
    body: lead + ' ' + detail, notes: 'Тәжірибе туралы сұраңыз.',
  };
  deck.slides = [
    { ...seed, id: 'generated' },
    { ...seed, id: 'teacher' },
    { ...seed, id: 'contrast' },
    { ...seed, id: 'formatted', bodyRuns: [{ text: seed.body, bold: true }] },
  ];
  const tested: string[] = [];
  const result = await reviewSlides(deck, roots, { generated: seed.version, contrast: seed.version, formatted: seed.version }, signal(), async sample =>
    Object.fromEntries(sample.slides.map(slide => {
      if (slide.body !== lead) return [slide.id, ['overflow'] as QualityIssue[]];
      tested.push(slide.id);
      return [slide.id, slide.id === 'contrast' ? ['contrast'] : []];
    })));
  assert.deepEqual(tested, ['generated', 'contrast']);
  assert.equal(result.slides[0].body, lead);
  assert.equal(result.slides[0].notes, seed.notes + '\n\n' + detail);
  assert.deepEqual(result.reports.generated.issues, []);
  for (const slide of result.slides.slice(1)) {
    assert.equal(slide.body, seed.body);
    assert.equal(slide.notes, seed.notes);
    assert.deepEqual(result.reports[slide.id].issues, ['overflow']);
  }
});

test('generation schedules a deck review, skips intervening edits and persists a verified repair', async () => {
  const store = new StudioStore(':memory:');
  let entered!: () => void, proceed!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { proceed = resolve; });
  let checks = 0;
  const studio = new Studio(store, 0, roots.generated, async sample => {
    checks++;
    if (checks === 1) {
      entered(); await pending;
      return Object.fromEntries(sample.slides.map(slide => [slide.id, ['overflow'] as QualityIssue[]]));
    }
    return empty(sample);
  });
  try {
    const deck = studio.create({ topic: 'Class project', language: 'en', provider: 'fixture', review: false });
    await started;
    const first = studio.deck(deck.id).slides[0];
    studio.edit(deck.id, { kind: 'slide', slideId: first.id, baseVersion: first.version, changes: { title: 'Teacher edit' } });
    proceed();
    for (let n = 0; n < 200 && studio.deck(deck.id).qualityReview?.state === 'pending'; n++) await delay(5);
    const checked = studio.deck(deck.id), review = checked.qualityReview;
    assert.equal(review?.state, 'reviewed');
    assert.equal(checked.slides[0].title, 'Teacher edit');
    assert.equal(checked.slides[0].layout, first.layout);
    assert.equal(review?.state === 'reviewed' && review.slides[first.id], undefined);
    assert.equal(checked.slides[1].layout, 'stacked');
    assert.equal(checks, 2);
    assert.ok(studio.revisions(deck.id).some(item => item.reason === 'Generated slide quality repairs'));
  } finally { proceed?.(); await studio.close(); }
});

test('compacted body and notes save together while a concurrent teacher revision wins', async () => {
  const store = new StudioStore(':memory:');
  let measured!: () => void, proceed!: () => void;
  const started = new Promise<void>(resolve => { measured = resolve; });
  const pending = new Promise<void>(resolve => { proceed = resolve; });
  const lead = 'Measure the specimen.';
  const fact = 'The length is 12 mm.';
  const studio = new Studio(store, 0, roots.generated, async sample => {
    if (sample.slides.some(slide => slide.body === lead)) {
      measured();
      await pending;
    }
    return Object.fromEntries(sample.slides.map(slide => [slide.id, slide.body === lead ? [] : ['overflow'] as QualityIssue[]]));
  });
  try {
    const deck = studio.create({ topic: lead + ' ' + fact, language: 'en', provider: 'fixture', review: false, slideCount: 3 });
    await Promise.race([started, delay(3000).then(() => { throw new Error('The text repair was not measured.'); })]);
    const [first, second] = studio.deck(deck.id).slides;
    studio.edit(deck.id, { kind: 'slide', slideId: first.id, baseVersion: first.version,
      changes: { body: 'Independent worksheet instructions.', notes: 'Teacher notes.' },
    });
    proceed();
    for (let n = 0; n < 200 && studio.deck(deck.id).qualityReview?.state === 'pending'; n++) await delay(5);
    const checked = studio.deck(deck.id);
    assert.equal(checked.qualityReview?.state, 'reviewed');
    assert.equal(checked.slides[0].body, 'Independent worksheet instructions.');
    assert.equal(checked.slides[0].notes, 'Teacher notes.');
    assert.equal(checked.slides[1].body, lead);
    assert.ok(checked.slides[1].notes.includes(fact));
    assert.equal(checked.slides[1].version, second.version + 1);
  } finally { proceed?.(); await studio.close(); }
});
