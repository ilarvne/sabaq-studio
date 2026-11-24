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

  await page.setViewportSize({width:1400,height:880});
  const sidebar = page.locator('.creation-shell [data-slot=sidebar-inner]');
  const filesDisclosure = sidebar.getByRole('button',{name:'Files',exact:true});
  await expect(page.getByRole('button',{name:'Toggle navigation',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Hide workspace panel',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Studio guide',exact:true})).toHaveCount(0);
  await expect(filesDisclosure).toHaveAttribute('aria-expanded','false');
  await expect(sidebar.getByRole('link',{name:first.name})).toBeHidden();
  await filesDisclosure.press('Enter');
  await expect(filesDisclosure).toHaveAttribute('aria-expanded','true');
  await expect(sidebar.locator('a[href="#/files"]')).toHaveCount(1);
  await expect(sidebar.getByRole('link',{name:'My files',exact:true})).toHaveAttribute('href','#/files');
  await expect(sidebar.getByRole('link',{name:first.name})).toBeVisible();
  await expect(sidebar.getByRole('link',{name:second.name})).toBeVisible();

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
  await expect(sidebar.getByRole('link',{name:'river-equipment.txt'})).toBeVisible();

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
  const sidebarFile = sidebar.getByRole('link',{name:first.name});
  await expect(sidebarFile).toHaveAttribute('href',`/api/source-files/${source.id}/download`);
  const sidebarDownload = page.waitForEvent('download');
  await sidebarFile.click();
  expect((await sidebarDownload).suggestedFilename()).toBe(first.name);

  await page.goto('/#/start/source');
  const picker=page.getByRole('dialog',{name:'Add files'});
  await page.getByRole('button',{name:'Add files',exact:true}).click();
  await picker.getByRole('checkbox',{name:/river-count\.txt/}).check();
  await picker.getByRole('checkbox',{name:/river-map\.md/}).check();
  await picker.getByRole('button',{name:'Use selected files'}).click();
  await expect(page.getByRole('textbox',{name:'Lesson topic'})).toHaveValue('river-count');
  await expect(page.getByRole('button',{name:`Remove from lesson · ${second.name}`})).toBeVisible();

  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const assistant=page.locator('.lesson-assistant');
  await assistant.getByRole('button',{name:'Attach source material',exact:true}).click();
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

  await assistant.getByRole('button',{name:'Attach source material',exact:true}).click();
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
  await filesDisclosure.click();
  await expect(sidebarFile).toBeVisible();
  await table.getByRole('button',{name:`Delete · ${first.name}`}).click();
  await page.getByRole('dialog',{name:'Delete this file?'}).getByRole('button',{name:'Delete',exact:true}).click();
  await expect(table.getByText(first.name,{exact:true})).toHaveCount(0);
  await expect(table.getByText(second.name,{exact:true})).toBeVisible();
  await expect(sidebarFile).toHaveCount(0);
  await expect(sidebar.getByRole('link',{name:second.name})).toBeVisible();
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
    await assistant.getByRole('button',{name:'Attach source material',exact:true}).click();
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

test('one picker combines a library file with a new upload on a phone', async ({page,request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  await page.setViewportSize({width:320,height:720});
  const saved = 'picker-existing.txt', fresh = 'picker-uploaded.txt';
  const seeded = await request.post('/api/source-files/txt?name='+saved,{
    headers:{'content-type':'application/octet-stream'},data:Buffer.from('A class activity about river measurements.'),
  });
  expect(seeded.ok()).toBe(true);
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel=page.locator('.lesson-assistant');
  const trigger=panel.getByRole('button',{name:'Attach source material',exact:true});
  const picker=page.getByRole('dialog',{name:'Add files',exact:true});
  await trigger.click();
  await expect(picker.getByRole('tab',{name:'My files'})).toHaveAttribute('aria-selected','true');
  const search=picker.getByRole('searchbox',{name:'Find a file…'});
  await search.fill('no matching picker file');
  await expect(picker.getByText('No matching files',{exact:true})).toBeVisible();
  const empty = (await picker.locator('.source-picker-empty').boundingBox())!;
  const surface = (await picker.boundingBox())!;
  expect(empty.x + empty.width / 2).toBeCloseTo(surface.x + surface.width / 2,0);
  await search.fill('picker-existing');
  await picker.getByRole('checkbox',{name:saved}).check();
  await picker.getByRole('tab',{name:'Upload',exact:true}).click();
  const data = await page.evaluateHandle(fileName=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File(['A second class activity on water.'],fileName,{type:'text/plain'}));
    return transfer;
  },fresh);
  await picker.getByRole('region',{name:'Upload from your device'}).dispatchEvent('drop',{dataTransfer:data});
  await expect(picker.getByRole('checkbox',{name:fresh})).toBeChecked();
  await expect(picker.getByRole('button',{name:'Choose files',exact:true})).toBeDisabled();
  const box=await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  await picker.getByRole('button',{name:'Use selected files'}).click();
  await expect(picker).toHaveCount(0);
  await expect(panel.locator('.as-file')).toHaveCount(2);
  await expect(panel.locator('.as-file').filter({hasText:saved})).toBeVisible();
  await expect(panel.locator('.as-file').filter({hasText:fresh})).toBeVisible();
  const files=(await (await request.get('/api/source-files')).json()) as SourceFile[];
  expect(files).toEqual(expect.arrayContaining([expect.objectContaining({name:fresh})]));
});
