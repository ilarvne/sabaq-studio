import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('a selected paragraph becomes an editable diagram and every node fits its box',async ({page,request})=>{
  const created=await request.post('/api/decks',{data:{topic:'Water cycle',language:'en',template:'blank',provider:'fixture',review:false}});
  const original:Deck=await created.json();
  const id=original.slides[0].id, url='/api/decks/'+original.id;
  const items=['Collection','Evaporation','Condensation','Precipitation','Infiltration','Transpiration','Return to rivers'];
  expect((await request.patch(url,{data:{op:{kind:'slide',slideId:id,baseVersion:original.slides[0].version,changes:{body:items.join('\n')}}}})).ok()).toBeTruthy();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/deck/'+original.id);
  const canvas=page.locator('.ed-stage');
  await canvas.locator('[data-slot-entry="body"]').click();
  const content=canvas.locator('[contenteditable="true"]');
  await content.press('ControlOrMeta+a');
  await page.getByRole('button',{name:'Diagram from selection'}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Diagram type').selectOption('timeline');
  await dialog.getByRole('button',{name:'Add diagram slide'}).click();
  await expect(canvas.locator('[data-diagram="timeline"] li')).toHaveCount(7);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Edit diagram'}).click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('Diagram type').selectOption('mind-map');
  await dialog.getByLabel('Node 2',{exact:true}).fill('Испарение '.repeat(13).trim());
  const alternative='Water cycle with collection as the main idea and six branches.';
  await dialog.getByLabel('Diagram description',{exact:true}).fill(alternative);
  await dialog.getByRole('button',{name:'Save diagram'}).click();
  await expect(canvas.locator('[data-diagram="mind-map"] li')).toHaveCount(7);
  await expect.poll(async()=>{
    const deck:Deck=await (await request.get(url)).json();
    return deck.slides[1]?.diagram?.kind;
  }).toBe('mind-map');
  const fits=await canvas.locator('.ed-diagram-node').evaluateAll(nodes=>nodes.every(node=>{
    const bounds=node.getBoundingClientRect(),text=node.querySelector('.ed-diagram-label')!.getBoundingClientRect();
    return text.left>=bounds.left-1 && text.top>=bounds.top-1 && text.right<=bounds.right+1 && text.bottom<=bounds.bottom+1;
  }));
  expect(fits).toBe(true);
  await expect(canvas.locator('.ed-slide')).toHaveAttribute('data-overflow', 'true');
  await page.reload();
  await expect(canvas.locator('[data-diagram="mind-map"] li')).toHaveCount(7);
  await expect(canvas.locator('[data-diagram="mind-map"]')).toHaveAttribute('aria-label',alternative);
});
