import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

async function openEnglishHome(page: Page) {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'What will you teach today?' })).toBeVisible();
}

async function uploadHomeFile(page: Page, name: string, text: string) {
  await page.getByRole('button', {name:'Attach source material',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Add files'});
  await dialog.getByRole('tab',{name:'Upload',exact:true}).click();
  const upload = page.waitForEvent('filechooser');
  await dialog.getByRole('button',{name:'Choose files',exact:true}).click();
  await (await upload).setFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});
  await dialog.getByRole('button',{name:'Use selected files'}).click();
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
  await expect(page.getByRole('heading', { name: 'Shape the lesson' })).toBeVisible();
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

test('the sidebar keeps lesson navigation and preferences accessible across breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEnglishHome(page);
  const navigation = page.locator('.creation-nav-layout');
  const demoControls = navigation.getByRole('button', { name: /Sabaq Studio|Teaching team|Alex Morgan|Profile menu/ });
  await expect(navigation.getByRole('button', { name: 'New lesson', exact: true })).toBeVisible();
  await expect(demoControls).toHaveCount(0);

  const html = page.locator('html');
  await page.getByRole('button', { name: 'Light mode', exact: true }).press('Enter');
  await expect(html).toHaveAttribute('data-appearance', 'light');
  await page.getByRole('button', { name: /Interface language/ }).press('Enter');
  await page.getByRole('menuitemradio', { name: 'Русский', exact: true }).click();
  await expect(html).toHaveAttribute('lang', 'ru');

  await page.setViewportSize({ width: 375, height: 812 });
  const toggle = page.getByRole('button', { name: 'Открыть или закрыть меню' });
  await toggle.click();
  const drawer = page.getByRole('dialog', { name: 'Рабочая область', exact: true });
  await expect(drawer.getByRole('button', { name: 'Новый урок', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Sabaq Studio|Команда учителей|Алекс Морган|Меню профиля/ })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Закрыть', exact: true }).press('Enter');
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.getByRole('button', { name: 'Тёмная тема', exact: true }).press('Enter');
  await expect(html).toHaveAttribute('data-appearance', 'dark');
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
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Studio guide', exact: true })).toHaveCount(0);
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
    const placeholder=recents.locator('[data-slot="skeleton"]').first();
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveCSS('animation-name','none');
    await expect(page.getByRole('textbox', { name: 'Presentation brief' })).toBeEnabled();
  } finally {
    release();
  }
  await expect(recents).toHaveAttribute('aria-busy', 'false');
  await expect(recents.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(recents.locator('a[href^="#/deck/"]').first()).toBeVisible();
});

test('recent lesson navigation expands and wraps long titles without taking over the home cards', async ({ page, request }) => {
  const longTitle = 'A field guide to comparing volumes with classroom measuring instruments';
  const sample: Deck = await (await request.get('/api/decks/schoolyard-en')).json();
  await page.route('**/api/decks', async route => {
    const response = await route.fetch();
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
  const disclosure = recents.getByRole('button', { name: 'Recent lessons', exact: true });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
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
  const lessonRow = await links.first().boundingBox();
  const disclosureRow = await fewer.boundingBox();
  expect(Math.abs(disclosureRow!.x - lessonRow!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(disclosureRow!.width - lessonRow!.width)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('region', { name: 'Recent lessons' }).getByRole('link', { name: /^A field guide|^Lesson/ })).toHaveCount(3);
  await expect(page.getByText('Personal workspace', { exact: true })).toHaveCount(0);
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toBeFocused();
  await expect(recents.getByRole('link', { name: longTitle, exact: true })).toBeHidden();
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(links).toHaveCount(9);
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

test('the focused composer uses one frame when feedback expands it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/decks', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 429, json: { error: 'run_limit' } }) : route.continue());
  await openEnglishHome(page);

  const input = page.getByRole('textbox', { name: 'Presentation brief' });
  const form = page.getByRole('form', { name: 'Presentation brief' });
  const frame = page.locator('.border-glow-card').filter({ has: input });
  const idleColor = await frame.evaluate(node => getComputedStyle(node).borderTopColor);
  await input.fill('Compare two methods of measuring rainfall');
  await input.press('Enter');
  await expect(form.getByRole('alert')).toBeVisible();
  await input.focus();
  await expect(input).toBeFocused();
  await expect(form).toHaveCSS('outline-style', 'none');
  await expect(frame).not.toHaveCSS('border-top-color', idleColor);

  await page.keyboard.press('Tab');
  await expect(form.locator('.home-prompt-attach')).toBeFocused();
  await expect(frame).toHaveCSS('border-top-color', idleColor);
});

test('the assistant keeps the brief and source on a rejected submit and generates a custom six-slide fixture deck on retry', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openEnglishHome(page);
  const brief = 'Compare two methods of measuring rainfall';
  const source = 'The class used two rain gauges. Gauge A collected 12 mm and gauge B collected 16 mm.';
  const input = page.getByRole('textbox', { name: 'Presentation brief' });
  await input.fill(brief);
  await uploadHomeFile(page, 'rainfall.txt', source);
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
  expect(response.request().postDataJSON()).toMatchObject({ imageMode: 'image-led', slideCount: 6 });
  const deck: Deck = await response.json();
  expect(deck).toMatchObject({ topic: brief, language: 'en', provider: 'fixture', imageMode: 'image-led', source: { name: 'rainfall.txt', text: source } });
  await expect(page).toHaveURL(new RegExp('#/deck/' + deck.id + '/grid$'));
  await expect.poll(async () => {
    const result: Deck = await (await request.get('/api/decks/' + deck.id)).json();
    return {
      total: result.slides.length,
      readyWithText: result.slides.filter(slide => slide.status === 'ready' && slide.body.trim()).length,
      withImages: result.slides.filter(slide => slide.image || slide.additionalImages?.length).length,
    };
  }, { timeout: 20_000 }).toEqual({ total: 6, readyWithText: 6, withImages: 0 });
});

test('prompt starters and source notes retain the selected audience, language and generation settings', async ({page}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await uploadHomeFile(page, 'measurements.txt', 'Mean wind speed was 6 m/s.');
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

test('the home prompt switches web research on, changes depth, and turns it off for the next request', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/capabilities', route =>
    route.fulfill({json:{alem:true, localAuthoring:true, assistantWebResearch:true}}));
  await page.route('**/api/decks', route =>
    route.request().method() === 'POST' ? route.fulfill({status:429,json:{}}) : route.continue());
  await openEnglishHome(page);

  const input = page.getByRole('textbox',{name:'Presentation brief'});
  const toggle = page.getByRole('switch',{name:'Search the web'});
  const depth = page.getByRole('button',{name:'Deep research',exact:true});
  const web = page.getByRole('button',{name:/^Web tools/});
  await web.click();
  await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(depth).toBeDisabled();
  await toggle.click();
  await depth.click();
  await expect(depth).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect(web).toHaveAccessibleName('Web tools · Deep research');
  await page.getByRole('button',{name:'Generation options'}).click();
  const options = page.locator('.home-settings-popup');
  await expect(options.getByText('AlemLLM',{exact:true})).toBeVisible();
  await expect(options.getByText('Exa',{exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  const topic = 'Compare solar and lunar eclipses';
  await input.fill(topic);
  const post = () => page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === '/api/decks');
  const first = post();
  await input.press('Enter');
  expect((await first).postDataJSON()).toMatchObject({topic, provider:'alem', webResearch:'research'});
  await expect(page.getByRole('form',{name:'Presentation brief'}).getByRole('alert')).toBeVisible();

  await web.click();
  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(web).toHaveAccessibleName('Web tools');
  const second = post();
  await input.press('Enter');
  const standard = (await second).postDataJSON();
  expect(standard).toMatchObject({topic, provider:'alem'});
  expect(standard).not.toHaveProperty('webResearch');
});
