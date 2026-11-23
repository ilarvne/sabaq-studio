import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('filmstrip drag commits one reorder and keeps the selected slide', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const created = await request.post('/api/decks', {
    data: { topic: 'Paper polygons', language: 'en', provider: 'fixture', template: 'blank', review: false },
  });
  expect(created.status()).toBe(201);
  const deckUrl = '/api/decks/' + ((await created.json()) as Deck).id;
  const getDeck = async (): Promise<Deck> => (await request.get(deckUrl)).json();
  for (let i = 0; i < 3; i++) {
    expect((await request.patch(deckUrl, { data: { op: { kind: 'add' } } })).ok()).toBe(true);
  }
  const initial = await getDeck();
  const original = initial.slides.map((slide) => slide.id);
  const expected = [original[1], original[2], original[0], ...original.slice(3)];
  await page.goto('/#/deck/' + initial.id);
  const navigator = page.locator('.ed-thumb-list');
  const thumbs = navigator.locator('.ed-thumb');
  const handle = thumbs.first().locator('.ed-slide-grip');
  await expect(handle).toBeVisible();
  let reorders = 0;
  page.on('request', (req) => {
    if (
      req.method() === 'PATCH' &&
      new URL(req.url()).pathname === deckUrl &&
      req.postDataJSON()?.op?.kind === 'reorder'
    )
      reorders++;
  });
  const start = (await handle.boundingBox())!;
  const end = (await thumbs.nth(2).boundingBox())!;
  const point = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 12, { steps: 4 });
  await expect(navigator.locator('.ed-thumb[data-dragging]').first()).toBeAttached();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height * 0.8, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await getDeck()).slides.map((slide) => slide.id)).toEqual(expected);
  expect(reorders).toBe(1);
  await expect(navigator.locator('.ed-thumb[aria-current] article')).toHaveAttribute(
    'data-slide-id',
    original[0],
  );
  await expect(page.locator('.ed-sr[role=status]')).toContainText('Moved to slide 3');
  await navigator.locator('.ed-thumb[aria-current] .ed-thumb-hit').press('ArrowDown');
  await expect(navigator.locator('.ed-thumb[aria-current] article')).toHaveAttribute(
    'data-slide-id',
    original[3],
  );
  expect((await getDeck()).revision).toBe(initial.revision + 1);
});
