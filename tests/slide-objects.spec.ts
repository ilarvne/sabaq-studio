import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import type { Deck } from '@sabaq/lesson/types';

test('canvas objects can be edited, moved, saved and downloaded as native PowerPoint objects', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const deck: Deck = await (await request.post('/api/decks', { data: {
    topic: 'Classroom experiment', template: 'blank', language: 'en', provider: 'fixture', review: false,
  } })).json();
  const url = `/api/decks/${deck.id}`;
  const saved = async () => ((await (await request.get(url)).json()) as Deck).slides[0].objects ?? [];
  await page.goto(`/#/deck/${deck.id}`);
  const canvas = page.locator('.ed-stage');
  const insert = page.getByRole('button', { name: 'Insert', exact: true });

  await insert.click();
  await page.getByRole('menuitem', { name: 'Text box', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Text box' }).fill('Record water temperature');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const text = canvas.getByRole('button', { name: /Text box · Record water temperature/ });
  await expect(text).toBeVisible();
  await expect.poll(async () => (await saved()).length).toBe(1);

  await text.focus();
  await text.press('Shift+ArrowRight');
  await expect.poll(async () => (await saved())[0]?.x).toBe(13);
  await text.press('Enter');
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Text box' }).fill('Record the water temperature');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(canvas.locator('.ed-object-text')).toHaveText('Record the water temperature');

  await insert.click();
  await page.getByRole('menuitem', { name: 'Arrow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  const arrow = canvas.getByRole('button', { name: 'Arrow', exact: true });
  await expect.poll(async () => (await saved()).length).toBe(2);
  const beforeDrag = (await saved()).find(item => item.kind === 'arrow')!;
  const box = (await arrow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 74, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await saved()).find(item => item.kind === 'arrow')?.x ?? 0).toBeGreaterThan(beforeDrag.x);
  const resize = canvas.locator('.ed-slide-object', { has: page.getByRole('button', { name: 'Arrow', exact: true }) }).locator('.ed-object-resize');
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 30, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await saved()).find(item => item.kind === 'arrow')?.w ?? Infinity).toBeLessThan(beforeDrag.w);
  await page.reload();
  await expect(canvas.locator('.ed-object-text')).toHaveText('Record the water temperature');
  await expect(arrow).toBeVisible();

  const download = await request.get(`${url}/export/pptx`);
  expect(download.ok()).toBe(true);
  const pptx = await JSZip.loadAsync(await download.body());
  const xml = await pptx.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('<a:t>Record the water temperature</a:t>');
  expect(xml).toContain('prst="rightArrow"');

  const png = await request.get(`${url}/export/png?slideId=${deck.slides[0].id}`);
  expect(png.ok()).toBe(true);
  expect((await png.body()).subarray(1, 4).toString()).toBe('PNG');
  const pdf = await request.get(`${url}/export/pdf`);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
