import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Deck } from '@sabaq/lesson/types';

test('a teacher edits and styles the outline, then pauses and resumes the visual storyboard', async ({ page, request }) => {
  test.setTimeout(65_000);
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const created = await request.post('/api/decks', { data: {
    topic: 'Sketching a courtyard garden', language: 'en', provider: 'fixture', review: true, slideCount: 9,
  } });
  expect(created.status()).toBe(201);
  const { id }: Deck = await created.json();
  const read = async () => (await (await request.get('/api/decks/' + id)).json()) as Deck;
  await page.goto('/#/deck/' + id + '/grid');
  const outline = page.getByRole('main');
  const generate = outline.getByRole('button', { name: 'Generate slides' });
  await expect(generate).toBeEnabled({ timeout: 20_000 });
  await outline.getByRole('textbox', { name: 'Slide title 1', exact: true }).fill('Observe the courtyard');
  await outline.getByRole('textbox', { name: 'What this slide covers 1', exact: true }).fill('Name two features of the garden.');
  await outline.getByRole('button', { name: /Deck theme/ }).click();
  await outline.getByRole('button', { name: 'Preview theme suggestions' }).click();
  const previews = outline.getByRole('group', { name: 'Theme preview' });
  await expect(previews.getByRole('figure')).toHaveCount(3);
  await expect(previews.locator('figure[data-placeholder] figcaption')).toHaveText([
    'Text and imageLayout sample', 'ChartLayout sample',
  ]);
  for (const figure of await previews.getByRole('figure').all()) {
    await expect(figure.locator('.ed-slide-title')).toHaveText('Observe the courtyard');
  }
  const suggestions = outline.getByRole('group', { name: 'Theme suggestions' });
  await expect(suggestions.getByRole('button')).toHaveCount(3);
  await suggestions.getByRole('button', { name: 'Editorial' }).click();
  const sample = outline.getByRole('group', { name: 'Theme preview' });
  await expect(sample).toContainText('Observe the courtyard');
  expect((await read()).theme).toBe('notebook');
  await outline.getByRole('button', { name: 'Apply previewed theme' }).click();
  await expect.poll(async () => (await read()).theme).toBe('editorial');
  await outline.getByRole('radio', { name: 'Blueprint' }).click();
  await expect.poll(async () => (await read()).theme).toBe('blueprint');
  await outline.getByRole('button', { name: /Deck theme/ }).click();
  await outline.getByRole('button', { name: 'Slide actions 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(outline.getByRole('textbox', { name: 'Slide title 2', exact: true })).toHaveValue('Observe the courtyard');
  await outline.getByRole('button', { name: 'Undo outline change' }).click();
  await expect(outline.getByRole('textbox', { name: 'Slide title 1', exact: true })).toHaveValue('Observe the courtyard');
  await outline.getByRole('button', { name: 'Add slide', exact: true }).click();
  await expect(outline.getByRole('textbox', { name: 'Slide title 10', exact: true })).toBeFocused();
  await outline.getByRole('textbox', { name: 'Slide title 10', exact: true }).fill('Garden reflection');
  await expect.poll(async () => (await read()).outline.at(-1)?.title).toBe('Garden reflection');
  const axe = await new AxeBuilder({ page }).include('.wb-outline').analyze();
  expect(axe.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  await generate.click();
  await expect(page.getByRole('progressbar', { name: 'Generation progress' })).toBeVisible();
  const ring = page.getByRole('progressbar', { name: 'Generation progress' });
  await expect(ring).toHaveAttribute('aria-valuemax', '10');
  await expect(ring).toHaveAttribute('aria-valuetext', /of 10 slides ready/);
  await expect(page.getByRole('list', { name: 'Slide sequence' }).getByRole('listitem')).toHaveCount(10);
  await expect(page.locator('.wb-generation [id^="workbench-slide-"]')).toHaveCount(10);
  const pending = page.locator('.sb-previews > li[data-status=pending]').last();
  await expect(pending).toContainText('Garden reflection');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  const resume = page.getByRole('button', { name: 'Resume generation' });
  await expect(resume).toBeVisible();
  await page.setViewportSize({ width: 375, height: 815 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => localStorage.setItem('sabaq:dark', '1'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await expect(resume).toBeVisible();
  const storyboardAxe = await new AxeBuilder({ page }).include('.wb-generation').analyze();
  expect(storyboardAxe.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  const resumed = page.waitForResponse(response => response.url().endsWith('/generate') && response.request().method() === 'POST');
  await resume.press('Enter');
  expect((await resumed).ok()).toBe(true);
  await page.getByRole('button', { name: /^Open slide 1 · Observe the courtyard/ }).click();
  await expect(page.locator('.ed-stage')).toContainText('Observe the courtyard');
});

test('lesson navigation remains available after scrolling and starts generation at the top', async ({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:1440,height:740});
  const response=await request.post('/api/decks',{data:{
    topic:'Investigating river habitats',language:'en',provider:'fixture',review:true,slideCount:14,
  }});
  expect(response.status()).toBe(201);
  const deck:Deck=await response.json();
  await page.goto('/#/deck/'+deck.id);
  const side=page.locator('.decknav-side');
  await expect(side.getByRole('link',{name:'Templates',exact:true})).toBeVisible();
  await expect(side.locator('.decknav-index button')).toHaveCount(14);
  const longTitle='How can students compare the reliability of measurements in a river habitat investigation?';
  await page.getByRole('textbox',{name:'Slide title 1',exact:true}).fill(longTitle);
  const firstTitle=side.locator('.decknav-index button').first();
  await expect(firstTitle).toContainText(longTitle);
  await expect(firstTitle).not.toHaveAttribute('title');
  await expect.poll(()=>side.locator('.decknav-index').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await expect.poll(()=>firstTitle.locator('span').last().evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await expect(page.locator('.wb-slide-meta').getByRole('combobox')).toHaveCount(0);
  await side.locator('.decknav-index button').last().click();
  await expect(page.locator('.wb-outline-item').last()).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
  await expect(page.locator('.deck-header')).toBeInViewport();
  await expect(side.getByRole('link',{name:'Home',exact:true})).toBeInViewport();
  await page.setViewportSize({width:390,height:740});
  await page.locator('.deck-header .decknav-trigger').click();
  const drawer=page.getByRole('dialog',{name:'Workspace',exact:true});
  await expect.poll(()=>drawer.locator('.decknav-index').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await expect(drawer.locator('.decknav-index button').first()).not.toHaveAttribute('title');
  await drawer.locator('.decknav-index button').nth(6).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.wb-outline-item').nth(6)).toBeFocused();
  await page.getByRole('button',{name:'Generate slides'}).click();
  await expect(page.locator('.wb-generation')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await page.locator('.deck-header .decknav-trigger').click();
  await drawer.getByRole('link',{name:'My lessons',exact:true}).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading',{name:'Lesson library',exact:true})).toBeVisible();
});
