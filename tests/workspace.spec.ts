import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('Kazakh text and a chart value survive reopening the lesson', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/deck/schoolyard-kk');
  const stage = page.locator('.ed-stage');
  await expect(stage).toBeVisible();
  const canvas = stage.locator('[data-slide-id=s01]').first();
  await canvas.locator('.ed-slide-body').click();
  const text = canvas.locator('[contenteditable=true]');
  await text.fill('Әр оқушы су көлемін өлшейді.');
  await page.reload();
  await expect(stage).toContainText('Әр оқушы су көлемін өлшейді.');

  await page.locator('.ed-thumb').filter({has:page.locator('[data-slide-id=s06]')}).locator('.ed-thumb-hit').click();
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('textbox',{name:'Category 1, series 1',exact:true}).fill('39');
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.reload();
  await page.locator('.ed-thumb').filter({has:page.locator('[data-slide-id=s06]')}).locator('.ed-thumb-hit').click();
  await expect(stage).toContainText('39');
});

test('outline and generation screens allow editing before the deck completes', async ({page, request}) => {
  await page.goto('/#/library');
  await page.getByRole('button', {name: /Интерфейс тілі/}).click();
  await page.getByRole('menuitemradio',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'New lesson',exact:true}).click();
  await page.getByLabel('Lesson topic',{exact:true}).fill('Water volume demo');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Lesson outline',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lesson outline'})).toBeVisible();
  await page.getByRole('button',{name:'Generate slides',exact:true}).click();
  await page.getByRole('button',{name:/^Open slide 1 ·/}).first().click();
  const path = await page.evaluate(() => location.hash.match(/deck\/([^/]+)/)?.[1]);
  const stage = page.locator('.ed-stage');
  await stage.locator('.ed-slide-body').click();
  await stage.locator('[contenteditable=true]').fill('Су көлемін бірге өлшейік.');
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await expect(page.locator('.generation-page, #editor-overview-navigator')).toBeVisible();
  const read = async () => (await (await request.get('/api/decks/'+path)).json()) as Deck;
  const stop = page.getByRole('button',{name:'Stop generation'});
  if (await stop.isVisible()) {
    await stop.click({timeout:2000}).catch(async error=>{
      if (!(await read()).slides.every(slide=>slide.status==='ready')) throw error;
    });
  }
  const result = await read();
  expect(result.slides[0].body).toBe('Су көлемін бірге өлшейік.');
  expect(result.slides.every(slide=>slide.status==='ready') || result.slides.some(slide=>slide.status==='cancelled')).toBe(true);
});

test('the editor view switch survives grid navigation and keeps the selected slide', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/deck/schoolyard-en');
  const view = page.getByRole('group', {name:'Editor view'});
  const slideView = view.getByRole('button', {name:'Slide',exact:true});
  const gridView = view.getByRole('button', {name:'Grid',exact:true});
  const stage = page.locator('.ed-stage [data-slide-id]').first();
  await page.getByRole('button', {name:/^Slide 2 · /}).click();
  const selectedId = await stage.getAttribute('data-slide-id');
  await gridView.press('Enter');
  await expect(page.locator('#editor-overview-navigator .ed-thumb[aria-current=true] [data-slide-id]')).toHaveAttribute('data-slide-id', selectedId!);
  await expect(gridView).toBeFocused();
  await expect(gridView).toHaveAttribute('aria-pressed','true');
  await slideView.press('Enter');
  await expect(stage).toHaveAttribute('data-slide-id', selectedId!);
  await expect(slideView).toBeFocused();

  await page.setViewportSize({width:320,height:820});
  await page.goto('/#/deck/schoolyard-en/grid');
  await expect(gridView).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button', {name:'Edit slide',exact:true})).toBeInViewport();
  await expect(slideView).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await slideView.click();
  await expect(stage).toBeVisible();
});

test('library and editor work at 375px without a page-level horizontal scroll', async ({page})=>{
  await page.setViewportSize({width:375,height:820});
  await page.goto('/#/library');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect.poll(fits).toBe(true);
  const templates = page.locator('.library-template-start [data-slot=collapsible-trigger]');
  await expect(templates).toHaveAttribute('aria-expanded','false');
  await templates.press('Enter');
  await expect(page.locator('.library-template-actions button')).toHaveCount(3);
  await expect(page.locator('.library-template-actions button').first()).toBeVisible();
  await templates.press('Enter');
  await expect(templates).toHaveAttribute('aria-expanded','false');
  const filters = page.locator('.library-filter-trigger');
  const search = page.locator('.library-toolbar .search-field');
  await expect.poll(async()=>Math.abs((await filters.boundingBox())!.height-(await search.boundingBox())!.height)).toBeLessThan(1);
  await filters.press('Enter');
  const filterSheet = page.getByRole('dialog');
  await expect(filterSheet).toBeVisible();
  await filterSheet.locator('[data-slot=select-trigger]').nth(1).click();
  await page.getByRole('option',{name:'Қазақша'}).click();
  await page.keyboard.press('Escape');
  await expect(filterSheet).toBeHidden();
  await expect(filters).toBeFocused();
  const rows = page.locator('.dashboard-grid > li');
  const sample = rows.filter({has:page.locator('a[href="#/deck/schoolyard-kk"]')});
  await expect(sample).toBeVisible();
  await expect(rows.locator('[lang="en"], [lang="ru"]')).toHaveCount(0);
  await expect.poll(async()=>(await page.locator('.library-grid-cover .ed-slide').first().boundingBox())?.width??0).toBeGreaterThan(40);
  const preview=sample.locator('.library-preview-trigger');
  await preview.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeFocused();
  await page.locator('.dashboard-library a[href="#/deck/schoolyard-kk"]').click();
  await expect(page.locator('.ed-stage')).toBeVisible();
  await expect.poll(fits).toBe(true);
});

test('closing two tabs preserves separate pending slide edits', async ({ context, request }) => {
  const destination = '/#/deck/schoolyard-ru';
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
    await page.route('**/api/decks/schoolyard-ru', route =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );
    await page.goto(destination);
    await expect(page.locator('.ed-stage')).toBeVisible();
  }
  await second.locator('.ed-thumb').filter({has:second.locator('[data-slide-id=s02]')}).locator('.ed-thumb-hit').click();
  await first.getByRole('tab',{name:'Lecture text',exact:true}).click();
  await second.getByRole('tab',{name:'Lecture text',exact:true}).click();
  await first.locator('.inspect-notes textarea').fill('Retained from tab one.');
  await second.locator('.inspect-notes textarea').fill('Retained from tab two.');
  await first.close();
  await second.close();

  const reopened = await context.newPage();
  await reopened.goto(destination);
  await expect.poll(async () => {
    const deck = await (await request.get('/api/decks/schoolyard-ru')).json() as Deck;
    return deck.slides.slice(0,2).map(slide => slide.notes);
  }).toEqual(['Retained from tab one.', 'Retained from tab two.']);
});

test('closing two tabs merges independent fields of the same slide', async ({ context, request }) => {
  const created = await request.post('/api/decks', {
    data: { topic: 'Concurrent title and notes', language: 'en', template: 'blank', provider: 'fixture', review: false },
  });
  expect(created.status()).toBe(201);
  const initial: Deck = await created.json();
  const destination = '/#/deck/' + initial.id;
  const first = await context.newPage();
  const second = await context.newPage();
  for (const tab of [first, second]) {
    await tab.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
    await tab.route('**/api/decks/' + initial.id, route =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue());
    await tab.goto(destination);
    await expect(tab.locator('.ed-stage')).toBeVisible();
  }
  await first.locator('.ed-stage .ed-slide-title').click();
  await first.locator('.ed-stage [contenteditable=true]').fill('A title edited in the first tab');
  await expect(first.locator('.ed-stage')).toContainText('A title edited in the first tab');
  await second.getByRole('tab',{name:'Lecture text',exact:true}).click();
  await second.locator('.inspect-notes textarea').fill('Notes edited in the second tab');
  await Promise.all([first.close(), second.close()]);

  const reopened = await context.newPage();
  await reopened.goto(destination);
  await expect.poll(async () => {
    const deck = await (await request.get('/api/decks/' + initial.id)).json() as Deck;
    return [deck.slides[0].title, deck.slides[0].notes];
  }).toEqual(['A title edited in the first tab', 'Notes edited in the second tab']);
  await expect(reopened.getByText('Saved',{exact:true})).toBeVisible();
});

test('divergent notes recover both versions after closing two tabs', async ({ context, request }) => {
  const created = await request.post('/api/decks', {
    data: { topic: 'Concurrent notes', language: 'en', template: 'blank', provider: 'fixture', review: false },
  });
  expect(created.status()).toBe(201);
  const initial: Deck = await created.json();
  const destination = '/#/deck/' + initial.id;
  const first = await context.newPage();
  const second = await context.newPage();
  for (const tab of [first, second]) {
    await tab.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
    await tab.route('**/api/decks/' + initial.id, route =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue());
    await tab.goto(destination);
    await tab.getByRole('tab',{name:'Lecture text',exact:true}).click();
  }
  await first.locator('.inspect-notes textarea').fill('Draw a line at eye level.');
  await second.locator('.inspect-notes textarea').fill('Draw a line above the ruler.');
  await Promise.all([first.close(), second.close()]);

  const reopened = await context.newPage();
  await reopened.goto(destination);
  const conflict = reopened.getByRole('alert').filter({ hasText: 'Another edit reached this slide first.' });
  await expect(conflict.getByRole('button',{name:'Keep my edit'})).toBeVisible();
  await conflict.getByText('Compare the two edits').click();
  const pending = await conflict.getByRole('textbox',{name:'Speaker notes · Your edit'}).inputValue();
  const saved = await conflict.getByRole('textbox',{name:'Speaker notes · Saved version'}).inputValue();
  expect([pending,saved].sort()).toEqual(['Draw a line above the ruler.', 'Draw a line at eye level.']);
  const current = await (await request.get('/api/decks/' + initial.id)).json() as Deck;
  expect(saved).toBe(current.slides[0].notes);
  await conflict.getByRole('button',{name:'Use saved version'}).click();
  await expect(reopened.getByText('Saved',{exact:true})).toBeVisible();
  const latest = await (await request.get('/api/decks/' + initial.id)).json() as Deck;
  expect(latest.slides[0].notes).toBe(saved);
});

test('sample library and editor serve assets locally and pass critical accessibility checks', async ({page,baseURL,request}) => {
  const outside = new Set<string>();
  page.on('request', request => {
    const origin = new URL(request.url()).origin;
    if (origin !== new URL(baseURL!).origin) outside.add(origin);
  });
  const {default: AxeBuilder} = await import('@axe-core/playwright');
  async function check() {
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  }
  await page.goto('/#/library');
  const sample = await request.get('/api/decks/schoolyard-kk');
  expect(sample.ok()).toBe(true);
  const { title } = await sample.json() as Deck;
  await page.getByRole('searchbox').fill(title);
  const lesson = page.locator('.dashboard-library a[href="#/deck/schoolyard-kk"]');
  await expect(lesson).toBeVisible();
  await check();
  await lesson.click();
  await expect(page.locator('.ed-stage')).toBeVisible();
  await check();
  expect([...outside]).toEqual([]);
});

test('the library remembers list view and can recover from an empty search', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/library');
  await page.getByRole('button',{name:'Grid view',exact:true}).click();
  await expect(page.locator('.dashboard-grid .lesson-card').first()).toBeVisible();
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await expect(page.locator('.lesson-list')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'List view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('searchbox',{name:'Search lessons'}).fill('no match for this sentence');
  await expect(page.getByText('No lessons match your search.')).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).click();
  await expect(page.locator('.lesson-list .library-row-link').first()).toBeVisible();
  await page.getByRole('searchbox',{name:'Search lessons'}).fill('How do we compare water volumes?');
  const preview=page.locator('.library-preview-panel');
  const row=page.locator('.lesson-list [role=listitem]').filter({has:page.locator('a[href="#/deck/schoolyard-en"]')});
  await row.getByRole('button',{name:/Preview lesson/}).click();
  await expect(preview.getByRole('heading',{name:'How do we compare water volumes?'})).toBeVisible();
  await preview.getByRole('button',{name:'Next slide',exact:true}).click();
  await expect(preview.getByText('2 / 10')).toBeVisible();
});

test('the library can preview and present a recent lesson and resume the last opened lesson', async ({page,request})=>{
  const created = await request.post('/api/decks',{data:{topic:'Classroom presentation about comparing the quantities of water collected from different sources',language:'en',provider:'fixture',review:false,template:'blank'}});
  expect(created.status()).toBe(201);
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/library');
  const createdDeck = await created.json() as Deck;
  const createdCard = page.locator('.library-grid-item').filter({has:page.locator('a[href="#/deck/'+createdDeck.id+'"]')});
  await expect(createdCard).toBeVisible();
  const cards = await page.locator('.library-grid-item').evaluateAll(items => items.map(item => {
    const cover = item.querySelector('.library-grid-cover')!.getBoundingClientRect();
    const title = item.querySelector('h3')!.getBoundingClientRect();
    const meta = item.querySelector('.library-grid-caption p')!.getBoundingClientRect();
    return {x:cover.x, y:cover.y, ratio:cover.width/cover.height, title:title.y, meta:meta.y};
  }));
  expect(cards.length).toBeGreaterThan(1);
  expect(cards[1].x).toBeGreaterThan(cards[0].x);
  for (const [index,card] of cards.entries()) {
    expect(card.ratio).toBeCloseTo(16/9,2);
    const previous = cards[index-1];
    if (previous && card.x>previous.x) {
      expect(card.y).toBeCloseTo(previous.y,0);
      expect(card.title).toBeCloseTo(previous.title,0);
      expect(card.meta).toBeCloseTo(previous.meta,0);
    }
  }
  await createdCard.getByRole('button',{name:/Preview lesson/}).click();
  const recent=page.locator('.library-recent');
  await expect(recent.getByText('Latest lesson',{exact:true})).toBeVisible();
  const present=recent.getByRole('link',{name:'Present'});
  await expect(present).toBeVisible();
  await expect(recent.getByRole('heading',{name:createdDeck.title})).toBeVisible();
  await expect(present).toHaveAttribute('href','#/deck/'+createdDeck.id+'/present');
  await present.click();
  await expect(page).toHaveURL(/\/present$/);
  await expect(page.locator('.reveal')).toBeVisible();
  await page.goto('/#/deck/schoolyard-en');
  await expect(page.locator('.ed-stage')).toBeVisible();
  await page.goto('/#/library');
  await page.locator('.library-grid-item').filter({has:page.locator('a[href="#/deck/schoolyard-en"]')})
    .getByRole('button',{name:/Preview lesson/}).click();
  await expect(recent.getByText('Continue working',{exact:true})).toBeVisible();
  await expect(recent.getByRole('link',{name:'Continue editing'})).toHaveAttribute('href','#/deck/schoolyard-en');
});

test('Alem is offered for topics and source material uses the local provider', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.route('**/api/capabilities', route => route.fulfill({json:{alem:true}}));
  await page.goto('/#/library');
  await page.getByRole('button',{name:'New lesson',exact:true}).click();
  const alem = page.getByRole('radio',{name:'AlemLLM'});
  await expect(alem).toBeChecked();
  await page.getByRole('button',{name:'A file',exact:true}).click();
  await expect(alem).toBeDisabled();
  await expect(page.getByRole('radio',{name:'Sample mode'})).toBeChecked();
  await page.getByRole('button',{name:'A topic',exact:true}).click();
  await expect(alem).toBeChecked();
});

test('imports a document into the source field and a raster page into the editor', async ({ page }) => {
  const { default: JSZip } = await import('jszip');
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/start');
  await page.getByRole('button', { name: 'A file', exact: true }).click();
  const docx = new JSZip();
  docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Өсімдік 12.5 см өсті.</w:t></w:r></w:p></w:body></w:document>');
  await page.locator('#source-file').setInputFiles({ name: 'Observation.docx', mimeType: 'application/octet-stream', buffer: await docx.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#source-text')).toHaveValue('Өсімдік 12.5 см өсті.');
  await page.getByRole('button', { name: 'Import slides', exact: true }).click();
  await page.locator('#source-file').setInputFiles('apps/web/public/assets/seedling-growth.webp');
  const rasterRequest = page.waitForRequest(req => new URL(req.url()).pathname === '/api/import/slides');
  await page.getByRole('button', { name: 'Import file', exact: true }).click();
  expect(new URL((await rasterRequest).url()).searchParams.has('mode')).toBe(false);
  await expect(page.locator('.ed-stage .ed-imported-page img')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.locator('.ed-stage .ed-imported-page img')).toHaveAttribute('src', /^\/api\/media\/[0-9a-f]{64}\.png$/);
});

test('imports editable PowerPoint text over complex artwork with source positions', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/start');
  await page.getByRole('button', { name: 'Import slides', exact: true }).click();
  await page.locator('#source-file').setInputFiles(fileURLToPath(new URL('./fixtures/import-challenge.pptx', import.meta.url)));
  const editable = page.getByRole('checkbox', { name: 'Import editable PowerPoint slides' });
  await expect(editable).not.toBeChecked();
  await editable.click();
  await expect(editable).toBeChecked();
  const pptxRequest = page.waitForRequest(req => new URL(req.url()).pathname === '/api/import/slides');
  await page.getByRole('button', { name: 'Import file', exact: true }).click();
  const importQuery = new URL((await pptxRequest).url()).searchParams;
  expect(importQuery.get('format')).toBe('pptx');
  expect(importQuery.get('mode')).toBe('editable');
  await expect(page).toHaveURL(/#\/deck\//, { timeout: 25_000 });
  const id = new URL(page.url()).hash.split('/').at(-1);
  const deck: Deck = await (await request.get('/api/decks/' + id)).json();
  expect(deck.slides[0].importedPage).toBeFalsy();
  expect(deck.slides[0].title).toBe('FIELD_ORIGINAL');
  expect(deck.slides[0].importedArtwork).toMatch(/^\/api\/media\/[0-9a-f]{64}\.png$/);
  expect(deck.slides[0].table?.rows.length).toBeGreaterThan(0);
  await expect(page.locator('.ed-stage .ed-imported-artwork')).toBeVisible();
  expect(deck.slides[1].importedPage).toBeFalsy();
  expect(deck.slides[1].title).toBe('Қол тимеген слайд');
  await page.getByRole('button', { name: /^Slide 2 · / }).click();
  await expect(page.locator('.ed-stage .ed-slide-title')).toHaveText('Қол тимеген слайд');
});
