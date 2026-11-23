import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('keyboard arrangement groups elements, persists a rotation and returns to adaptive sizing',async({page,request})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created=await request.post('/api/decks',{data:{topic:'Free layout',template:'blank',language:'en',provider:'fixture',review:false}});
  const deck:Deck=await created.json(),s=deck.slides[0],url='/api/decks/'+deck.id;
  expect((await request.patch(url,{data:{op:{kind:'slide',slideId:s.id,baseVersion:s.version,changes:{title:'Wetlands',body:'Wetlands store excess rainwater.'}}}})).ok()).toBe(true);
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  const open=page.getByRole('button',{name:'Arrange elements'});
  await open.click();
  let dialog=page.getByRole('dialog');
  await dialog.getByRole('checkbox',{name:'Body',exact:true}).check();
  await dialog.getByRole('button',{name:'Group',exact:true}).click();
  const rotation=dialog.getByRole('spinbutton',{name:'Rotation (°)'});
  await rotation.fill('12');await rotation.press('Enter');
  await dialog.getByRole('button',{name:'Apply layout'}).click();
  const body=page.locator('.ed-stage [data-free-id="body"]');
  await expect(body).toHaveText('Wetlands store excess rainwater.');
  await expect.poll(async()=>{
    const saved:Deck=await(await request.get(url)).json();
    return saved.slides[0].freeLayout?.items.find(item=>item.id==='body')?.rotation;
  }).toBe(12);
  await page.reload();
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await expect(body).toBeVisible();
  await open.click();dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Return to adaptive layout'}).click();
  await expect(page.locator('.ed-stage .ed-free-page')).toHaveCount(0);
  await expect.poll(async()=>(await(await request.get(url)).json() as Deck).slides[0].freeLayout).toBeNull();
});

test('a full-bleed capture preserves text layering and a corner resize holds its opposite corner',async({page,request})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const deck:Deck=await(await request.post('/api/decks',{data:{topic:'Field observations',template:'blank',language:'en',provider:'fixture',review:false}})).json();
  const slide=deck.slides[0];
  const url='/api/decks/'+deck.id;
  const image={src:'/assets/seedling-growth.webp',alt:'A seedling',decorative:false};
  const changed=await request.patch(url,{data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{
    body:'Compare the first two leaves.',image,layout:'image-full',
  }}}});
  expect(changed.ok()).toBe(true);
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Arrange elements'}).click();
  const dialog=page.getByRole('dialog');
  const canvas=dialog.locator('.free-stage');
  await expect(canvas.locator('.ed-free-page')).toHaveAttribute('data-photo-backdrop','true');
  const layer=canvas.locator('[data-free-id=title]');
  const handle=canvas.locator('.handle-resize').nth(4);
  await handle.hover();
  const before=(await layer.boundingBox())!;
  const handleBox=(await handle.boundingBox())!;
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x+handleBox.width/2-28,handleBox.y+handleBox.height/2+12,{steps:4});
  await page.mouse.up();
  const after=(await layer.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
  expect(after.width).toBeCloseTo(before.width-28,0);
  await dialog.getByRole('button',{name:'Align right',exact:true}).click();
  await dialog.getByRole('button',{name:'Apply layout'}).click();
  const stage=page.locator('.ed-stage');
  await expect(stage.locator('[data-free-id=body]')).toHaveText('Compare the first two leaves.');
  await expect.poll(async()=>{
    const saved=(await(await request.get(url)).json() as Deck).slides[0].freeLayout;
    return saved?.items[0].id;
  }).toBe('image');
  await page.reload();await expect(stage.locator('.ed-free-page')).toHaveAttribute('data-photo-backdrop','true');
});
