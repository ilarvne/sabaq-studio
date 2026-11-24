import { expect, test, type Locator } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

function appearance(cover: Locator) {
  return cover.evaluate(node => ({
    artwork: [...node.querySelectorAll<HTMLElement>('.ed-artwork-shape')].map(shape => ({
      motif: shape.dataset.shape,
      color: getComputedStyle(shape).color,
      gradient: getComputedStyle(shape).backgroundImage.includes('repeating-radial-gradient'),
    })),
    titleSize: parseFloat(getComputedStyle(node.querySelector('.ed-slide-title')!).fontSize) / node.clientWidth,
  }));
}

test('cover decorations move directly, support editing, and persist with independent title placement', async ({page, request}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(() => localStorage.setItem('sabaq:locale','en'));
  const deck = await (await request.post('/api/decks',{data:{
    topic:'Инопланетный гамбит',language:'ru',provider:'fixture',template:'blank',review:false,
  }})).json() as Deck;
  const url = '/api/decks/' + deck.id;
  const readSlide = async () => (await (await request.get(url)).json() as Deck).slides[0];
  const setup = await request.patch(url,{data:{op:{kind:'slide',slideId:deck.slides[0].id,baseVersion:deck.slides[0].version,changes:{
    layout:'cover',body:'Познакомьтесь с новым гамбитом, который изменит вашу игру в шахматы!',
    design:{eyebrow:'Шахматы для юных гениев'},
  }}}});
  expect(setup.ok()).toBe(true);
  expect((await request.patch(url,{data:{op:{kind:'deck',theme:'notebook'}}})).ok()).toBe(true);

  await page.goto('/#/deck/'+deck.id);
  const cover = page.locator('.ed-stage .ed-slide');
  const upper = cover.getByRole('button',{name:'Cover decoration 1',exact:true});
  await expect(upper).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const initial = await appearance(cover);
  expect(initial.artwork).toEqual([
    {motif:'rings-top',color:'rgb(66, 109, 60)',gradient:true},
    {motif:'rings-bottom',color:'rgb(66, 109, 60)',gradient:true},
  ]);

  const art = (await upper.boundingBox())!;
  const artX = art.x + art.width * .7;
  const artY = art.y + art.height * .25;
  await page.mouse.move(artX,artY);
  await page.mouse.down();
  await page.mouse.move(artX-50,artY+30,{steps:8});
  await page.mouse.up();
  await expect.poll(async () => (await readSlide()).coverArtwork?.objects[0]?.x ?? 70).toBeLessThan(67);
  expect((await readSlide()).coverArtwork?.objects[1]).toMatchObject({x:70,y:52});
  expect((await readSlide()).freeLayout).toBeFalsy();

  const title = cover.locator('[data-slot-entry="title"]');
  const text = (await title.boundingBox())!;
  await page.mouse.move(text.x+text.width*.4,text.y+text.height*.5);
  await page.mouse.down();
  await page.mouse.move(text.x+text.width*.4+35,text.y+text.height*.5+42,{steps:8});
  await page.mouse.up();
  await expect.poll(async () => Boolean((await readSlide()).freeLayout)).toBe(true);
  const placed = await appearance(cover);
  expect(placed.artwork).toEqual(initial.artwork);
  expect(placed.titleSize).toBeCloseTo(initial.titleSize,3);

  await upper.press('Enter');
  const edit = page.getByRole('dialog',{name:'Edit · Cover decoration'});
  await expect(edit).toBeVisible();
  await edit.getByLabel('Color',{exact:true}).fill('#8844aa');
  await edit.getByLabel('Rotation (°)').fill('15');
  await edit.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async () => (await readSlide()).coverArtwork?.objects[0]).toMatchObject({color:'#8844aa',rotation:15});

  await page.reload();
  await expect(upper).toBeVisible();
  const saved = await appearance(cover);
  expect(saved.artwork[0]).toEqual({motif:'rings-top',color:'rgb(136, 68, 170)',gradient:true});
  expect(saved.titleSize).toBeCloseTo(initial.titleSize,3);
  await upper.press('Delete');
  await expect(upper).toHaveCount(0);
  await expect.poll(async () => (await readSlide()).coverArtwork?.objects.map(object => object.id)).toEqual(['cover-art-2']);

  expect((await request.patch(url,{data:{op:{kind:'deck',theme:'field-notes'}}})).ok()).toBe(true);
  await page.reload();
  await expect(cover.locator('.ed-free-page')).toBeVisible();
  await expect(cover.locator('.ed-theme-artwork [data-shape="roundRect"]')).toHaveCount(2);

  expect((await request.patch(url,{data:{op:{kind:'deck',theme:'notebook'}}})).ok()).toBe(true);
  await page.reload();
  await expect(cover.getByRole('button',{name:'Cover decoration 2',exact:true})).toBeVisible();
  await expect(upper).toHaveCount(0);
});
