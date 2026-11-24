import { expect, test, type Locator, type Page } from '@playwright/test';

const canvas = (page: Page) => page.locator('.ed-stage');
const slide = (page: Page) => canvas(page).locator('.ed-stage-wrap > .ed-slide');
const zoom = (page: Page) => page.getByRole('combobox', { name: 'Canvas zoom' });

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible canvas element');
  return box;
}

async function controlWheel(page: Page, delta: number) {
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, delta);
  } finally {
    await page.keyboard.up('Control');
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/deck/schoolyard-en');
  await expect(slide(page)).toBeVisible();
});

test('middle drag pans from editable text and Fit recenters the slide', async ({ page }) => {
  await slide(page).locator('[data-slot-entry=title]').click();
  const editor = slide(page).getByRole('textbox', { name: 'Slide title', exact: true });
  await expect(editor).toBeFocused();
  const title = await editor.innerText();
  const before = await bounds(slide(page));
  const source = await bounds(editor);
  const x = source.x + Math.min(32, source.width / 2);
  const y = source.y + source.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 75, y + 50, { steps: 5 });
  await page.mouse.up({ button: 'middle' });

  await expect.poll(async () => (await bounds(slide(page))).x).toBeGreaterThan(before.x + 40);
  await expect.poll(async () => (await bounds(slide(page))).y).toBeGreaterThan(before.y + 25);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(title);
  const panned = await bounds(slide(page));
  await page.mouse.move(x + 135, y + 80);
  await expect.poll(async () => {
    const box = await bounds(slide(page));
    return Math.hypot(box.x - panned.x, box.y - panned.y);
  }).toBeLessThan(2);

  await zoom(page).click();
  await page.getByRole('option', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => {
    const [viewport, drawing] = await Promise.all([bounds(canvas(page)), bounds(slide(page))]);
    return Math.hypot(drawing.x + drawing.width / 2 - viewport.x - viewport.width / 2,
      drawing.y + drawing.height / 2 - viewport.y - viewport.height / 2);
  }).toBeLessThan(3);
});

test('Ctrl-wheel zoom follows the cursor and stays inside the canvas', async ({ page }) => {
  const drawing = slide(page);
  const initial = await bounds(drawing);
  const xFraction = 0.28;
  const yFraction = 0.37;
  const x = initial.x + initial.width * xFraction;
  const y = initial.y + initial.height * yFraction;

  await page.mouse.move(x, y);
  await controlWheel(page, -120);
  await expect.poll(async () => (await bounds(drawing)).width).toBeGreaterThan(initial.width + 15);
  await expect.poll(async () => {
    const box = await bounds(drawing);
    return Math.hypot(box.x + box.width * xFraction - x, box.y + box.height * yFraction - y);
  }).toBeLessThan(4);
  const enlarged = await bounds(drawing);

  const plainWheelAllowed = await canvas(page).evaluate(node =>
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })));
  expect(plainWheelAllowed).toBe(true);
  const inspectorWheelAllowed = await page.locator('.ed-inspector').evaluate(node =>
    node.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true })));
  expect(inspectorWheelAllowed).toBe(true);
  expect((await bounds(drawing)).width).toBeCloseTo(enlarged.width, 0);

  await controlWheel(page, 120);
  await expect.poll(async () => (await bounds(drawing)).width).toBeLessThan(enlarged.width - 15);
});
