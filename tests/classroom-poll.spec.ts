import { expect, test } from '@playwright/test';

test('a teacher opens a class poll and an anonymous student answers on a phone',async ({page,browser,baseURL})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/deck/schoolyard-en/present');
  const classroom=page.getByRole('dialog');
  await classroom.getByRole('button',{name:'Class poll',exact:true}).click();
  const setup=classroom.getByRole('region',{name:'Class poll'});
  await setup.getByLabel('Question',{exact:true}).fill('Which sample held more water?');
  await setup.getByLabel('Answer options, one per line').fill('First sample\nSecond sample');
  await setup.getByRole('button',{name:'Open poll'}).click();
  const link=setup.getByRole('link',{name:'Student link'});
  await expect(link).toBeVisible();
  const student=await browser.newContext({baseURL,viewport:{width:375,height:812}});
  try {
    const phone=await student.newPage();
    await phone.goto((await link.getAttribute('href'))!);
    await expect(phone.getByRole('heading',{name:'Which sample held more water?'})).toBeVisible();
    await phone.getByLabel('Second sample').check();
    await phone.getByRole('button',{name:'Submit answer'}).click();
    await expect(phone.getByRole('status').filter({hasText:'Answer recorded'})).toBeVisible();
    await expect(setup.getByRole('listitem').filter({hasText:'Second sample'})).toHaveText('Second sample 1');
    await setup.getByRole('button',{name:'End poll'}).click();
    await expect(setup.getByRole('button',{name:'Open poll'})).toBeVisible();
  } finally {await student.close();}
});
