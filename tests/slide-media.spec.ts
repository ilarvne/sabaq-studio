import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('the slide inspector adds, revises, and removes media in an image grid',async({page,request})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created=await request.post('/api/decks',{data:{
    topic:'Formula and pictogram',template:'blank',language:'en',provider:'fixture',review:false,
  }});
  expect(created.ok()).toBe(true);
  const deck:Deck=await created.json();
  const load=async()=>(await (await request.get('/api/decks/'+deck.id)).json() as Deck).slides[0];
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('combobox',{name:'Image style'}).click();
  await page.getByRole('option',{name:'Watercolor',exact:true}).click();
  await expect.poll(async()=>(await (await request.get('/api/decks/'+deck.id)).json() as Deck).imageStyle).toBe('watercolor');
  await page.getByRole('button',{name:'Add image',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('combobox',{name:'Media type'}).click();
  await page.getByRole('option',{name:'Math formula'}).click();
  const fraction=String.raw`\frac{1}{2}`;
  await dialog.getByLabel('LaTeX expression').fill(fraction);
  await dialog.getByLabel('Image description').fill('One half');
  await dialog.getByRole('button',{name:'Apply to slide'}).click();
  const canvas=page.locator('.ed-stage .ed-slide');
  await expect(canvas.getByRole('img',{name:'One half'})).toBeVisible();
  await expect.poll(async()=>(await load()).image?.provenance).toEqual({source:'formula',latex:fraction});

  await page.getByRole('button',{name:'Add image 2',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Media type'}).click();
  await page.getByRole('option',{name:'Pictogram'}).click();
  await dialog.getByRole('combobox',{name:'Pictogram'}).click();
  await page.getByRole('option',{name:'Leaf'}).click();
  await dialog.getByRole('button',{name:'Apply to slide'}).click();
  await expect(canvas.getByRole('img',{name:'Leaf'})).toBeVisible();
  await expect(canvas).toHaveAttribute('data-layout','image-grid');
  await expect.poll(async()=>(await load()).additionalImages?.[0].provenance).toEqual({source:'pictogram',icon:'leaf'});

  await page.reload();
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Replace or crop image',exact:true}).click();
  await expect(dialog.getByLabel('LaTeX expression')).toHaveValue(fraction);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit image 2',exact:true}).click();
  await dialog.getByRole('button',{name:'Remove image 2',exact:true}).click();
  await expect(canvas.getByRole('img',{name:'Leaf'})).toHaveCount(0);
  await expect.poll(async()=>(await load()).additionalImages).toEqual([]);
});

test('uploaded slide images support keyboard selection, crop, alt text and saved replacement', async ({page, request}) => {
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created = await request.post('/api/decks',{data:{
    topic:'Rainwater measurements',template:'blank',language:'en',provider:'fixture',review:false,
  }});
  const deck: Deck = await created.json();
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await page.getByRole('button',{name:'Add image',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab',{name:'Upload',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(dialog.getByLabel('Describe the scene')).toHaveCount(0);
  await expect(dialog.getByLabel('Image description')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button',{name:'Upload image',exact:true}).press('Enter');
  await (await chooser).setFiles('apps/web/public/assets/water-lab.webp');
  await expect(dialog.getByRole('button',{name:'Change image',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Crop and position'}).click();
  await dialog.getByRole('combobox',{name:'Crop shape'}).click();
  await page.getByRole('option',{name:'Square',exact:true}).click();
  await dialog.getByLabel('Image description').fill('Four samples of rainwater');
  await dialog.getByRole('button',{name:'Apply image',exact:true}).click();
  await expect(page.locator('.ed-stage').getByRole('img',{name:'Four samples of rainwater'})).toBeVisible();
  const read = async () => ((await (await request.get('/api/decks/'+deck.id)).json()) as Deck).slides[0].image;
  await expect.poll(async()=>(await read())?.crop?.aspect).toBe('square');
  await page.getByRole('button',{name:'Replace or crop image',exact:true}).click();
  await dialog.getByRole('button',{name:'Change image'}).click();
  await dialog.getByRole('button',{name:'Back to selected image'}).click();
  await expect(dialog.getByLabel('Image description')).toHaveValue('Four samples of rainwater');
  await dialog.getByRole('checkbox',{name:'Decorative image'}).check();
  await expect(dialog.getByLabel('Image description')).toBeDisabled();
  await dialog.getByRole('button',{name:'Apply image',exact:true}).click();
  await expect.poll(async()=>(await read())?.decorative).toBe(true);
});

test('generation keeps optional scene details and lets a teacher select from four results',async({page,request})=>{
  await page.setViewportSize({width:375,height:812});
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','ru'));
  const created=await request.post('/api/decks',{data:{topic:'Rainwater measurements',template:'blank',language:'en',provider:'fixture',review:false}});
  const deck: Deck=await created.json();
  const image='/api/decks/'+deck.id+'/images';
  const options:{src:string;alt:string;provenance:{source:'generated'}}[]=[];
  for (const name of ['water-lab','seedling-growth','kindness-notebooks','kindness-schoolyard']) {
    const uploaded=await request.post(image+'/upload',{headers:{'Content-Type':'application/octet-stream'},
      data:await readFile('apps/web/public/assets/'+name+'.webp')});
    expect(uploaded.ok()).toBe(true);
    options.push({src:(await uploaded.json()).src,alt:name,provenance:{source:'generated'}});
  }
  const requests:unknown[]=[];
  await page.route('**'+image+'/capabilities',route=>route.fulfill({json:{generate:true}}));
  await page.route('**'+image+'/variants',async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1)await route.fulfill({status:503,json:{error:'Unavailable'}});
    else await route.fulfill({json:options});
  });
  await page.goto('/#/deck/'+deck.id);
  await page.getByRole('tab',{name:'Дизайн',exact:true}).click();
  await page.getByRole('button',{name:'Добавить изображение',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('tab',{name:'Сгенерировать'}).click();
  await expect(dialog.getByRole('textbox',{name:'Описание сцены'})).toHaveValue(deck.slides[0].title);
  await expect(dialog.getByText('Место (необязательно)',{exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Детали сцены'}).click();
  await dialog.getByRole('textbox',{name:'Место (необязательно)'}).fill('Almaty');
  await dialog.getByRole('textbox',{name:'Эпоха (необязательно)'}).fill('2020');
  const generate=dialog.getByRole('button',{name:'Сгенерировать четыре варианта'});
  await generate.click();
  await expect(dialog.getByRole('alert')).toContainText('недоступны');
  await generate.click();
  await expect(dialog.locator('.im-variants button')).toHaveCount(4);
  expect(requests[1]).toMatchObject({slideId:deck.slides[0].id,prompt:deck.slides[0].title,place:'Almaty',period:'2020'});
  await dialog.getByRole('button',{name:'Вариант 2',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Описание изображения'})).toHaveValue('seedling-growth');
  await expect(dialog.getByRole('button',{name:'Применить изображение'})).toBeInViewport();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
  await dialog.getByRole('button',{name:'Сменить изображение'}).click();
  await expect(dialog.getByRole('button',{name:'Вариант 2'})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Вариант 2',exact:true}).click();
  await dialog.getByRole('button',{name:'Применить изображение'}).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async()=>((await (await request.get('/api/decks/'+deck.id)).json()) as Deck).slides[0].image?.alt).toBe('seedling-growth');
});
