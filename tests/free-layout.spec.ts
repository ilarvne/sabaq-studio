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

test('dragging shows a bounded guide and keyboard movement persists its result',async({page,request})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const deck:Deck=await(await request.post('/api/decks',{data:{topic:'Guide alignment',template:'blank',language:'en',provider:'fixture',review:false}})).json();
  const slide=deck.slides[0],url='/api/decks/'+deck.id;
  const changed=await request.patch(url,{data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{
    title:'Observe',body:'Record your observations.',
    freeLayout:{items:[
      {id:'title',x:10,y:15,w:24,h:20,rotation:0},
      {id:'body',x:45,y:51,w:45,h:22,rotation:0},
    ]},
  }}}});
  expect(changed.ok()).toBe(true);
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Arrange elements'}).click();
  const dialog=page.getByRole('dialog');
  const canvas=dialog.getByRole('group',{name:'Slide canvas'});
  const title=canvas.getByRole('button',{name:'Move · Title'});
  const stage=(await canvas.boundingBox())!,layer=(await title.boundingBox())!;
  const x=layer.x+layer.width/2,y=layer.y+layer.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+stage.width*.114,y+stage.height*.04,{steps:5});
  const guide=canvas.locator('.free-guide-x');
  await expect(guide).toBeVisible();
  expect((await guide.boundingBox())!.height).toBeLessThan(stage.height*.7);
  await page.mouse.up();
  await expect(guide).toHaveCount(0);
  await title.press('Shift+ArrowRight');
  await dialog.getByRole('button',{name:'Apply layout'}).click();
  await expect.poll(async()=>{
    const saved:Deck=await(await request.get(url)).json();
    return saved.slides[0].freeLayout?.items.find(item=>item.id==='title')?.x;
  }).toBeCloseTo(21.781,3);
});

test('an adaptive gallery opens with three separate pictures and saves independent movement and resizing',async({page,request})=>{
  await page.setViewportSize({width:1440,height:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const deck:Deck=await(await request.post('/api/decks',{data:{
    topic:'Field photographs',template:'blank',language:'en',provider:'fixture',review:false,
  }})).json();
  const slide=deck.slides[0],url='/api/decks/'+deck.id;
  const image={src:'/assets/seedling-growth.webp',alt:'First plant'};
  await expect(await request.patch(url,{data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{
    layout:'image-grid',body:'Compare the three photographs.',image,additionalImages:[
      {...image,alt:'Second plant'},{...image,alt:'Third plant'},
    ],
  }}}})).toBeOK();
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Arrange elements'}).click();
  const dialog=page.getByRole('dialog'),canvas=dialog.locator('.free-stage');
  const first=canvas.locator('[data-free-id="image"]'),second=canvas.locator('[data-free-id="image-2"]'),
    third=canvas.locator('[data-free-id="image-3"]');
  await expect(third.locator('img[alt="Third plant"]')).toBeVisible();
  const firstStyle=await first.getAttribute('style'), thirdStyle=await third.getAttribute('style');
  const hit=dialog.getByRole('button',{name:'Move · Image 2',exact:true});
  const initial=(await second.boundingBox())!;
  expect(initial.x).toBeGreaterThan((await first.boundingBox())!.x);
  expect(initial.x).toBeLessThan((await third.boundingBox())!.x);
  await dialog.getByRole('checkbox',{name:'Snap to guides'}).uncheck();
  const target=(await hit.boundingBox())!;
  const x=target.x+target.width/2,y=target.y+target.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+20,y-25,{steps:5});
  await page.mouse.up();
  const handle=(await canvas.locator('.handle-resize').nth(3).boundingBox())!;
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+16,handle.y+handle.height/2,{steps:4});
  await page.mouse.up();
  const changed=(await second.boundingBox())!;
  expect(changed.x-initial.x).toBeCloseTo(20,0);
  expect(changed.y-initial.y).toBeCloseTo(-25,0);
  expect(changed.width-initial.width).toBeCloseTo(16,0);
  await expect(first).toHaveAttribute('style',firstStyle!);
  await expect(third).toHaveAttribute('style',thirdStyle!);
  await dialog.getByRole('button',{name:'Apply layout'}).click();
  await expect.poll(async()=>{
    const saved:Deck=await(await request.get(url)).json();
    return saved.slides[0].freeLayout?.items.filter(item=>item.id.startsWith('image')).map(item=>item.id);
  }).toEqual(['image','image-2','image-3']);
  await page.reload();
  await expect(page.locator('.ed-stage [data-free-id="image-2"]').getByRole('img',{name:'Second plant'})).toBeVisible();
});
