import { expect, test } from '@playwright/test';

test.use({ launchOptions: {
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
} });

test('the composer requests approval for scanned PDFs and inserts Alem dictation into the draft', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(timeslice) {
      this.addEventListener('dataavailable', event => {
        if (event.data.size) document.body.dataset.recorded = 'true';
      });
      start.call(this, timeslice);
    };
  });
  await page.route('**/api/media/capabilities', route => route.fulfill({ json: { ocr: true, transcription: ['en'] } }));
  let localReads = 0;
  let approvedReads = 0;
  await page.route('**/api/source-files/pdf?*', route => {
    if (new URL(route.request().url()).searchParams.get('ocr') === 'alem') {
      approvedReads++;
      return route.fulfill({status:201,json:{
        id:'20a49ded-1c34-46ac-b931-15feb0c86033',name:'diagram.pdf',format:'pdf',size:8,characterCount:35,createdAt:new Date().toISOString(),
      }});
    }
    localReads++;
    return route.fulfill({ status: 422, json: { error: 'scan' } });
  });
  await page.route(url => url.pathname === '/api/media/transcriptions/en', route => {
    expect(route.request().postDataBuffer()?.byteLength).toBeGreaterThan(100);
    return route.fulfill({ json: { text: 'Explore the water cycle' } });
  });
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/');
  const brief = page.getByRole('textbox', { name: 'Presentation brief' });
  await page.getByRole('button', { name: 'Dictate using online transcription' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recording…' })).toBeAttached();
  await expect(page.locator('body')).toHaveAttribute('data-recorded', 'true');
  await page.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(brief).toHaveValue('Explore the water cycle');

  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Send this scan to Alem to extract its text?');
    expect(localReads).toBe(1);
    expect(approvedReads).toBe(0);
    await dialog.accept();
  });
  const file = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach source material' }).click();
  await (await file).setFiles({ name: 'diagram.pdf', mimeType: 'application/pdf', buffer: Buffer.from('mock PDF') });
  await expect(page.locator('.as-file')).toHaveAttribute('data-status', 'requires-action');
  expect(approvedReads).toBe(1);
});

test('microphone controls keep one icon and stable bounds through recording and transcription', async ({page,request}) => {
  test.setTimeout(80_000);
  await page.addInitScript(() => {
    localStorage.setItem('sabaq:locale','en');
    Object.defineProperty(window,'SpeechRecognition',{value:undefined});
    Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined});
    const recorderStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(timeslice) {
      delete document.body.dataset.recorded;
      this.addEventListener('dataavailable', event => {if(event.data.size)document.body.dataset.recorded='true';});
      recorderStart.call(this,timeslice);
    };
  });
  await page.route('**/api/media/capabilities', route=>route.fulfill({json:{ocr:false,transcription:['en']}}));
  const created=await request.post('/api/decks',{data:{topic:'Voice notes',template:'blank',provider:'fixture',language:'en',review:false}});
  const deck=await created.json();
  const processing=(url:URL)=>url.pathname==='/api/media/transcriptions/en';
  for (const width of [320,375]) {
    await page.setViewportSize({width,height:812});
    for (const home of [true,false]) {
      await page.goto(home ? '/' : '/#/deck/'+deck.id);
      if (!home) await page.getByRole('tab',{name:'Assistant',exact:true}).click();
      const toolbar=page.locator(home ? '.home-prompt-toolbar' : '.as-composer-tools');
      const microphone = toolbar.locator('.composer-voice');
      await expect(microphone).toBeEnabled();
      const idle = await microphone.boundingBox();
      async function checkIcon() {
        await expect(microphone.locator('svg')).toHaveCount(1);
        await expect(microphone).toHaveText('');
        await microphone.scrollIntoViewIfNeeded();
        const bounds=await microphone.boundingBox();
        expect(bounds?.width).toBe(idle?.width);
        expect(bounds?.height).toBe(idle?.height);
        expect(await microphone.evaluate(button=>{
          const r=button.getBoundingClientRect(),icon=button.querySelector('svg')!.getBoundingClientRect();
          return r.left>=0 && r.right<=innerWidth && icon.left>=r.left && icon.right<=r.right &&
            Math.abs((icon.left+icon.right-r.left-r.right)/2)<1 && Math.abs((icon.top+icon.bottom-r.top-r.bottom)/2)<1;
        })).toBe(true);
      }
      await checkIcon();
      await microphone.click();
      await expect(microphone).toHaveAttribute('data-voice-phase','recording');
      await checkIcon();
      await expect(page.locator('body')).toHaveAttribute('data-recorded','true');
      let deliver:()=>void=()=>{};
      const hold=new Promise<void>(resolve=>{deliver=resolve;});
      await page.route(processing,async route=>{await hold;await route.fulfill({json:{text:'Record the result'}});});
      await microphone.click();
      await expect(microphone).toHaveAttribute('data-voice-phase','processing');
      await expect(microphone).toHaveAttribute('aria-label','Cancel transcription');
      await checkIcon();
      deliver();
      await expect(microphone).toHaveAttribute('data-voice-phase','idle');
      await page.unroute(processing);
      const post=home ? '**/api/decks' : '**/api/decks/'+deck.id+'/assistant';
      let release:()=>void=()=>{};
      const waiting=new Promise<void>(resolve=>{release=resolve;});
      await page.route(post,async route=>{
        if(route.request().method()!=='POST'){await route.continue();return;}
        await waiting;
        await route.fulfill({status:503,json:{error:'Temporarily unavailable'}});
      });
      await toolbar.getByRole('button',{name:home ? 'Generate' : 'Send message',exact:true}).click();
      await expect(microphone).toBeDisabled();
      await checkIcon();
      release();
      await expect(microphone).toBeEnabled();
      await page.unroute(post);
    }
  }
});
