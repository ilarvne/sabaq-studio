import { cpus, totalmem } from 'node:os';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

declare global {
  interface Window {
    editorBenchmark?: Promise<number>;
  }
}

const fixtures = {
  kk: { topic: 'Сыныптағы өлшеу', body: 'Шаманы өлшеп, нәтижені кестеге жазыңыз. Қадамыңызды сыныпқа түсіндіріңіз.' },
  ru: { topic: 'Измерения в классе', body: 'Измерьте величину и запишите результат в таблицу. Объясните свои действия классу.' },
};
const desktop = { width: 1440, height: 900 };
const repeats = Number(process.env.STUDIO_BENCHMARK_RUNS ?? (process.env.STUDIO_BENCHMARK === '1' ? 20 : 1));
const thresholds = {
  open: { p50: 1500, p90: 2500 },
  input: { p50: 16, p90: 33 },
  theme: { p50: 200, p90: 400 },
};

async function makeLesson(api: APIRequestContext, language: keyof typeof fixtures) {
  const { topic, body } = fixtures[language];
  const created = await api.post('/api/decks', {
    data: { topic, language, template: 'blank', provider: 'fixture', review: false },
  });
  expect(created.status()).toBe(201);
  const deck: Deck = await created.json();
  const slide = deck.slides[0];
  const path = '/api/decks/' + deck.id;
  const update = await api.patch(path, {
    data: { op: { kind: 'slide', slideId: slide.id, baseVersion: slide.version, changes: { body } } },
  });
  expect(update.ok()).toBe(true);
  let last = slide.id;
  for (let number = 2; number <= 40; number++) {
    const repeated = await api.patch(path, { data: { op: { kind: 'duplicate', slideId: last } } });
    expect(repeated.ok()).toBe(true);
    const current: Deck = await repeated.json();
    last = current.slides[number - 1].id;
  }
  return deck;
}

async function clickToFrame(page: Page, control: Locator, selector: string) {
  await control.evaluate((element, selector) => {
    window.editorBenchmark = new Promise((resolve) => {
      element.addEventListener('click', () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (!document.querySelector(selector)) return;
          observer.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - start));
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      }, { once: true });
    });
  }, selector);
  await control.click();
  return (await page.evaluate(() => window.editorBenchmark))!;
}

async function inputToFrame(page: Page, input: Locator, marker: string) {
  await input.evaluate((element) => {
    window.editorBenchmark = new Promise((resolve) => {
      element.addEventListener('input', () => {
        const start = performance.now();
        requestAnimationFrame(() => resolve(performance.now() - start));
      }, { capture: true, once: true });
    });
  });
  await page.keyboard.insertText(marker);
  return (await page.evaluate(() => window.editorBenchmark))!;
}

function percentiles(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
  return { p50: percentile(0.5), p90: percentile(0.9) };
}

async function frameIntervals(list: Locator, scroll: boolean, frames: number) {
  return list.evaluate((element, { scroll, frames }) => new Promise<number[]>((resolve) => {
    const intervals: number[] = [];
    const distance = element.scrollHeight - element.clientHeight;
    if (scroll && distance <= 0) throw new Error('The slide filmstrip is not scrollable.');
    element.scrollTop = 0;
    function sample(before: number) {
      requestAnimationFrame((current) => {
        intervals.push(current - before);
        if (scroll) element.scrollTop = distance * intervals.length / frames;
        if (intervals.length < frames) sample(current);
        else resolve(intervals);
      });
    }
    requestAnimationFrame(sample);
  }), { scroll, frames });
}

for (const language of ['kk', 'ru'] as const) {
  test(`40-slide editor benchmark in ${language}`, async ({ page, request, browser }, info) => {
    if (!Number.isInteger(repeats) || repeats < 1) throw new Error('STUDIO_BENCHMARK_RUNS must be a positive integer.');
    test.setTimeout(Math.max(60_000, repeats * 10_000));
    await page.setViewportSize(desktop);
    await page.addInitScript((language) => localStorage.setItem('sabaq:locale', language), language);
    const deck = await makeLesson(request, language);
    const samples = [];
    let interval = 0;
    let apiRequests = 0;
    let patchRequests = 0;
    page.on('request', (outgoing) => {
      if (!new URL(outgoing.url()).pathname.startsWith('/api/')) return;
      apiRequests++;
      if (outgoing.method() === 'PATCH') patchRequests++;
    });
    for (let run = 0; run < repeats; run++) {
      await page.goto('/#/library');
      const entry = page.locator(`.dashboard-library a[href="#/deck/${deck.id}"]`).first();
      const stage = page.locator('.ed-stage');
      const text = stage.locator('[data-slot-entry="body"]');
      const open = await clickToFrame(page, entry, '.ed-stage [data-slot-entry="body"]');
      const filmstrip = page.locator('.ed-rail .ed-thumb-list');
      await expect(filmstrip.locator('.ed-thumb')).toHaveCount(40);
      await page.evaluate(() => document.fonts.ready);
      if (!interval) interval = percentiles(await frameIntervals(filmstrip, false, 20)).p50;
      const scroll = await frameIntervals(filmstrip, true, 45);
      const skippedFrames = scroll.filter((frame) => frame > interval * 1.5).length;

      await text.click();
      const input = stage.locator('[contenteditable=true]');
      await expect(input).toBeFocused();
      await input.press('End');
      const marker = (language === 'ru' ? 'Урок ' : 'Сабақ ') + String(run + 1);
      const beforeInput = apiRequests;
      const beforePatch = patchRequests;
      const edit = await inputToFrame(page, input, marker);
      const apiDuringInput = apiRequests - beforeInput;
      await expect(input).toContainText(marker);
      await expect.poll(async () => {
        const saved: Deck = await (await request.get('/api/decks/' + deck.id)).json();
        return saved.slides[0].body;
      }).toContain(marker);
      const autosaveWrites = patchRequests - beforePatch;

      const name = run % 2 ? 'notebook' : 'blueprint';
      await page.getByRole('tab',{name:'Дизайн',exact:true}).click();
      await page.locator('.theme-picker-trigger').click();
      const choice = page.locator('.theme-choice').filter({ has: page.locator(`[data-theme="${name}"]`) });
      const theme = await clickToFrame(page, choice.getByRole('radio'), `.ed-stage .ed-slide[data-theme="${name}"]`);
      await expect.poll(async () => {
        const saved: Deck = await (await request.get('/api/decks/' + deck.id)).json();
        return saved.theme;
      }).toBe(name);
      samples.push({ open, input: edit, theme, apiDuringInput, autosaveWrites, skippedFrames });
    }

    const report = {
      language, browser: browser.version(), viewport: desktop, logicalCpus: cpus().length,
      memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)), baselineFrameMs: interval,
      runs: repeats, thresholds,
      totals: {
        open: percentiles(samples.map(({ open }) => open)),
        input: percentiles(samples.map(({ input }) => input)),
        theme: percentiles(samples.map(({ theme }) => theme)),
        apiDuringInput: samples.reduce((sum, sample) => sum + sample.apiDuringInput, 0),
        autosaveWrites: samples.reduce((sum, sample) => sum + sample.autosaveWrites, 0),
        skippedFrames: samples.reduce((sum, sample) => sum + sample.skippedFrames, 0),
      },
      samples,
    };
    await info.attach(`editor-performance-${language}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ ...report, samples: undefined }));
    if (process.env.STUDIO_BENCHMARK_GATE === '1') {
      for (const metric of ['open', 'input', 'theme'] as const) {
        expect.soft(report.totals[metric].p50, `${metric} p50`).toBeLessThanOrEqual(thresholds[metric].p50);
        expect.soft(report.totals[metric].p90, `${metric} p90`).toBeLessThanOrEqual(thresholds[metric].p90);
      }
      expect.soft(report.totals.apiDuringInput, 'requests during manual edits').toBe(0);
      expect.soft(report.totals.skippedFrames, 'missed frame intervals while scrolling').toBe(0);
    }
  });
}
