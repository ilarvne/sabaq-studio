import { expect,test } from '@playwright/test';
import type { Deck } from '@sabaq/lesson/types';

test('two teachers see overlapping edits, live cursors and their own undo',async({browser,request,baseURL},info)=>{
  test.setTimeout(90_000);
  const identity=(name:string)=>({'x-studio-gateway':process.env.STUDIO_E2E_ORG_TEST_KEY!,'x-studio-user':name,'x-studio-org':'school'});
  const owner=identity('teacher-one'), editor=identity('teacher-two');
  const create=await request.post('/api/decks',{headers:owner,data:{topic:'Өсімдіктер',template:'blank',language:'kk',provider:'fixture',review:false}});
  expect(create.status()).toBe(201);const deck=await create.json() as Deck;
  const api='/api/decks/'+deck.id;
  expect((await request.put(api+'/access',{headers:owner,data:{subject:'teacher-two',permission:'edit'}})).ok()).toBe(true);
  const a=await browser.newContext({baseURL,extraHTTPHeaders:owner}),b=await browser.newContext({baseURL,extraHTTPHeaders:editor});
  const traffic=new Set<string>();
  try {
    const [first,second]=await Promise.all([a.newPage(),b.newPage()]);
    for(const page of [first,second]){
      await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
      page.on('request',r=>traffic.add(new URL(r.url()).origin));
    }
    await Promise.all([first.goto('/#/deck/'+deck.id+'/coedit'),second.goto('/#/deck/'+deck.id+'/coedit')]);
    const left=first.getByRole('textbox',{name:'Slide text'}), right=second.getByRole('textbox',{name:'Slide text'});
    await expect(left).toBeEditable();await expect(right).toBeEditable();
    const started=Date.now();
    await Promise.all([left.fill('Ә'),right.fill('Қ')]);
    await expect.poll(async()=>{const [x,y]=await Promise.all([left.inputValue(),right.inputValue()]);return x===y?x.length:0;},{intervals:[25,40,60]}).toBe(2);
    const observation=Date.now()-started;
    console.log('Two-browser coediting propagation: '+observation+' ms');
    await left.focus();await left.press('End');
    await expect(second.locator('.co-mirror i[title="teacher-one"]')).toBeVisible();
    await first.getByRole('button',{name:'Undo my edit'}).click();
    await expect(right).toHaveValue('Қ');
    await expect(left).toHaveValue('Қ');
    await first.getByRole('button',{name:'Redo my edit'}).click();
    await expect.poll(async()=>(await right.inputValue()).length).toBe(2);
    expect([...traffic].filter(origin=>origin!==new URL(baseURL!).origin)).toEqual([]);
    await info.attach('coedit-latency.json',{body:JSON.stringify({overlapUntilBothObservedMs:observation,origins:[...traffic]}),contentType:'application/json'});
    if(process.env.STUDIO_COEDIT_GATE==='1')expect(observation).toBeLessThanOrEqual(1000);
    await request.delete(api+'/access/teacher-two',{headers:owner});
    await expect(right).not.toBeEditable();
    await second.locator('.collaboration-header .decknav-trigger').click();
    await expect(second.getByRole('dialog').getByRole('link',{name:'Home',exact:true})).toBeVisible();
  }finally{await Promise.all([a.close(),b.close()]);}
});


test('a view-only invitation keeps its workspace navigation visible when scrolled', async ({browser,request,baseURL})=>{
  const identity=(subject:string)=>({'x-studio-gateway':process.env.STUDIO_E2E_ORG_TEST_KEY!,
    'x-studio-user':subject,'x-studio-org':'school'});
  const owner=identity('view-owner');
  const response=await request.post('/api/decks',{headers:owner,data:{topic:'Shared reading',template:'blank',language:'en',provider:'fixture',review:false}});
  expect(response.status()).toBe(201);
  const deck:Deck=await response.json();
  expect((await request.put('/api/decks/'+deck.id+'/access',{headers:owner,data:{subject:'view-reader',permission:'view'}})).ok()).toBe(true);
  const reader=await browser.newContext({baseURL,extraHTTPHeaders:identity('view-reader'),viewport:{width:720,height:320}});
  try {
    await reader.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
    const page=await reader.newPage();
    await page.goto('/#/deck/'+deck.id+'/coedit');
    await expect(page.locator('.readonly-lesson article')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
    const header=page.locator('.collaboration-header');
    expect((await header.boundingBox())!.y).toBe(0);
    await header.locator('.decknav-trigger').press('Enter');
    const menu=page.getByRole('dialog');
    await expect(menu).toBeVisible();
    await menu.getByRole('link',{name:'Home',exact:true}).click();
    await expect(page).toHaveURL(/#\/home$/);
  } finally { await reader.close(); }
});
