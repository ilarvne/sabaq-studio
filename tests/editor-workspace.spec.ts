import {test,expect} from '@playwright/test';
import type {Deck} from '@sabaq/lesson/types';

test('a blank lesson can insert native data, edit it on the canvas and reopen it',async({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created=await request.post('/api/decks',{data:{topic:'Editable lesson data',template:'blank',language:'en',provider:'fixture',review:false}});
  expect(created.ok()).toBe(true);
  const deck:Deck=await created.json();
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/#/deck/'+deck.id);
  const canvas=page.locator('.ed-stage');
  const insert=page.getByRole('button',{name:'Insert',exact:true});
  await expect(insert).toBeVisible();
  await insert.click();
  await page.getByRole('menuitem',{name:'Table',exact:true}).click();
  const table=page.getByRole('region',{name:'Table data',exact:true});
  await table.getByLabel('Row 1, column 1',{exact:true}).fill('Classroom observation');
  await expect(canvas).toContainText('Classroom observation');
  await table.getByRole('button',{name:'Add row',exact:true}).click();
  await table.getByLabel('Row 3, column 1',{exact:true}).fill('Second group');
  await expect(canvas).toContainText('Second group');
  await insert.click();
  await page.getByRole('menuitem',{name:'Chart',exact:true}).click();
  const chart=page.getByRole('region',{name:'Chart data',exact:true});
  await chart.getByLabel('Category 1, series 1',{exact:true}).fill('42');
  await chart.getByLabel('Category 1',{exact:true}).fill('Morning');
  await expect(canvas).toContainText('Morning');
  await expect.poll(async()=>{
    const saved:Deck=await (await request.get('/api/decks/'+deck.id)).json();
    return saved.slides[0].chart?.series[0].values[0];
  }).toBe(42);
  await page.reload();
  await expect(page.getByRole('tab',{name:'Assistant',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await expect(page.getByLabel('Category 1, series 1',{exact:true})).toHaveValue('42');
  await expect(page.getByLabel('Row 1, column 1',{exact:true})).toHaveValue('Classroom observation');
});

test('applying a layout exits free placement without discarding slide content',async({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:1440,height:900});
  const deck:Deck=await (await request.get('/api/decks/schoolyard-en')).json();
  const slide=deck.slides[0];
  const changed=await request.patch('/api/decks/'+deck.id,{data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{
    freeLayout:{items:[{id:'title',x:7,y:8,w:80,h:25,rotation:0},{id:'body',x:7,y:35,w:80,h:45,rotation:0}]},
  }}}});
  expect(changed.ok()).toBe(true);
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('button',{name:'Other layouts',exact:true}).click();
  const gallery=page.getByRole('region',{name:'Other layouts',exact:true});
  const count=await gallery.getByRole('button').count();
  expect(count).toBeGreaterThanOrEqual(5);
  expect(count).toBeLessThanOrEqual(7);
  await gallery.getByRole('button',{name:'Two columns',exact:true}).click();
  await expect.poll(async()=>{
    const saved:Deck=await (await request.get('/api/decks/'+deck.id)).json();
    return {layout:saved.slides[0].layout,free:saved.slides[0].freeLayout??null,title:saved.slides[0].title,body:saved.slides[0].body};
  }).toEqual({layout:'split',free:null,title:slide.title,body:slide.body});
  await expect(page.locator('.ed-stage .ed-slide')).toHaveAttribute('data-layout','split');
});

test('inserting an icon preserves an existing image rather than replacing it',async({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:1440,height:900});
  const deck:Deck=await(await request.get('/api/decks/schoolyard-en')).json();
  const index=deck.slides.findIndex(slide=>slide.image && !slide.chart && !slide.table && !slide.diagram && !slide.additionalImages?.length);
  expect(index).toBeGreaterThanOrEqual(0);
  const original=deck.slides[index];
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('combobox',{name:'Go to slide'}).selectOption(String(index+1));
  await page.getByRole('button',{name:'Insert',exact:true}).click();
  await page.getByRole('menuitem',{name:'Icon',exact:true}).click();
  await page.getByRole('dialog',{name:'Pictogram',exact:true}).getByRole('button',{name:'Apply to slide',exact:true}).click();
  await expect.poll(async()=>{
    const saved:Deck=await(await request.get('/api/decks/'+deck.id)).json();
    return saved.slides[index].additionalImages?.length;
  }).toBe(1);
  const saved:Deck=await(await request.get('/api/decks/'+deck.id)).json();
  expect(saved.slides[index].image).toEqual(original.image);
  expect(saved.slides[index].additionalImages?.[0].provenance?.source).toBe('pictogram');
});

test('data insertion beside a diagram creates an editable slide and keeps the original diagram',async({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:1440,height:900});
  const created=await request.post('/api/decks',{data:{topic:'Process investigation',template:'blank',language:'en',provider:'fixture',review:false}});
  const deck:Deck=await created.json();
  const added=await request.patch('/api/decks/'+deck.id,{data:{op:{kind:'add',afterId:deck.slides[0].id,
    diagram:{kind:'process',nodes:['Observe','Measure','Compare']}}}});
  expect(added.ok()).toBe(true);
  const before:Deck=await added.json();
  const original=before.slides[1];
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('combobox',{name:'Go to slide'}).selectOption('2');
  await page.getByRole('button',{name:'Insert',exact:true}).click();
  await page.getByRole('menuitem',{name:'Table · on a new slide',exact:true}).click();
  const data=page.getByRole('region',{name:'Table data',exact:true});
  await data.getByLabel('Row 1, column 1',{exact:true}).fill('Field result');
  await expect(page.locator('.ed-stage')).toContainText('Field result');
  await expect.poll(async()=>{
    const saved:Deck=await(await request.get('/api/decks/'+deck.id)).json();
    return saved.slides.length;
  }).toBe(3);
  const saved:Deck=await(await request.get('/api/decks/'+deck.id)).json();
  expect(saved.slides[1].diagram).toEqual(original.diagram);
  expect(saved.slides[2].table?.rows[0][0]).toBe('Field result');
});
