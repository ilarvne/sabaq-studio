import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import type { Deck } from '@sabaq/lesson/types';

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
});

for (const [width, height] of [[1440, 900], [820, 1180], [375, 812], [320, 640]]) {
  test(`the assistant opens ready for a new editor visit at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height});
    await page.addInitScript(() => localStorage.setItem('sabaq:inspector-collapsed', 'true'));
    await page.goto('/#/deck/schoolyard-en');
    const assistant = page.getByRole('tab', {name: 'Assistant', exact: true});
    const notes = page.getByRole('tab', {name: 'Lecture text', exact: true});
    const prompt = page.getByRole('textbox', {name: 'Ask about this slide…'});
    await expect(assistant).toHaveAttribute('aria-selected', 'true');
    await expect(prompt).toBeEditable();
    await expect(prompt).toBeInViewport({ratio: 1});
    await notes.click();
    await page.getByRole('combobox', {name: 'Go to slide'}).selectOption('2');
    await expect(notes).toHaveAttribute('aria-selected', 'true');
    if (width > 960) {
      await page.getByRole('button', {name: 'Slide settings', exact: true}).click();
      await expect(prompt).toHaveCount(0);
    }
    await page.reload();
    await expect(assistant).toHaveAttribute('aria-selected', 'true');
    await expect(prompt).toBeEditable();
    await expect(prompt).toBeInViewport({ratio: 1});
    await notes.click();
    await page.goto('/#/deck/schoolyard-en/grid');
    await page.getByRole('button', {name: 'Edit slide', exact: true}).click();
    await expect(assistant).toHaveAttribute('aria-selected', 'true');
    await prompt.fill('Explain this slide to the class.');
    await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeEnabled();
  });
}

test('an offline answer keeps its sources and can be exported or requested again', async ({page})=>{
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const composer=page.getByPlaceholder('Ask about this slide…');
  const promptText = 'What were the measured volumes in the containers?';
  const waitForPrompt = () => page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname==='/api/decks/schoolyard-en/assistant');
  const sent = waitForPrompt();
  const viewport=page.locator('.as-viewport');
  await viewport.evaluate(root=>{
    const prefixes:string[]=[];
    new MutationObserver(()=>{
      const text=root.querySelector('[data-slot="streaming-text"]')?.textContent?.trim();
      if(text && text!==prefixes.at(-1)) {prefixes.push(text);root.setAttribute('data-seen-prefixes',JSON.stringify(prefixes));}
    }).observe(root,{subtree:true,childList:true,characterData:true});
  });
  await composer.fill(promptText);
  await composer.press('Enter');
  const original = (await sent).postDataJSON();
  const sources=page.locator('.as-sources').last();
  await expect(sources.locator('summary')).toContainText('Sources');
  const prefixes:string[]=JSON.parse(await viewport.getAttribute('data-seen-prefixes') ?? '[]');
  expect(prefixes.length).toBeGreaterThan(0);
  expect(prefixes.every((text,index)=>index===0 || text.startsWith(prefixes[index-1]))).toBe(true);
  await sources.locator('summary').click();
  await expect(sources.locator('blockquote').first()).toBeVisible();
  const excerpt=await sources.locator('blockquote').first().innerText();
  await page.reload();
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  await sources.locator('summary').click();
  await expect(sources.locator('blockquote').first()).toHaveText(excerpt);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Markdown',exact:true}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  expect((await readFile(await download.path(),'utf8')).trim().length).toBeGreaterThan(0);

  await page.getByRole('button',{name:/^Slide 4 · /}).click();
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  await expect(page.locator('.as-context')).toContainText('Selected slide · 4 /');
  const retry = waitForPrompt();
  await page.getByRole('button',{name:'Ask again',exact:true}).click();
  const retried = (await retry).postDataJSON();
  expect(retried).toMatchObject({text:promptText,slideId:original.slideId});
  expect(retried.clientId).not.toBe(original.clientId);
  await expect(page.getByText(promptText,{exact:true})).toHaveCount(2);
});

test('a direct request previews changes on the selected slide and restores the proposal after reopening', async ({page, request})=>{
  const deckUrl = '/api/decks/schoolyard-en';
  const deck: Deck = await (await request.get(deckUrl)).json();
  const fixtureSlide = deck.slides[2];
  const update = await request.patch(deckUrl,{data:{op:{kind:'slide',slideId:fixtureSlide.id,baseVersion:fixtureSlide.version,
    changes:{body:'Record a new observation. Repeat this explanation in discussion. There were 17 observations.'}}}});
  expect(update.ok()).toBe(true);
  const slide = ((await update.json()) as Deck).slides[2];
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button',{name:/^Slide 3 · /}).click();
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  await expect(panel.getByRole('log')).toHaveAttribute('aria-busy','false');
  const composer = panel.getByPlaceholder('Ask about this slide…');
  await expect(panel.getByRole('button',{name:'AI actions',exact:true})).toHaveCount(0);
  await composer.press('Slash');
  await expect(composer).toHaveValue('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await composer.fill('Shorten the text on this slide.');
  const posted = page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname===`${deckUrl}/assistant`);
  await composer.press('Enter');
  expect((await posted).postDataJSON()).toMatchObject({slideId:slide.id,text:'Shorten the text on this slide.'});
  await expect(composer).toHaveValue('');

  await page.getByRole('button',{name:/^Slide 4 · /}).click();
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  await expect(panel.locator('.as-context')).toContainText('Selected slide · 4 /');
  const proposal = panel.getByRole('region',{name:'Proposed changes'});
  await proposal.getByRole('button',{name:'Compare slides'}).click();
  const comparison = page.getByRole('dialog',{name:'Compare slides'});
  const before = comparison.getByRole('figure').filter({hasText:/^Before/});
  const after = comparison.getByRole('figure').filter({hasText:/^After/});
  await expect(before).toContainText(slide.title);
  await expect(after).toContainText(slide.title);
  await expect(before.locator('article')).toHaveAttribute('data-slide-id',slide.id);
  await expect(after.locator('article')).toHaveAttribute('data-slide-id',slide.id);
  await expect(before.locator('.ed-slide-body')).toHaveText(slide.body);
  const shortened = await after.locator('.ed-slide-body').innerText();
  expect(shortened).toContain('17 observations');
  expect(shortened.trim().length).toBeLessThan(slide.body.length);
  await comparison.getByRole('button',{name:'Close'}).click();
  await expect(panel.getByRole('region',{name:'Pending changes'}).getByRole('button',{name:'Apply changes'})).toBeEnabled();
  expect((await (await request.get(deckUrl)).json() as Deck).slides[2].body).toBe(slide.body);

  await expect(page.locator('.ed-proposal-preview')).toHaveCount(0);
  await page.getByRole('button',{name:/^Slide 3 · /}).click();
  const canvas = page.locator('.ed-stage');
  const preview = page.getByRole('group',{name:'Change preview',exact:true});
  await expect(canvas).toHaveAttribute('data-preview','proposed');
  await expect(canvas.locator('.ed-slide-body')).toHaveText(shortened);
  await preview.getByRole('button',{name:'Original',exact:true}).click();
  await expect(canvas.locator('.ed-slide-body')).toHaveText(slide.body);
  await preview.getByRole('button',{name:'Proposed',exact:true}).click();
  await expect(canvas.locator('.ed-slide-body')).toHaveText(shortened);

  const turn = panel.locator('.as-assistant').filter({has:page.getByRole('region',{name:'Proposed changes'})});
  await expect(turn.getByText('I prepared these changes for your review.',{exact:true})).toHaveCount(0);
  await expect(turn.getByRole('button',{name:/^Tool activity/})).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  await expect(proposal.getByRole('button',{name:'Compare slides'})).toBeVisible();

  await page.setViewportSize({width:352,height:820});
  await proposal.scrollIntoViewIfNeeded();
  await expect(panel.getByRole('region',{name:'Pending changes'}).getByRole('button',{name:'Apply changes'})).toBeVisible();
  await expect.poll(()=>proposal.evaluate(card=>{
    const bounds = card.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= window.innerWidth + 1 && card.scrollWidth <= card.clientWidth + 1
      && Array.from(card.querySelectorAll('button, a')).every(control=>{
        const controlBounds = control.getBoundingClientRect();
        return controlBounds.left >= bounds.left - 1 && controlBounds.right <= bounds.right + 1;
      });
  })).toBe(true);
  const {default: AxeBuilder} = await import('@axe-core/playwright');
  const audit = await new AxeBuilder({page}).include('.as-change-card').withRules(['color-contrast']).analyze();
  expect(audit.violations).toEqual([]);

  await page.setViewportSize({width:375,height:460});
  await proposal.getByRole('button',{name:'Compare slides'}).click();
  const scroller=comparison.locator('[data-slot=scroll-area-viewport]');
  const applyInComparison=comparison.getByRole('button',{name:'Apply changes'});
  await expect(applyInComparison).toBeInViewport({ratio:1});
  await scroller.evaluate((element)=>{element.scrollTop=element.scrollHeight;});
  await expect.poll(()=>scroller.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
  await expect(applyInComparison).toBeInViewport({ratio:1});
  await applyInComparison.focus();
  await applyInComparison.press('Enter');
  await expect(comparison).toBeHidden();
  await expect(proposal).toContainText('Changes applied');
});

test('a running assistant keeps icon-free Thinking text while tool activity changes', async ({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>localStorage.setItem('sabaq:dark','1'));
  let snapshot: AssistantSnapshot = {messages:[]};
  let showHistory!: () => void, acceptMessage!: () => void;
  const waitForHistory=new Promise<void>(resolve=>{showHistory=resolve;});
  const waitForSend=new Promise<void>(resolve=>{acceptMessage=resolve;});
  await page.route('**/api/decks/schoolyard-en/assistant',async route=>{
    if (route.request().method()==='GET') {await waitForHistory;return route.fulfill({json:snapshot});}
    await waitForSend;
    const {clientId,slideId,text} = route.request().postDataJSON();
    snapshot = {activeClientId:clientId,messages:[
      {id:`user-${clientId}`,role:'user',text,slideId},
      {id:`assistant-${clientId}`,role:'assistant',text:'Reading the lesson…',slideId,status:'running',
        activity:[{id:'search',kind:'search_lesson',status:'running'}]},
    ]};
    await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(snapshot)+'\n'});
  });
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  await expect(panel.locator('[data-slot="generation-loader"]')).toBeVisible();
  showHistory();
  await expect(panel.getByRole('log')).toHaveAttribute('aria-busy','false');
  const composer = panel.getByPlaceholder('Ask about this slide…');
  await composer.fill('What is this slide about?');
  await composer.press('Enter');
  await expect(panel.locator('[data-slot="typing-indicator"]')).toBeVisible();
  acceptMessage();
  const working = panel.locator('[data-slot="thinking-indicator"]');
  await expect(working).toBeVisible();
  await expect(working).toHaveText('Thinking…');
  await expect(working).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(working).toHaveCSS('border-top-width','0px');
  await expect(working.locator('svg')).toHaveCount(0);
  await expect(panel.locator('.as-author-mark')).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveCount(1);
  await expect(panel.getByRole('status')).toHaveText('Thinking…');
  await expect(panel.getByText('Reading the lesson…',{exact:true})).toHaveCount(0);
  const animates = ()=>working.evaluate(el=>[el,...el.querySelectorAll('*')].some(node=>
    [null,'::before','::after'].some(pseudo=>getComputedStyle(node,pseudo).animationName!=='none')));
  await expect.poll(animates).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(animates).toBe(false);

  const [prompt, response] = snapshot.messages;
  await expect(panel.getByRole('button',{name:/^Tool activity/})).toHaveCount(0);
  snapshot = {activeClientId:snapshot.activeClientId,messages:[prompt,{...response,activity:[
    {id:'search',kind:'search_lesson',status:'complete',count:2},
    {id:'draft',kind:'prepare_edit',status:'running'},
  ]}]};
  await expect(panel.getByText('Edit draft',{exact:true})).toHaveCount(0);
  await expect(panel.getByText('Lesson search',{exact:true})).toHaveCount(0);
  await expect(working).toHaveText('Thinking…');
  await expect(panel.getByRole('status')).toHaveText('Thinking…');

  snapshot = {activeClientId:snapshot.activeClientId,messages:[prompt,{...response,streamingText:'The class compares'}]};
  const partial=panel.locator('[data-slot="streaming-text"]');
  await expect(partial).toContainText('The class compares');
  await expect(working).toBeHidden();
  await expect(panel.getByRole('status')).toHaveText('Writing…');
  await expect(panel.getByRole('article',{name:'You',exact:true})).toBeVisible();
  await expect(panel.getByText('You',{exact:true})).toHaveCount(0);
  snapshot = {messages:[prompt,{...response,status:'complete',text:'The class compares water volumes.',
    activity:[{id:'search',kind:'search_lesson',status:'complete',count:2},{id:'draft',kind:'prepare_edit',status:'complete'}]}]};
  await expect(working).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveText('Response ready.');
  await expect(panel.locator('.as-reply-text')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(panel.getByText('The class compares water volumes.',{exact:true})).toBeVisible();
  const followups=panel.getByRole('group',{name:'Follow-up suggestions'});
  const example=followups.getByRole('button',{name:'Give an example',exact:true});
  await expect(example).toBeVisible();
  const sent=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname.endsWith('/assistant'));
  await example.click();
  expect((await sent).postDataJSON().text).toBe('Give a concrete classroom example of the idea in your last reply.');
  await expect(followups).toBeHidden();
});

test('no-evidence follow-ups offer existing slide notes and avoid repeating an exhausted request',async({page})=>{
  const missing='I couldn’t find support for that in this lesson. Try a more specific term or add the source material.';
  let question='What does the glacier study say about water?';
  const response=()=>({messages:[
    {id:'question',role:'user',text:question,slideId:'s01'},
    {id:'recovery',role:'assistant',text:missing,slideId:'s01',status:'complete'},
  ]});
  await page.route('**/api/decks/schoolyard-en/assistant',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:response()});
    question=route.request().postDataJSON().text;
    return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(response())+'\n'});
  });
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const followups=page.getByRole('group',{name:'Follow-up suggestions'});
  await expect(followups.getByRole('button')).toHaveCount(1);
  await followups.getByRole('button',{name:'Show slide notes',exact:true}).click();
  await expect.poll(()=>question).toBe('Show the speaker notes for this slide.');
  await expect(followups).toBeHidden();
});

test('a slide mention sets the request target and math in replies renders as KaTeX', async ({page})=>{
  const assistantUrl = '/api/decks/schoolyard-en/assistant';
  const formula = String.raw`V=\ell w h`;
  await page.route(`**${assistantUrl}`,async route=>{
    if (route.request().method()==='GET') return route.fulfill({json:{messages:[]}});
    const {clientId,slideId,text} = route.request().postDataJSON();
    const snapshot: AssistantSnapshot = {messages:[
      {id:`user-${clientId}`,role:'user',text,slideId},
      {id:`assistant-${clientId}`,role:'assistant',text:`The volume is $${formula}$.`,slideId,status:'complete'},
    ]};
    await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(snapshot)+'\n'});
  });

  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  await expect(panel.locator('.as-context')).toContainText('Selected slide · 1 /');
  await expect(panel.getByRole('log')).toHaveAttribute('aria-busy','false');
  const composer = panel.getByPlaceholder('Ask about this slide…');
  await composer.pressSequentially('Shorten @');
  const options = panel.getByRole('listbox',{name:'Mention a slide'});
  await options.getByRole('option',{name:/^Slide 3\b/}).click();
  await expect(options).toBeHidden();
  const posted = page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname===assistantUrl);
  await composer.press('Enter');
  expect((await posted).postDataJSON()).toMatchObject({slideId:'s03',text:'Shorten this slide'});

  const math = panel.locator('.as-markdown .katex');
  await expect(math).toBeVisible();
  await expect(math.locator('annotation[encoding="application/x-tex"]')).toHaveText(formula);
});

test('a document in the composer grounds the response without copying into the prompt', async ({page, request})=>{
  const assistantUrl = '/api/decks/schoolyard-kk/assistant';
  const fileName = 'lunar-notes.txt';
  const finding = 'The lunar calibration team marked the landing grid with 47 cobalt pennants.';
  const text = ['Field notes from the Apollo teaching simulation.',finding].join('\n');
  const prompt = 'How did the lunar calibration team mark the landing grid?';
  await page.goto('/#/deck/schoolyard-kk');
  await page.getByRole('tab',{name:'Assistant',exact:true}).click();
  const panel = page.locator('.lesson-assistant');
  const picking = page.waitForEvent('filechooser');
  await panel.getByRole('button',{name:'Attach source material',exact:true}).click();
  await (await picking).setFiles({name:fileName,mimeType:'text/plain',buffer:Buffer.from(text)});
  await expect(panel.locator('.as-composer').getByText(fileName,{exact:true})).toBeVisible();
  await expect(panel.locator('.as-file').filter({hasText:fileName})).toHaveAttribute('data-status','requires-action');

  const sent = page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname===assistantUrl);
  const composer = panel.getByPlaceholder('Ask about this slide…');
  await composer.fill(prompt);
  await composer.press('Enter');
  const posted = (await sent).postDataJSON();
  expect(posted).toMatchObject({text:prompt,sourceFileIds:[expect.any(String)]});
  expect(posted).not.toHaveProperty('attachments');
  const saved = await request.get('/api/source-files/' + posted.sourceFileIds[0]);
  expect(await saved.json()).toMatchObject({name:fileName,text});
  const userMessage = panel.locator('.as-user').last();
  await expect(userMessage).toContainText(fileName);
  await expect(userMessage).toContainText(prompt);
  await expect(userMessage).not.toContainText(finding);
  const answer = panel.locator('.as-assistant').last();
  await expect(answer.locator('.as-message-body')).toContainText(finding);
  await answer.locator('.as-sources summary').click();
  await expect(answer.locator('.as-sources').getByText(fileName,{exact:true})).toBeVisible();
  const stored: AssistantSnapshot = await (await request.get(assistantUrl)).json();
  expect(stored.messages.findLast(message=>message.role==='user')).toMatchObject({text:prompt,fileNames:[fileName]});
});

test('a teacher can review a persisted slide order before approving it', async ({page, request})=>{
  const created = await request.post('/api/decks', { data: {
    topic: 'Order review lesson', template: 'blank', language: 'en', provider: 'fixture', review: false,
  }});
  await expect(created).toBeOK();
  let original: Deck = await created.json();
  const deckUrl = `/api/decks/${original.id}`;
  for (const title of ['Materials', 'Measurements', 'Conclusion']) {
    const inserted = await request.patch(deckUrl, { data: { op: { kind: 'add' } } });
    await expect(inserted).toBeOK();
    const { slides }: Deck = await inserted.json();
    const slide = slides.at(-1)!;
    const updated = await request.patch(deckUrl, { data: {
      op: { kind: 'slide', slideId: slide.id, baseVersion: slide.version, changes: { title } },
    }});
    await expect(updated).toBeOK();
    original = await updated.json();
  }
  const currentOrder = original.slides.map(slide => slide.title);
  const proposedOrder = [...currentOrder];
  const [moved] = proposedOrder.splice(1, 1);
  proposedOrder.splice(3, 0, moved);

  await page.goto(`/#/deck/${original.id}`);
  await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const composer = page.getByPlaceholder('Ask about this slide…');
  await composer.fill('Move slide 2 to position 4.');
  await composer.press('Enter');
  const proposal = page.getByRole('region', { name: 'Proposed changes' });
  await expect(proposal).toContainText(`Based on lesson version ${original.revision}`);
  await page.reload();
  await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await proposal.getByText('Review slide order', { exact: true }).click();
  await expect(proposal.getByRole('list', { name: 'Before' }).getByRole('listitem')).toHaveText(currentOrder);
  await expect(proposal.getByRole('list', { name: 'After' }).getByRole('listitem')).toHaveText(proposedOrder);
  const beforeApproval: Deck = await (await request.get(deckUrl)).json();
  expect(beforeApproval.revision).toBe(original.revision);
  expect(beforeApproval.slides.map(slide => slide.title)).toEqual(currentOrder);

  await page.getByRole('region', {name: 'Pending changes'}).getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(proposal).toContainText('Changes applied');
  const afterApproval: Deck = await (await request.get(deckUrl)).json();
  expect(afterApproval.revision).toBe(original.revision + 1);
  expect(afterApproval.slides.map(slide => slide.title)).toEqual(proposedOrder);
});

test('a sensitive classroom topic can be confirmed in the creation form', async ({page})=>{
  await page.goto('/#/library');
  await page.getByRole('button',{name:'New lesson',exact:true}).click();
  await page.getByLabel('Lesson topic',{exact:true}).fill('History of the schoolyard');
  for(let i=0;i<4;i++) await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Lesson outline',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'sensitive classroom topic'})).toBeVisible();
  await page.getByRole('button',{name:'Create anyway',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lesson outline'})).toBeVisible();
});

test('canvas editing actions keep the selected slide in the assistant request', async ({page, request})=>{
  await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
  const created=await request.post('/api/decks',{data:{topic:'Garden observations',language:'en',provider:'fixture',template:'blank',review:false}});
  await expect(created).toBeOK();
  const lesson:Deck=await created.json();
  const slide=lesson.slides[0];
  const body='Record the plant height. Repeat this explanation in discussion. Compare the two plants.';
  await expect(await request.patch('/api/decks/'+lesson.id,{data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{body}}}})).toBeOK();
  await page.goto('/#/deck/'+lesson.id);
  await page.locator('.ed-stage [data-slot-entry="body"]').click({button:'right'});
  const menu=page.getByRole('menu',{name:'Edit with AI'});
  const posted=page.waitForRequest(req=>req.method()==='POST' && new URL(req.url()).pathname===`/api/decks/${lesson.id}/assistant`);
  await menu.getByRole('menuitem',{name:'Shorten',exact:true}).click();
  expect((await posted).postDataJSON()).toMatchObject({slideId:slide.id,text:'Shorten the text on this slide.'});
  await expect(page.getByRole('region',{name:'Proposed changes'})).toBeVisible();
  const saved:Deck=await (await request.get('/api/decks/'+lesson.id)).json();
  expect(saved.slides[0].body).toBe(body);
});

test('pending approval stays visible over a long conversation and commits the reviewed lesson', async ({page, request}) => {
  await page.setViewportSize({width: 1440, height: 720});
  const deck: Deck = await (await request.post('/api/decks', {data: {topic:'Weather records', template:'blank', language:'en', provider:'fixture', review:false}})).json();
  const api = '/api/decks/' + deck.id;
  const slide = deck.slides[0];
  await expect(await request.patch(api, {data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{notes:'Compare the observations recorded in each group before sharing the patterns with the class. '.repeat(18)}}}})).toBeOK();
  for (const text of ['Show speaker notes.', 'Show speaker notes.', 'Use the Editorial theme.']) {
    const result = await request.post(api + '/assistant', {data: {text, locale: 'en', slideId: deck.slides[0].id, clientId: crypto.randomUUID()}});
    expect(result.ok()).toBe(true);
  }
  await page.goto('/#/deck/' + deck.id);
  const panel = page.locator('.lesson-assistant');
  const bar = panel.getByRole('region', {name: 'Pending changes'});
  const apply = bar.getByRole('button', {name: 'Apply changes'});
  const log = panel.getByRole('log');
  await expect(apply).toBeEnabled();
  await expect(panel.getByRole('button', {name: 'Apply changes'})).toHaveCount(1);
  expect(await log.evaluate(node => node.scrollHeight > node.clientHeight * 2)).toBe(true);
  await log.evaluate(node => { node.scrollTop = 0; });
  await expect(apply).toBeInViewport({ratio: 1});
  await expect(panel.getByRole('region', {name: 'Proposed changes'})).not.toBeInViewport();
  await apply.click();
  await expect(bar).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(api)).json() as Deck).theme).toBe('editorial');
});

test('numeric slide tables can be converted to a real chart from the phone AI menu', async ({page, request}) => {
  await page.setViewportSize({width: 375, height: 812});
  const deck: Deck = await (await request.post('/api/decks', {data: {topic:'Leaf measurements', template:'blank', language:'en', provider:'fixture', review:false}})).json();
  const api = '/api/decks/' + deck.id;
  const slide = deck.slides[0];
  await expect(await request.patch(api, {data:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{table:{headers:['Leaf','Length'],rows:[['A',6],['B',12]]}}}}})).toBeOK();
  await page.goto('/#/deck/' + deck.id);
  await page.getByRole('button', {name: 'Edit with AI', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Edit with AI'});
  await expect(menu.getByRole('menuitem', {name: 'Translate', exact: true})).toBeDisabled();
  await menu.getByRole('menuitem', {name: 'Convert to chart'}).click();
  const bar = page.getByRole('region', {name: 'Pending changes'});
  await expect(page.locator('.ed-stage .ed-slide-chart')).toBeVisible();
  await bar.getByRole('button', {name: 'Apply changes'}).click();
  await expect.poll(async () => ((await (await request.get(api)).json()) as Deck).slides[0].chart?.series[0].values).toEqual([6,12]);
});

test('element translation and custom canvas requests target the selected field and slide', async ({page}) => {
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), localAssistant: true}});
  });
  await page.goto('/#/deck/schoolyard-en');
  const title = page.locator('.ed-stage [data-slot-entry="title"]');
  await title.click({button:'right'});
  const menu = page.getByRole('menu', {name: 'Edit with AI'});
  await menu.getByRole('menuitem', {name: 'Custom request'}).click();
  const composer = page.getByRole('textbox', {name: 'Ask about this slide…'});
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(/the title/);
  await composer.fill('');
  await title.click({button:'right'});
  await expect(menu.getByRole('menuitem', {name: 'Add an example'})).toBeEnabled();
  await menu.getByRole('menuitem', {name: 'Translate', exact: true}).press('ArrowRight');
  const languages = page.getByRole('menu', {name: 'Translate', exact: true});
  await expect(languages.getByRole('menuitem')).toHaveText(['Қазақша','Русский','English']);
  const posted = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/schoolyard-en/assistant'));
  await languages.getByRole('menuitem', {name: 'Русский'}).click();
  const body = (await posted).postDataJSON();
  expect(body.slideId).toBe('s01');
  expect(body.text).toMatch(/Translate the title into Russian/);
});
