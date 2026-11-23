import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('the saved appearance is applied before hydration and the language menu contains only languages', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const html = page.locator('html');
  const themeColor = page.locator('meta[name="theme-color"]');
  const language = page.getByRole('button', { name: 'EN · Interface language · English', exact: true });

  for (const appearance of ['dark', 'light'] as const) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/_next\/[^?]+\.js(?:\?|$)/, async route => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expect(html).toHaveAttribute('data-appearance', appearance);
      await expect(themeColor).toHaveAttribute('content', appearance === 'dark' ? '#09090b' : '#ffffff');
      await expect.poll(() => html.evaluate(el => getComputedStyle(el).colorScheme)).toBe(appearance);
      await expect(language).toHaveCount(0);
    } finally {
      release();
    }

    await expect(language).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(html).toHaveAttribute('data-appearance', appearance);
    if (appearance === 'dark') {
      await language.click();
      const choices = page.getByRole('menuitemradio');
      await expect(choices).toHaveText(['Қазақша', 'Русский', 'English']);
      await expect(choices.last()).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(language).toBeFocused();
      await page.getByRole('button', { name: 'Light mode', exact: true }).click();
      await expect(html).toHaveAttribute('data-appearance', 'light');
    }
  }

  await page.goto('/#/deck/schoolyard-en');
  await language.click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(3);
  await page.getByRole('menuitemradio', { name: 'Русский' }).click();
  await expect(html).toHaveAttribute('lang', 'ru');
  await expect(html).toHaveAttribute('data-appearance', 'light');
  const visibleLabel = await new AxeBuilder({ page }).include('.creation-preferences').withRules('label-content-name-mismatch').analyze();
  expect(visibleLabel.violations).toEqual([]);
});
