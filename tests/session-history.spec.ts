import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('undo and redo restore manual edits, themes, and approved assistant changes in order', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const created = await request.post('/api/decks', {
    data: { topic: 'Classroom measurements', language: 'en', template: 'blank', provider: 'fixture', review: false },
  });
  expect(created.status()).toBe(201);
  const initial: Deck = await created.json();
  const api = '/api/decks/' + initial.id;
  const read = async (): Promise<Deck> => (await request.get(api)).json();

  await page.goto('/#/deck/' + initial.id);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page.getByRole('tab', { name: 'Lecture text', exact: true }).click();
  await page.locator('.inspect-notes textarea').fill('Read the ruler at eye level.');
  await expect.poll(async () => (await read()).slides[0].notes).toBe('Read the ruler at eye level.');

  await page.getByRole('tab', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: /Deck theme/ }).click();
  await page.getByRole('radio', { name: 'Blueprint', exact: true }).click();
  await expect.poll(async () => (await read()).theme).toBe('blueprint');

  await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const composer = page.getByPlaceholder('Ask about this slide…');
  await composer.fill('Use the Editorial theme.');
  await composer.press('Enter');
  const apply = page.getByRole('button', { name: 'Apply changes', exact: true });
  await expect(apply).toBeVisible();
  expect((await read()).theme).toBe('blueprint');
  await apply.click();
  await expect.poll(async () => (await read()).theme).toBe('editorial');
  const approved = await read();

  // The server commits the first undo but the browser loses the response.
  await page.route('**/revisions/*/restore', async (route) => {
    const committed = await route.fetch();
    expect(committed.ok()).toBeTruthy();
    await route.abort();
  }, { times: 1 });
  await undo.click();
  await expect.poll(async () => (await read()).theme).toBe('blueprint');
  await undo.click();
  await expect(redo).toBeEnabled();
  expect((await read()).revision).toBe(approved.revision + 1);

  await undo.click();
  await expect.poll(async () => (await read()).theme).toBe(initial.theme);
  await undo.click();
  await expect.poll(async () => (await read()).slides[0].notes).toBe(initial.slides[0].notes);
  await expect(undo).toBeDisabled();

  const canvas = page.locator('.ed-stage');
  await expect(redo).toBeEnabled();
  await canvas.press('Control+Shift+z');
  await expect.poll(async () => (await read()).slides[0].notes).toBe('Read the ruler at eye level.');
  await redo.click();
  await expect.poll(async () => (await read()).theme).toBe('blueprint');
  await redo.click();
  await expect.poll(async () => (await read()).theme).toBe('editorial');
  await expect(redo).toBeDisabled();
});

test('an applied assistant proposal restores the original from its summary', async ({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created=await request.post('/api/decks',{data:{topic:'Classroom colours',language:'en',template:'blank',provider:'fixture',review:false}});
  expect(created.ok()).toBeTruthy();
  const initial:Deck=await created.json();
  const read=async ():Promise<Deck>=>(await request.get('/api/decks/'+initial.id)).json();
  await page.goto('/#/deck/'+initial.id);
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const composer=page.getByPlaceholder('Ask about this slide…');
  await composer.fill('Use the Editorial theme.');
  await composer.press('Enter');
  await page.getByRole('button',{name:'Apply changes',exact:true}).click();
  await expect.poll(async()=>(await read()).theme).toBe('editorial');
  await page.getByRole('button',{name:'Restore original',exact:true}).click({timeout:5000});
  await expect.poll(async()=>(await read()).theme).toBe(initial.theme);
  await expect(page.getByText('Previous version restored',{exact:true})).toBeVisible();
});
