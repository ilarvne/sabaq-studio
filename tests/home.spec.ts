import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

async function openEnglishHome(page: Page) {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'What will you teach today?' })).toBeVisible();
}

test('the homepage switches interface language and exposes accessible creation tools', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'kk'));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Жылдам бастау' })).toBeVisible();
  await page.getByRole('button', { name: /Интерфейс тілі/ }).click();
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1, name: 'What will you teach today?' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Presentation brief' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Quick start' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Featured templates' }).getByRole('button')).toHaveCount(5);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter(issue => issue.impact === 'critical' || issue.impact === 'serious')).toEqual([]);
});

test('quick starts open the matching input and featured templates carry their topic into the wizard', async ({ page }) => {
  await openEnglishHome(page);
  await page.getByRole('button', { name: 'Use source material' }).press('Enter');
  await expect(page.getByRole('button', { name: 'A file', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Choose a file')).toHaveAttribute('accept', /\.docx/);

  await page.goBack();
  await page.getByRole('button', { name: 'Import slides' }).click();
  await expect(page.getByRole('button', { name: 'Import slides' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Choose a file')).toHaveAttribute('accept', /\.pptx/);

  await page.goBack();
  await page.getByRole('button', { name: /^The Solar System/ }).click();
  await expect(page.getByRole('heading', { name: 'A few details about your lesson' })).toBeVisible();
  await expect(page.locator('.creation-brief-title')).toHaveText('The Solar System');
});

test('workspace search opens a matching lesson from home with the keyboard', async ({ page }) => {
  await openEnglishHome(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('combobox', { name: 'Search lessons or actions' });
  await expect(search).toBeFocused();
  await search.fill('How do we compare water volumes?');
  await expect(dialog.getByRole('option', { name: 'How do we compare water volumes?' })).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/#\/deck\/schoolyard-en$/);
  await expect(page.locator('.ed-stage')).toBeVisible();
});

test('mobile navigation opens and returns focus, and content fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openEnglishHome(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Generation options'}).click();
  await expect(page.getByRole('button', {name: 'Generate directly'})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'Auto', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  await toggle.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await drawer.getByRole('link', { name: 'My lessons', exact: true }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(drawer).toBeHidden();
});

test('recent lessons show placeholders while loading and resolve to real lessons', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const recents = page.getByRole('region', { name: 'Recent lessons' });
  await page.route('**/api/decks', async route => {
    await pending;
    await route.continue();
  });
  try {
    await openEnglishHome(page);
    await expect(recents).toHaveAttribute('aria-busy', 'true');
    await expect(recents.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Presentation brief' })).toBeEnabled();
  } finally {
    release();
  }
  await expect(recents).toHaveAttribute('aria-busy', 'false');
  await expect(recents.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(recents.locator('a[href^="#/deck/"]').first()).toBeVisible();
});

test('recent lesson navigation expands and wraps long titles without taking over the home cards', async ({ page }) => {
  const longTitle = 'A field guide to comparing volumes with classroom measuring instruments';
  await page.route('**/api/decks', async route => {
    const response = await route.fetch();
    const [sample]: Deck[] = await response.json();
    const recents = Array.from({ length: 9 }, (_, index) => ({
      ...sample,
      id: index === 8 ? sample.id : `recent-navigation-${index}`,
      title: index === 8 ? longTitle : `Lesson ${index + 1}`,
      language: 'en',
      updatedAt: new Date(Date.UTC(2026, 10, index + 1)).toISOString(),
    }));
    await route.fulfill({ response, json: recents });
  });
  await openEnglishHome(page);
  const recents = page.getByRole('navigation', { name: 'Recent lessons' });
  const links = recents.getByRole('link');
  await expect(links).toHaveCount(6);
  const title = links.first().locator('span');
  await expect(title).toHaveText(longTitle);
  await expect(title).toHaveCSS('white-space', 'normal');
  const more = recents.getByRole('button', { name: 'Show more recent lessons' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.press('Enter');
  await expect(links).toHaveCount(9);
  const fewer = recents.getByRole('button', { name: 'Show fewer recent lessons' });
  await expect(fewer).toHaveAttribute('aria-expanded', 'true');
  await expect(fewer).toBeFocused();
  await expect(page.getByRole('region', { name: 'Recent lessons' }).getByRole('link', { name: /^A field guide|^Lesson/ })).toHaveCount(3);
  await expect(page.getByText('Personal workspace', { exact: true })).toHaveCount(0);
  await fewer.press('Enter');
  await expect(links).toHaveCount(6);

  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: longTitle })).toBeVisible();
  await drawer.getByRole('link', { name: longTitle }).click();
  await expect(page).toHaveURL(/#\/deck\//);
  await expect(drawer).toBeHidden();
});

test('the composer border glow runs without hover and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openEnglishHome(page);
  const prompt = page.getByRole('textbox', { name: 'Presentation brief' });
  const glow = page.locator('.border-glow-card').filter({ has: prompt }).locator('.border-glow-decoration');
  const readAngle = () => glow.evaluate(node => getComputedStyle(node).getPropertyValue('--border-glow-angle').trim());
  await expect.poll(() => glow.evaluate(node => node.getAnimations().some(animation =>
    animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity
  ))).toBe(true);
  const initialAngle = await readAngle();
  expect(initialAngle).not.toBe('');
  await expect.poll(readAngle).not.toBe(initialAngle);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prompt.focus();
  await expect(prompt).toBeFocused();
  await expect.poll(() => glow.evaluate(async node => {
    const angle = () => getComputedStyle(node).getPropertyValue('--border-glow-angle').trim();
    const start = angle();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return start === angle();
  })).toBe(true);
});

test('the assistant keeps the brief and source on a rejected submit and generates a custom six-slide fixture deck on retry', async ({ page, request }) => {
  await openEnglishHome(page);
  const brief = 'Compare two methods of measuring rainfall';
  const source = 'The class used two rain gauges. Gauge A collected 12 mm and gauge B collected 16 mm.';
  const input = page.getByRole('textbox', { name: 'Presentation brief' });
  await input.fill(brief);
  const nextFile = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach source material' }).click();
  await (await nextFile).setFiles({ name: 'rainfall.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /^Image-led slides/ }).click();
  await page.getByRole('button', { name: 'Generation options' }).click();
  await page.getByRole('button', { name: 'Exact', exact: true }).click();
  const exactCount = page.getByRole('spinbutton', { name: 'Exact slide count' });
  await exactCount.fill('41');
  await expect(exactCount).toHaveAttribute('aria-invalid', 'true');
  await exactCount.fill('6');
  await expect(page.getByRole('button', { name: 'Review the outline' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Generate directly' }).click();
  await page.keyboard.press('Escape');
  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  await page.route('**/api/decks', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 429, json: { error: 'run_limit' } }) : route.continue());
  await generate.click();
  await expect(page.getByRole('form', { name: 'Presentation brief' }).getByRole('alert')).toContainText('Two lessons are already generating');
  await expect(input).toHaveValue(brief);
  await expect(page.getByText('rainfall.txt', { exact: true })).toBeVisible();
  await page.unroute('**/api/decks');

  const created = page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/decks');
  await input.press('Enter');
  const response = await created;
  expect(response.status()).toBe(201);
  const deck: Deck = await response.json();
  expect(deck).toMatchObject({ topic: brief, language: 'en', provider: 'fixture', imageMode: 'image-led', source: { name: 'rainfall.txt', text: source } });
  await expect(page).toHaveURL(new RegExp('#/deck/' + deck.id + '/grid$'));
  await expect.poll(async () => {
    const result: Deck = await (await request.get('/api/decks/' + deck.id)).json();
    return result.slides.filter(slide => slide.status === 'ready' && slide.layout === 'image-full' && slide.image).length;
  }, { timeout: 20_000 }).toBe(6);
});

test('prompt starters and source notes retain the selected audience, language and generation settings', async ({page}) => {
  const query = 'Renewable energy in schools';
  await page.route('**/api/capabilities', route => route.fulfill({json: {alem: true, localAuthoring: true, researchTopics: [query]}}));
  await page.route('**/api/decks', route => route.request().method() === 'POST'
    ? route.fulfill({status:429, json:{}}) : route.continue());
  await openEnglishHome(page);
  const input = page.getByRole('textbox', {name: 'Presentation brief'});
  await page.getByRole('button', {name:'The water cycle',exact:true}).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/water cycle/i);
  await page.getByRole('button', {name:'Audience',exact:true}).click();
  await page.getByLabel('Other audience').fill('College students');
  await page.getByRole('button', {name:'Apply',exact:true}).click();
  const options = page.getByRole('button', {name:'Generation options'});
  await options.click();
  await page.getByRole('combobox', {name:'Presentation language'}).click();
  await page.getByRole('option', {name:'Русский'}).click();
  await page.getByRole('combobox', {name:'Text generation'}).click();
  await page.getByRole('option', {name:'AlemLLM'}).click();
  await page.getByRole('combobox', {name:'Public sources'}).click();
  await page.getByRole('option', {name:query}).click();
  await expect(page.getByText('Sample mode', {exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  const nextInput = () => page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === '/api/decks');
  const researched = nextInput();
  await page.getByRole('button', {name:'Generate',exact:true}).click();
  const first = (await researched).postDataJSON();
  expect(first).toMatchObject({language:'ru', provider:'fixture', imageMode:'auto', review:true, researchQuery:query, answers:{level:'College students'}});
  expect(first).not.toHaveProperty('slideCount');
  await expect(page.getByRole('form', {name:'Presentation brief'}).getByRole('alert')).toBeVisible();
  const notes = 'Wind measurements\n' + 'Wind speed readings changed throughout the day. '.repeat(18);
  await input.fill(notes);
  await expect(page.getByText('Pasted notes', {exact:true})).toBeVisible();
  const upload = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'Attach source material'}).click();
  await (await upload).setFiles({name:'measurements.txt',mimeType:'text/plain',buffer:Buffer.from('Mean wind speed was 6 m/s.')});
  await expect(page.getByText('Saved in My files', {exact:true})).toBeVisible();
  const grounded = nextInput();
  await page.getByRole('button', {name:'Generate',exact:true}).click();
  const second = (await grounded).postDataJSON();
  expect(second).toMatchObject({topic:'Wind measurements', language:'ru', provider:'local', review:true});
  expect(second.sourceNotes).toBe(notes.trim());
  expect(second.sourceFileIds).toHaveLength(1);
  const saved = await page.request.get('/api/source-files/' + second.sourceFileIds[0]);
  expect(await saved.json()).toMatchObject({name:'measurements.txt',text:'Mean wind speed was 6 m/s.'});
  expect(second).not.toHaveProperty('researchQuery');
});
