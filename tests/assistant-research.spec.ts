import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { AssistantMessage, AssistantSnapshot } from '@sabaq/contracts/assistant';

const path = '/api/decks/schoolyard-en/assistant';

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  await page.addInitScript(() => localStorage.setItem('sabaq:locale','en'));
});

test('the assistant sends a one-turn research request and renders progress and cited sources', async ({page}) => {
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json:{...await response.json(), assistantWebResearch:true}});
  });
  let snapshot: AssistantSnapshot = {messages:[]};
  await page.route('**'+path, async route => {
    if (route.request().method() === 'GET') return route.fulfill({json:snapshot});
    const {clientId, slideId, text, webResearch} = route.request().postDataJSON();
    snapshot = {activeClientId:clientId, messages:[
      {id:'user-'+clientId, role:'user', text, slideId, webResearch},
      {id:'assistant-'+clientId, role:'assistant', text:'', slideId, status:'running',
        activity:[{id:'web-step', kind:'web_research', status:'running'}]},
    ]};
    await route.fulfill({contentType:'application/x-ndjson', body:JSON.stringify(snapshot)+'\n'});
  });

  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  await panel.getByRole('button',{name:'Web tools',exact:true}).click();
  const web = page.getByRole('switch',{name:'Search the web'});
  await expect(web).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('button',{name:'Web search',exact:true})).toBeDisabled();
  await expect(page.getByText('Exa searches your public question. AlemLLM writes the answer.')).toBeVisible();
  await web.click();
  await page.getByRole('button',{name:'Deep research',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deep research',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  const input = panel.getByRole('textbox',{name:'What should I research?'});
  await input.fill('What fraction of Earth is covered by water?');
  const post = page.waitForRequest(request => request.method()==='POST' && new URL(request.url()).pathname===path);
  await input.press('Enter');
  const sent = (await post).postDataJSON();
  expect(sent).toMatchObject({text:'What fraction of Earth is covered by water?', webResearch:'research'});
  expect(sent).not.toHaveProperty('sourceFileIds');
  expect(sent).not.toHaveProperty('canvasScope');
  await expect(panel.getByRole('status')).toHaveText('Researching the web…');
  await expect(panel.locator('.as-tool-step')).toContainText('Exa');
  await expect(panel.getByRole('article',{name:'You',exact:true})).toContainText('Deep research');
  await expect(panel.getByRole('textbox',{name:'Ask about this slide…'})).toBeVisible();

  const [prompt, reply] = snapshot.messages;
  const complete: AssistantMessage = {
    ...reply, status:'complete', text:'Water covers about 71% of Earth. [1]',
    activity:[{id:'web-step', kind:'web_research', status:'complete', count:1},
      {id:'write-step', kind:'write_web_answer', status:'complete'}],
    webSources:[
      {id:'nasa', title:'NASA Earth facts', url:'https://science.nasa.gov/earth/facts/', excerpt:'About 71% of the planet is covered in water.'},
      {id:'invalid-url', title:'Unsafe link', url:'javascript:alert(1)'},
    ],
  };
  snapshot = {messages:[prompt, complete]};
  await expect(panel.locator('.as-tool-step').filter({hasText:'Exa'})).toHaveAttribute('data-state','complete');
  await expect(panel.locator('.as-tool-step').filter({hasText:'AlemLLM'})).toHaveAttribute('data-state','complete');
  await expect(panel.getByRole('link',{name:'1',exact:true})).toHaveAttribute('href','https://science.nasa.gov/earth/facts/');
  await panel.getByRole('button',{name:'Web sources (1)'}).click();
  await expect(panel.getByRole('link',{name:/NASA Earth facts/})).toHaveAttribute('rel','noopener noreferrer');
  await expect(panel.getByText('Unsafe link')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button',{name:'Export Markdown',exact:true}).click();
  const artifact = await downloading;
  expect(artifact.suggestedFilename()).toBe('sabaq-research.md');
  expect(await readFile(await artifact.path(),'utf8')).toContain('1. [NASA Earth facts](<https://science.nasa.gov/earth/facts/>)');
});

test('unconfigured Exa describes its availability without blocking ordinary lesson prompts', async ({page}) => {
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    await route.fulfill({response,json:{...await response.json(), assistantWebResearch:false}});
  });
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  await panel.getByRole('button',{name:'Web tools',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Search the web'})).toBeDisabled();
  await expect(page.getByText('Exa is unavailable in this workspace.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox',{name:'Ask about this slide…'})).toBeEditable();
});
