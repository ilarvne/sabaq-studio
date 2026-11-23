import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('organization admin publishes a branded template and a teacher copies it and inserts library media',async({page,browser,request,baseURL})=>{
  test.setTimeout(90_000);
  const identity=(subject:string,role='member')=>({'x-studio-gateway':process.env.STUDIO_E2E_ORG_TEST_KEY!,
    'x-studio-org':'test-school','x-studio-user':subject,'x-studio-role':role});
  const admin=identity('catalog-admin','org-admin');
  await page.setExtraHTTPHeaders(admin);
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/templates');
  await page.getByRole('button',{name:'Organization style and media'}).click();
  const settings=page.getByRole('dialog');
  await settings.getByLabel('Upload image or logo').setInputFiles('apps/web/public/assets/water-lab.webp');
  await expect(settings.getByRole('button',{name:'Remove from library · water-lab.webp'})).toBeVisible();
  await settings.getByRole('combobox',{name:'Logo',exact:true}).click();
  await page.getByRole('option',{name:'water-lab.webp'}).click();
  await settings.getByRole('button',{name:'Save style'}).click();
  await expect(settings.getByRole('status')).toHaveText('Style saved');
  await settings.getByRole('button',{name:'Close',exact:true}).last().click();
  const created=await request.post('/api/decks',{headers:admin,data:{topic:'Physics',language:'en',template:'blank',provider:'fixture',review:false}});
  expect(created.status()).toBe(201);
  const original:Deck=await created.json();
  await page.goto('/#/deck/'+original.id);
  await expect(page.locator('.ed-stage .ed-brand-logo')).toBeVisible();
  await page.getByRole('button',{name:'Lesson actions'}).click();
  await page.getByRole('menuitem',{name:'Save organization template'}).click();
  const publish=page.getByRole('dialog');
  await publish.getByLabel('Template name').fill('School physics');
  await publish.getByRole('button',{name:'Save organization template',exact:true}).click();
  await expect(publish.getByRole('status')).toHaveText('Template published');

  const member=identity('teacher');
  const teacher=await browser.newContext({baseURL,extraHTTPHeaders:member,viewport:{width:1366,height:900}});
  try {
    await teacher.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
    const view=await teacher.newPage();
    await view.goto('/#/templates');
    await expect(view.getByRole('heading',{name:'Organization templates'})).toBeVisible();
    await expect(view.getByRole('button',{name:'Organization style and media'})).toHaveCount(0);
    await view.getByRole('button',{name:'Create a copy'}).click();
    const copy=view.getByRole('dialog');
    await copy.getByLabel('Lesson title').fill('Physics A');
    await copy.getByRole('button',{name:'Create a copy'}).click();
    await expect(view.locator('.ed-stage .ed-brand-logo')).toBeVisible();
    const id=await view.evaluate(()=>location.hash.split('/')[2]);
    expect(id).not.toBe(original.id);
    await view.getByRole('tab',{name:'Design',exact:true}).click();
    await view.getByRole('button',{name:'Add image',exact:true}).click();
    const image=view.getByRole('dialog');
    await image.getByText('Organization images',{exact:true}).click();
    await image.getByRole('button',{name:'water-lab.webp'}).click();
    await image.getByLabel('Image description').fill('A classroom water experiment');
    await image.getByRole('button',{name:'Apply image'}).click();
    await expect(view.locator('.ed-stage img[alt="A classroom water experiment"]')).toBeVisible();
    await expect.poll(async()=>((await (await request.get('/api/decks/'+id,{headers:member})).json()) as Deck).slides[0].image?.alt).toBe('A classroom water experiment');
  } finally {await teacher.close();}
});
