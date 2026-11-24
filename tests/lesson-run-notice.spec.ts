import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('a lesson completed in the background updates the library and preserves keyboard focus', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const response = await request.get('/api/decks/schoolyard-en');
  expect(response.ok()).toBe(true);
  const sample: Deck = await response.json();
  const fixture = { ...sample, id:'background-generation', title:'Compare water in the school garden' };
  let deck: Deck = {
    ...fixture, revision:sample.revision+1, phase:'generating',
    slides:fixture.slides.map((slide, index) => ({ ...slide, status:index === 0 ? 'ready' : 'pending' })),
  };
  await page.route('**/api/decks', route => route.fulfill({ json:[deck] }));
  await page.route('**/api/decks/' + fixture.id, route => route.fulfill({ json:deck }));
  await page.route('**/api/decks/' + fixture.id + '/events', route => route.abort());
  await page.goto('/#/library');
  const card = page.locator('.lesson-card').first();
  await expect(card).toBeVisible();
  await expect(page).toHaveTitle('Creating… · Sabaq Studio');
  const search = page.getByRole('searchbox', { name:'Search lessons' });
  await search.focus();

  deck = { ...fixture, revision:deck.revision+1, phase:'editing' };
  const notice = page.locator('.studio-status').getByRole('status');
  await expect(notice).toHaveText('Lesson ready · ' + fixture.title);
  await expect(search).toBeFocused();
  await expect(page).toHaveTitle('Ready · Sabaq Studio');
  await expect(card.getByText('Ready', { exact:true })).toBeVisible();
  await page.locator('.studio-status').getByRole('link', { name:'Open lesson' }).click();
  await expect(page).toHaveURL(/#\/deck\/background-generation$/);
  await expect(page.locator('.ed-stage')).toBeVisible();
  await expect(notice).toBeEmpty();
});

test('the phone library keeps cached lessons visible offline and refreshes on reconnect', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.setViewportSize({ width:375, height:820 });
  await page.goto('/#/library');
  const first = page.locator('.lesson-card').first();
  await expect(first).toBeVisible();
  try {
    await context.setOffline(true);
    const notice = page.locator('.studio-status').getByRole('status');
    await expect(notice).toHaveText('Offline. Some actions require a connection.');
    await expect(first).toBeVisible();
    await expect(page.locator('.dashboard-library [data-slot=skeleton]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const refreshed = page.waitForResponse(response => response.url().endsWith('/api/decks') && response.ok());
    await context.setOffline(false);
    await refreshed;
    await expect(notice).toBeEmpty();
    await expect(first).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
