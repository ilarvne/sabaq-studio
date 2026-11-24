import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import type { Deck } from '@sabaq/lesson/types';

test('moves one image independently on the main canvas and exports separate PowerPoint pictures', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const deck: Deck = await (await request.post('/api/decks', { data: {
    topic: 'Compare garden observations', template: 'blank', language: 'en', provider: 'fixture', review: false,
  } })).json();
  const url = `/api/decks/${deck.id}`;
  const slide = deck.slides[0];
  const patched = await request.patch(url, { data: { op: { kind: 'slide', slideId: slide.id, baseVersion: slide.version, changes: {
    layout: 'image-grid', body: 'Discuss the two scenes.', image: { src: '/assets/seedling-growth.webp', alt: 'Growing seedling' },
    additionalImages: [{ src: '/assets/water-lab.webp', alt: 'Measuring water' }],
  } } } });
  expect(patched.ok()).toBe(true);

  await page.goto(`/#/deck/${deck.id}`);
  const stage = page.locator('.ed-stage');
  const first = stage.getByRole('img', { name: 'Growing seedling' });
  const second = stage.getByRole('img', { name: 'Measuring water' });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const primary = stage.locator('[data-free-id="image"]');
  const secondary = stage.locator('[data-free-id="image-2"]');
  const primaryBox = (await first.boundingBox())!;
  const hit = (await second.boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(hit.x + hit.width / 2 - 40, hit.y + hit.height / 2 - 20, { steps: 7 });
  await page.mouse.up();
  await expect.poll(async () => (await secondary.boundingBox())?.x ?? Number.MAX_VALUE).toBeLessThan(hit.x - 15);
  expect((await primary.boundingBox())?.x).toBeCloseTo(primaryBox.x, 1);
  await expect.poll(async () => {
    const saved: Deck = await (await request.get(url)).json();
    return saved.slides[0].freeLayout?.items.filter(item => item.id.startsWith('image')).length;
  }).toBe(2);
  await page.reload();
  await expect(secondary.getByRole('img', { name: 'Measuring water' })).toBeVisible();
  const read = async () => (await (await request.get(url)).json() as Deck).slides[0];
  const savedPositions = (await read()).freeLayout?.items.filter(item => item.id.startsWith('image'));
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chart', exact: true }).click();
  await expect.poll(async () => (await read()).chart?.categories.length).toBe(3);
  expect((await read()).freeLayout?.items.filter(item => item.id.startsWith('image'))).toEqual(savedPositions);
  await expect(secondary.getByRole('img', { name: 'Measuring water' })).toBeVisible();

  const exported = await request.get(`${url}/export/pptx`);
  expect(exported.ok()).toBe(true);
  const zip = await JSZip.loadAsync(await exported.body());
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('Free/image/Slide illustration');
  expect(xml).toContain('Free/image-2/Slide illustration');
  expect(xml).toContain('descr="Growing seedling"');
  expect(xml).toContain('descr="Measuring water"');
  expect(zip.file('ppt/charts/chart1.xml')).toBeTruthy();
});

test('a title can be dragged from its normal canvas position, cancelled, nudged and edited', async ({page, request}) => {
  await page.setViewportSize({width:1440,height:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  const deck:Deck = await (await request.post('/api/decks', {data:{
    topic:'Garden observations',template:'blank',language:'en',provider:'fixture',review:false,
  }})).json();
  const url = '/api/decks/' + deck.id;
  const read = async () => (await (await request.get(url)).json() as Deck).slides[0];
  await page.goto('/#/deck/' + deck.id);
  const stage = page.locator('.ed-stage');
  const title = stage.locator('[data-slot-entry="title"]');
  await title.click();
  const text = stage.locator('[contenteditable="true"]');
  await expect(text).toBeFocused();
  await text.press('Escape');
  await expect(stage.locator('.ed-free-page')).toHaveCount(0);
  const box = (await title.boundingBox())!;
  const x=box.x+box.width/2, y=box.y+box.height/2;
  const placed = stage.locator('[data-free-id="title"]');

  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+48,{steps:6});
  await expect(placed).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(placed).toHaveCount(0);
  expect((await read()).freeLayout ?? null).toBeNull();

  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+48,{steps:6});
  await page.mouse.up();
  await expect(placed).toBeVisible();
  const moved = (await placed.boundingBox())!;
  expect(moved.y).toBeGreaterThan(box.y+24);
  await expect.poll(async()=>(await read()).freeLayout?.items.some(item=>item.id==='title')).toBe(true);
  const beforeNudge=(await read()).freeLayout!.items.find(item=>item.id==='title')!.y;
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async()=>(await read()).freeLayout?.items.find(item=>item.id==='title')?.y ?? 0).toBeGreaterThan(beforeNudge+1);

  await title.click();
  await expect(text).toBeFocused();
  await text.press('Escape');
  await page.getByRole('button',{name:'Layers',exact:true}).click();
  await page.getByRole('menuitem',{name:'Return to adaptive layout',exact:true}).click();
  await expect(placed).toHaveCount(0);
  await expect.poll(async()=>(await read()).freeLayout).toBeNull();
});
