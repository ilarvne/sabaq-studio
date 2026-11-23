import {expect, test} from '@playwright/test';
import type {SourceFile} from '@sabaq/contracts/source-files';

test('a teacher can save multiple files, find and download them, reuse them in a prompt, and remove a file', async ({page, request}) => {
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:375,height:880});
  await page.goto('/#/files');
  await expect(page.getByRole('heading',{name:'My files'})).toBeVisible();
  const first = {name:'river-count.txt',mimeType:'text/plain',buffer:Buffer.from('The class counted 29 river pebbles.')};
  const second = {name:'river-map.md',mimeType:'text/markdown',buffer:Buffer.from('The map shows the sampling stations.')};
  const chosen = page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload files',exact:true}).click();
  await (await chosen).setFiles([first,second]);
  await expect(page.getByRole('status').filter({hasText:'Files saved: 2'})).toBeVisible();
  const table=page.getByRole('table',{name:'My files'});
  await expect(table.getByText(first.name,{exact:true})).toBeVisible();
  await expect(table.getByText(second.name,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);

  const transfer = await page.evaluateHandle(()=>{
    const data = new DataTransfer();
    data.items.add(new File(['Bring a measuring tape.'],'river-equipment.txt',{type:'text/plain'}));
    return data;
  });
  const dropzone = page.getByRole('region',{name:'Add teaching materials'});
  await dropzone.dispatchEvent('dragenter',{dataTransfer:transfer});
  await expect(page.getByRole('heading',{name:'Drop to upload'})).toBeVisible();
  await page.getByRole('region',{name:'Drop to upload'}).dispatchEvent('drop',{dataTransfer:transfer});
  await expect(table.getByText('river-equipment.txt',{exact:true})).toBeVisible();

  const filter = page.getByRole('combobox',{name:'File type'});
  await filter.click();
  await page.getByRole('option',{name:'MD',exact:true}).click();
  await expect(table.getByText(second.name,{exact:true})).toBeVisible();
  await expect(table.getByText(first.name,{exact:true})).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Find a file…'}).fill('count');
  await expect(page.getByText('No matching files',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).click();
  await expect(table.getByText(first.name,{exact:true})).toBeVisible();

  await page.getByRole('searchbox',{name:'Find a file…'}).fill('count');
  await expect(table.getByText(second.name,{exact:true})).toHaveCount(0);

  const downloaded = page.waitForEvent('download');
  await table.getByRole('link',{name:`Download · ${first.name}`}).click();
  expect((await downloaded).suggestedFilename()).toBe(first.name);
  const files: SourceFile[] = await (await request.get('/api/source-files')).json();
  const source = files.find(file=>file.name===first.name)!;
  expect(source.size).toBe(first.buffer.length);

  await page.setViewportSize({width:1400,height:880});
  await page.goto('/#/start/source');
  const picker=page.getByRole('dialog',{name:'Choose from My files'});
  await page.getByRole('button',{name:'Choose from My files'}).click();
  await picker.getByRole('checkbox',{name:/river-count\.txt/}).check();
  await picker.getByRole('checkbox',{name:/river-map\.md/}).check();
  await picker.getByRole('button',{name:'Use selected files'}).click();
  await expect(page.getByRole('textbox',{name:'Lesson topic'})).toHaveValue('river-count');
  await expect(page.getByRole('button',{name:`Remove from lesson · ${second.name}`})).toBeVisible();

  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const assistant=page.locator('.lesson-assistant');
  await assistant.getByRole('button',{name:'Choose from My files'}).click();
  await picker.getByRole('checkbox',{name:/river-count\.txt/}).check();
  await picker.getByRole('button',{name:'Use selected files'}).click();
  await expect(assistant.getByText('Saved in My files')).toBeVisible();
  const send=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname==='/api/decks/schoolyard-en/assistant');
  const input=assistant.getByPlaceholder('Ask about this slide…');
  await input.fill('How many river pebbles did the class count?');
  await input.press('Enter');
  expect((await send).postDataJSON()).toMatchObject({sourceFileIds:[source.id]});
  const answer=assistant.locator('.as-assistant').last();
  await answer.getByText(/29 river pebbles/).first().waitFor();
  await answer.locator('.as-sources summary').click();
  await expect(answer.getByRole('link',{name:first.name})).toHaveAttribute('href',`/api/source-files/${source.id}/download`);

  await assistant.getByRole('button',{name:'Choose from My files'}).click();
  await picker.getByRole('button',{name:'Search all my files'}).click();
  await expect(assistant.getByText('Using all my files')).toBeVisible();
  const libraryRequest=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname==='/api/decks/schoolyard-en/assistant');
  await input.fill('Which document mentions the sampling stations?');
  await input.press('Enter');
  expect((await libraryRequest).postDataJSON()).toMatchObject({searchSourceLibrary:true});
  const libraryAnswer=assistant.locator('.as-assistant').last();
  await expect(libraryAnswer.getByRole('button',{name:'Ask again'})).toBeVisible();
  await libraryAnswer.locator('.as-sources:not([open]) summary').click();
  await expect(libraryAnswer.getByRole('link',{name:second.name})).toBeVisible();
  await expect(libraryAnswer.locator('.as-sources blockquote').filter({hasText:'sampling stations'})).toBeVisible();

  await page.goto('/#/files');
  await table.getByRole('button',{name:`Delete · ${first.name}`}).click();
  await page.getByRole('dialog',{name:'Delete this file?'}).getByRole('button',{name:'Delete',exact:true}).click();
  await expect(table.getByText(first.name,{exact:true})).toHaveCount(0);
  await expect(table.getByText(second.name,{exact:true})).toBeVisible();
  expect((await request.get(`/api/source-files/${source.id}/download`)).status()).toBe(404);
});

test('sending matching source excerpts to Alem requires a fresh opt-in for each assistant turn', async ({page, request}) => {
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await request.post('/api/source-files/txt?name=cloud-scope.txt',{
    headers:{'content-type':'application/octet-stream'},data:Buffer.from('The experiment measured 26 rice grains.'),
  });
  await page.route('**/api/capabilities',async route=>{
    const upstream=await route.fetch();
    await route.fulfill({response:upstream,json:{...await upstream.json(),cloudSourceRag:true}});
  });
  await page.route('**/api/decks/schoolyard-en/assistant',route=>
    route.request().method()==='POST' ? route.fulfill({status:503,json:{error:'fixture-only'}}) : route.continue());
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const assistant=page.locator('.lesson-assistant');
  const cloud=assistant.getByRole('checkbox',{name:'Send matching excerpts to Alem for this reply'});
  const input=assistant.getByPlaceholder('Ask about this slide…');
  const chooseSources=async()=>{
    await assistant.getByRole('button',{name:'Choose from My files'}).click();
    await page.getByRole('button',{name:'Search all my files'}).click();
    await expect(cloud).toBeEnabled();
  };
  await chooseSources();
  await expect(cloud).not.toBeChecked();
  await cloud.check();
  const sent=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname==='/api/decks/schoolyard-en/assistant');
  await input.fill('How many rice grains did the experiment measure?');
  await input.press('Enter');
  expect((await sent).postDataJSON()).toMatchObject({searchSourceLibrary:true,useCloudSourceRag:true});
  await expect(assistant.getByRole('alert')).toBeVisible();
  if (!await cloud.isVisible()) await chooseSources();
  await expect(cloud).not.toBeChecked();
});
