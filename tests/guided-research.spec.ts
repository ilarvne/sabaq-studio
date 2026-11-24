import { expect, test } from '@playwright/test';

test('guided creation carries the chosen research depth into the lesson request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.route('**/api/capabilities', route =>
    route.fulfill({ json: { assistantWebResearch: true, alem: true } }),
  );
  await page.route('**/api/decks', route =>
    route.request().method() === 'POST' ? route.fulfill({ status: 429, json: {} }) : route.continue(),
  );
  await page.goto('/#/start/topic');

  const web = page.getByRole('button', { name: /^Web tools/ });
  const topic = page.getByRole('textbox', { name: 'Lesson topic' });
  const brief = 'How do clouds form?';
  await topic.fill(brief);
  await web.click();
  const toggle = page.getByRole('switch', { name: 'Search the web', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.getByRole('button', { name: 'Deep research', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(web).toHaveAccessibleName(/Deep research/);

  const request = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/decks');
  await page.getByRole('button', { name: 'Create outline', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ topic: brief, provider: 'alem', webResearch: 'research' });

  await page.getByRole('button', { name: 'Edit brief', exact: true }).click();
  await page.getByRole('button', { name: 'A file', exact: true }).click();
  await expect(web).toHaveCount(0);
  await page.getByRole('button', { name: 'A topic', exact: true }).click();
  await expect(web).toHaveAccessibleName('Web tools');
});
