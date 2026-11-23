import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
import type { Deck, SlideChanges } from '@sabaq/lesson/types';

async function createDataSlide(request: APIRequestContext, changes: SlideChanges) {
  const created = await request.post('/api/decks', {data: {
    topic: 'Data editor', template: 'blank', language: 'en', provider: 'fixture', review: false,
  }});
  expect(created.status()).toBe(201);
  const deck: Deck = await created.json();
  const slide = deck.slides[0];
  const url = '/api/decks/' + deck.id;
  const updated = await request.patch(url, {data: {op: {
    kind: 'slide', slideId: slide.id, baseVersion: slide.version, changes,
  }}});
  expect(updated.ok()).toBe(true);
  return {url, read: async () => ((await (await request.get(url)).json()) as Deck).slides[0]};
}

async function paste(field: Locator, text: string) {
  await field.evaluate((input, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', content);
    input.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData}));
  }, text);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
});

test('chart edits update the canvas before autosave and keep invalid drafts out of storage', async ({page, request}) => {
  const {url, read} = await createDataSlide(request, {chart: {categories: ['First'], series: [{name: 'A', values: [12]}], alt: 'Original chart'}});
  await page.goto('/#' + url.replace('/api/decks/', '/deck/'));
  await page.getByRole('tab', {name: 'Design', exact: true}).click();
  const region = page.getByRole('region', {name: 'Chart data', exact: true});
  const field = (name: string) => region.getByRole('textbox', {name, exact: true});
  const chart = page.locator('.ed-stage .ed-slide-chart');
  const value = field('Category 1, series 1');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**' + url, async route => {
    if (route.request().method() === 'PATCH') await hold;
    await route.continue();
  });
  try {
    await value.fill('-4,5');
    await expect(chart.locator('.ed-chart-column b')).toHaveText('-4.5');
    expect((await read()).chart!.series[0].values).toEqual([12]);
  } finally { release(); }
  await expect.poll(async () => (await read()).chart!.series[0].values).toEqual([-4.5]);
  await value.fill('1e');
  await expect(value).toHaveAttribute('aria-invalid', 'true');
  await field('Category 1').focus();
  await expect(value).toHaveValue('-4.5');

  await region.getByRole('button', {name: 'Add category'}).click();
  await region.getByRole('button', {name: 'Add series'}).click();
  await field('Series 2').fill('Second series');
  await field('Category 2').fill('Final category');
  await field('Category 2, series 2').fill('38');
  await field('Chart description').fill('Updated chart description');
  await expect(chart.getByRole('img', {name: 'Updated chart description'})).toBeVisible();
  await expect(chart.locator('figcaption')).toContainText('Second series');
  await expect(chart.locator('.ed-chart-labels')).toContainText('Final category');

  const first = field('Category 1');
  await paste(first, 'New category\t11\tinvalid');
  await expect(region.getByRole('alert')).toContainText('finite number');
  await expect(first).toHaveValue('First');
  await paste(first, 'New category\t11\t12');
  await expect(first).toHaveValue('New category');
  await expect(region.getByRole('alert')).toHaveCount(0);
  await region.getByRole('button', {name: 'Remove category 1'}).click();
  await region.getByRole('button', {name: 'Remove series 1'}).click();
  await expect(region.getByRole('button', {name: 'Remove series 1'})).toBeDisabled();
  await expect(region.getByRole('button', {name: 'Remove category 1'})).toBeDisabled();
  await expect.poll(async () => (await read()).chart).toEqual({
    categories: ['Final category'], series: [{name: 'Second series', values: [38]}], alt: 'Updated chart description',
  });
});

test('table data can be pasted and resized from the inspector on a phone', async ({page, request}) => {
  await page.setViewportSize({width: 375, height: 812});
  const {url, read} = await createDataSlide(request, {table: {headers: ['Code', 'Amount'], rows: [['001', 9]]}});
  await page.goto('/#' + url.replace('/api/decks/', '/deck/'));
  await page.getByRole('tab', {name: 'Design', exact: true}).click();
  const region = page.getByRole('region', {name: 'Table data', exact: true});
  const field = (name: string) => region.getByRole('textbox', {name, exact: true});
  await paste(field('Column 1'), 'Code\tCount\tUnit\r\n002\t7\tm\r\n003\t13\tcm\r\n');
  const table = page.locator('.ed-stage .ed-slide-table');
  await expect(table.locator('thead th')).toHaveText(['Code', 'Count', 'Unit']);
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['002', '7', 'm']);
  await expect.poll(async () => (await read()).table!.rows[0]).toEqual(['002', 7, 'm']);
  await region.getByRole('button', {name: 'Add row'}).click();
  await region.getByRole('button', {name: 'Add column'}).click();
  await expect(field('Row 3, column 4')).toBeEditable();
  await region.getByRole('button', {name: 'Remove row 2'}).click();
  await region.getByRole('button', {name: 'Remove column 4'}).click();
  await field('Row 2, column 3').fill('km');
  await expect.poll(async () => (await read()).table).toEqual({headers: ['Code', 'Count', 'Unit'], rows: [['002', 7, 'm'], ['', '', 'km']]});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await page.reload();
  await expect(table.locator('tbody tr').last().locator('td').last()).toHaveText('km');
});
