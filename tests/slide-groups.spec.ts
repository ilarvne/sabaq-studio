import {expect,test} from '@playwright/test';
import type {Deck} from '@sabaq/lesson/types';

test('a teacher selects slides from another lesson, copies them, then undoes the group',async({page,request})=>{
  const create=async(topic:string)=>(await request.post('/api/decks',{data:{topic,slideCount:3,language:'en',provider:'fixture',template:'blank',review:false}})).json() as Promise<Deck>;
  const source=await create('Source lesson for group copying'),dest=await create('Destination lesson for group copying');
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/deck/'+dest.id);
  await page.getByRole('button',{name:'Slide navigation view'}).click();
  await page.getByRole('menuitem',{name:'Select multiple slides'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('combobox').selectOption(source.id);
  await dialog.getByRole('checkbox').first().check();await dialog.getByRole('checkbox').last().check();
  await dialog.getByRole('button',{name:'Copy after current slide'}).click();
  await expect(page.locator('.ed-rail .ed-thumb')).toHaveCount(5);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('.ed-rail .ed-thumb')).toHaveCount(3);
});
