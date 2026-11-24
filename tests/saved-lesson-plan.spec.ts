import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('a directly generated lesson keeps its saved plan available after reopening', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 820 });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const response = await request.post('/api/decks', { data: {
    topic: 'Recording changes in a classroom garden',
    language: 'en', provider: 'fixture', imageMode: 'none', slideCount: 4, review: false,
  } });
  expect(response.status()).toBe(201);
  const { id }: Deck = await response.json();
  const read = async (): Promise<Deck> => (await request.get('/api/decks/' + id)).json();
  await expect.poll(async () => {
    const deck = await read();
    return deck.slides.filter(slide => slide.status === 'ready').length;
  }, { timeout: 20_000 }).toBe(4);
  const deck = await read();
  await page.goto('/#/deck/' + id);
  await expect(page.locator('.ed-stage')).toBeVisible({ timeout:15_000 });
  await page.reload();
  const menu = page.getByRole('button', { name: 'Lesson actions' });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Lesson plan' }).click();
  const plan = page.getByRole('dialog', { name: 'Lesson plan' });
  await expect(plan.getByRole('heading', { name: 'Lesson plan' })).toBeFocused();
  await expect(plan.getByRole('heading', { level: 3 })).toHaveText(deck.outline.map(item => item.title));
  const first = plan.getByRole('listitem').first();
  await expect(first).toContainText(deck.outline[0].summary);
  await expect(first).toContainText('Layout Cover');
  await first.getByText('Slide details', { exact: true }).click();
  await expect(first.getByText(deck.outline[0].narrationDraft!, { exact: true }).last()).toBeVisible();
  expect(await plan.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(plan).toBeHidden();
  await expect(menu).toBeFocused();
});
