import { expect, test } from '@playwright/test';

for (const width of [375,1440]) {
  test(`template filters and the teacher's topic reach the plan at ${width}px`, async ({page})=>{
    await page.setViewportSize({width,height:900});
    await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
    await page.goto('/#/templates');
    const shelf=page.locator('.template-shelf');
    await expect(shelf.locator(':scope > article')).toHaveCount(23);
    await page.getByRole('searchbox',{name:'Search templates'}).fill('rhythm');
    await expect(shelf.locator(':scope > article')).toHaveCount(1);
    await expect(shelf.getByRole('heading',{name:'Listening and rhythm'})).toBeVisible();
    await page.getByRole('searchbox',{name:'Search templates'}).fill('');
    await page.getByLabel('Preview with your lesson topic',{exact:true}).fill('Building a school garden');
    await page.getByRole('combobox',{name:'Subject',exact:true}).click();
    await page.getByRole('option',{name:'Technology',exact:true}).click();
    await page.getByRole('combobox',{name:'Grade',exact:true}).click();
    await page.getByRole('option',{name:'4',exact:true}).click();
    await expect(shelf.locator(':scope > article')).toHaveCount(3);
    const project=shelf.locator(':scope > article').filter({has:page.getByRole('heading',{name:'Project pitch'})});
    await expect(project.locator('.ed-slide[data-theme=spotlight]')).toHaveAttribute('data-theme-artwork','true');
    await expect(project.locator('.ed-slide-title')).toHaveText('Building a school garden');
    const engineering=shelf.locator(':scope > article').filter({has:page.getByRole('heading',{name:'Engineering design challenge'})});
    await engineering.getByRole('button',{name:/Preview/}).first().click();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toContainText('Building a school garden');
    await dialog.getByRole('button',{name:'Use template'}).click();
    await expect(page.getByRole('heading',{name:'Shape the lesson'})).toBeVisible();
    await expect(page.locator('.creation-brief-title')).toHaveText('Building a school garden');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}

test('source quick start restores the brief and submits all lesson settings together', async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.goto('/#/start/file');
  await page.locator('#topic').fill('Classroom gardens');
  await page.locator('#source-text').fill('Beans grow towards the light. The class measured the stems after one week.');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('radiogroup')).toHaveCount(4);
  await page.getByRole('radio',{name:'Another audience'}).click();
  await page.getByRole('textbox',{name:'Another audience'}).fill('First-year horticulture students');
  await page.reload();
  await expect(page.getByText('How long is the lesson?',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Another audience'})).toHaveValue('First-year horticulture students');
  await page.getByRole('radio',{name:'Exact slide count'}).click();
  await page.getByRole('spinbutton').fill('9');
  await page.getByRole('radio',{name:'Image-led slides'}).click();
  await page.getByRole('radio',{name:'Use my own question'}).click();
  await page.getByRole('textbox',{name:'Use my own question'}).fill('Why did the stems bend?');
  const creating=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname==='/api/decks');
  await page.locator('.creation-actions button[type=submit]').click();
  const body=(await creating).postDataJSON();
  expect(body).toMatchObject({slideCount:9, imageMode:'image-led', answers:{level:'First-year horticulture students',
    imageSource:'ai',quiz:'include',quizInstruction:'Why did the stems bend?'}});
  expect(body.source.text).toContain('Beans');
});
