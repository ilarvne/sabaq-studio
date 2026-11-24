import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Deck } from '@sabaq/lesson/types';
import type { VideoJob, VideoState } from '@sabaq/contracts/video';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
});

test('an opened presentation can show every slide and image after disconnection', async ({context, page, request}) => {
  const deck: Deck = await (await request.get('/api/decks/schoolyard-kk')).json();
  const slides = deck.slides.filter(slide => slide.status === 'ready');
  expect(slides.some(slide => slide.image?.src)).toBe(true);
  await page.goto('/#/deck/schoolyard-kk/present');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Ready to present offline')).toBeVisible();
  await context.setOffline(true);
  try {
    for (const [index, slide] of slides.entries()) {
      const active = dialog.locator('section.present article');
      await expect(active).toHaveAttribute('data-slide-id', slide.id);
      if (slide.image) {
        const image = active.locator('img.ed-slide-image');
        await expect(image).toHaveAttribute('src', /^blob:/);
        await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
      if (index < slides.length - 1) {
        if (slide.answer) await dialog.getByRole('button', { name: 'Reveal answer' }).click();
        await dialog.getByRole('button', { name: 'Next slide' }).click();
      }
    }
  } finally {
    await context.setOffline(false);
  }
});

test('jump directly to a named slide in the editor and export preview', async ({page, request})=>{
  const deck: Deck = await (await request.get('/api/decks/schoolyard-en')).json();
  const index = 3;
  await page.goto('/#/deck/schoolyard-en');
  const picker = page.getByRole('combobox', {name:'Go to slide', exact:true});
  await picker.selectOption(String(index));
  await expect(page.locator('.ed-stage article')).toHaveAttribute('data-slide-id',deck.slides[index].id);
  await page.getByRole('tab',{name:'Design',exact:true}).click();
  await expect(page.locator('.inspect-design h2').first()).toHaveText(deck.slides[index].title);
  await page.getByRole('button',{name:'Lesson actions'}).click();
  await page.getByRole('menuitem',{name:'Export',exact:true}).click();
  const dialog = page.getByRole('dialog');
  const preview = dialog.getByRole('combobox',{name:'Go to slide',exact:true});
  await expect(preview).toHaveValue(String(index));
  await preview.selectOption('1');
  await expect(dialog.locator('.rv-preview-board article')).toHaveAttribute('data-slide-id',deck.slides[1].id);
});

test('a phone can edit slide text and open the presenter poll without horizontal scrolling', async ({browser,baseURL,request})=>{
  const phone = await browser.newContext({baseURL, viewport:{width:375,height:812}, isMobile:true, hasTouch:true});
  try {
    const page = await phone.newPage();
    await page.addInitScript(()=>localStorage.setItem('sabaq:locale','en'));
    const created=await request.post('/api/decks',{data:{topic:'Phone editor',language:'en',template:'blank',provider:'fixture',review:false,slideCount:3}});
    const deck:Deck=await created.json();
    await page.goto('/#/deck/'+deck.id);
    await expect(page.locator('.ed-stage article')).toBeVisible();
    await expect(page.locator('.ed-stage [data-slot-entry]')).toHaveCount(0);
    await expect(page.getByText('Use a computer to edit directly on the canvas.')).toBeVisible();
    await page.getByRole('toolbar').getByRole('button',{name:'Text',exact:true}).click();
    const sheet=page.getByRole('dialog');
    await sheet.locator('[contenteditable=true]').fill('Water measurements from the class.');
    await sheet.getByRole('button',{name:'Done',exact:true}).click();
    await expect(page.locator('.ed-stage')).toContainText('Water measurements from the class.');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(375);
    await page.getByRole('tab',{name:'Assistant',exact:true}).click();
    await expect(page.locator('.as-composer textarea')).toBeVisible();
    await page.getByRole('button',{name:'Present',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const speaker=dialog.getByRole('button',{name:'Speaker view',exact:true});
    await speaker.click();
    const thumbnail = await dialog.locator('.rv-next-slide .rv-mini').boundingBox();
    const caption = await dialog.locator('.rv-next-title').boundingBox();
    expect(thumbnail!.x + thumbnail!.width).toBeLessThan(caption!.x);
    await speaker.click();
    await dialog.getByRole('button',{name:'Class poll',exact:true}).click();
    const panel=dialog.getByRole('region',{name:'Class poll',exact:true});
    await expect(panel.getByLabel('Question',{exact:true})).toBeVisible();
    const bounds=await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(375);
  } finally { await phone.close(); }
});

test('export downloads the saved lesson as a PowerPoint file', async ({page})=>{
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button',{name:'Lesson actions'}).click();
  await page.getByRole('menuitem',{name:'Export',exact:true}).click();
  const dialog=page.getByRole('dialog');
  const pending=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
  const download=await pending;
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const bytes=await readFile(await download.path());
  expect(bytes.subarray(0,4)).toEqual(Buffer.from([0x50,0x4b,3,4]));
});

test('presenter window tracks the projected lesson and keeps answers hidden until revealed', async ({
  page,
  request,
}) => {
  const deck = (await (await request.get('/api/decks/schoolyard-en')).json()) as Deck;
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const current = dialog.locator('section.present article');
  await expect(current).toHaveAttribute('data-slide-id', deck.slides[0].id);
  await dialog.getByRole('button', { name: 'Speaker view' }).click();
  const elapsed = dialog.locator('.rv-elapsed strong');
  await expect(elapsed).not.toHaveText('00:00');
  await expect(dialog.getByText(/left on this slide|past the slide target|On schedule/)).toBeVisible();

  // The teacher can read a note even when both receiver frames are waiting for the deck.
  let releaseReceivers!: () => void;
  const receiversReady = new Promise<void>((resolve) => { releaseReceivers = resolve; });
  const pendingReceivers = new Set<string>();
  await page.context().route('**/api/decks/schoolyard-en', async (route) => {
    const frameUrl = route.request().frame().url();
    if (frameUrl.includes('lessonProjection=')) {
      pendingReceivers.add(frameUrl);
      await receiversReady;
    }
    await route.continue();
  });
  const opened = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Open speaker window' }).click();
  const speaker = await opened;
  const upcoming = speaker.frameLocator('#upcoming-slide iframe').locator('section.present article');
  const notes = speaker.locator('.speaker-controls-notes .value');
  try {
    await expect(notes).toHaveText(deck.slides[0].notes);
    await expect(notes).toBeVisible();
    const speakerElapsed = speaker.locator('#lesson-presentation-elapsed');
    await expect(speakerElapsed).not.toHaveText('00:00');
    await expect.poll(async () => {
      const [popupTime, inlineTime] = await Promise.all([speakerElapsed.textContent(), elapsed.textContent()]);
      return popupTime === inlineTime;
    }).toBe(true);
    await dialog.getByRole('button', { name: 'Next slide' }).click();
    await expect(notes).toHaveText(deck.slides[1].notes);
    await dialog.getByRole('button', { name: 'Previous slide' }).click();
    await expect(notes).toHaveText(deck.slides[0].notes);
    await expect.poll(() => pendingReceivers.size, { timeout: 15000 }).toBe(2);
  } finally {
    releaseReceivers();
  }
  await expect(upcoming).toHaveAttribute('data-slide-id', deck.slides[1].id);
  await speaker.getByRole('button', { name: 'Reset timer', exact: true }).click();
  await expect(elapsed).toHaveText('00:00');
  await expect(speaker.locator('#lesson-presentation-elapsed')).toHaveText('00:00');
  await dialog.getByRole('button', { name: 'Next slide' }).click();
  await expect(upcoming).toHaveAttribute('data-slide-id', deck.slides[2].id);
  await expect(notes).toHaveText(deck.slides[1].notes);

  const quiz = deck.slides.findIndex((slide) => !!slide.answer);
  for (let i = 1; i < quiz; i++) await dialog.getByRole('button', { name: 'Next slide' }).click();
  await expect(current).toHaveAttribute('data-slide-id', deck.slides[quiz].id);
  await expect(current.locator('.ed-slide-answer')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(current).toContainText(deck.slides[quiz].answer!);
  await dialog.getByRole('button', { name: 'Black out screen' }).click();
  await expect(dialog.locator('.rv-stage')).toHaveClass(/paused/);
  await dialog.getByRole('button', { name: 'Show slide' }).click();
  await expect(dialog.locator('.rv-stage')).not.toHaveClass(/paused/);
  await dialog.getByRole('button', { name: 'End presentation' }).click();
  await expect.poll(() => speaker.isClosed()).toBe(true);
});

test('video export explains an unavailable worker without offering a simulation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/decks/schoolyard-en/video', route =>
    route.fulfill({ json: { enabled: false, avatar: false } satisfies VideoState }));
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button', { name: 'Create video lesson', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Video export is unavailable', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Generate video lesson', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('img', { name: /fictional character/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Start preview|Replay preview|Simulate scene error/ })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(375);
});

test('video export renders server progress, cancels, and downloads only a matching ready revision', async ({ page, request }) => {
  const deckPath = '/api/decks/schoolyard-en';
  const deck: Deck = await (await request.get(deckPath)).json();
  const videoPath = `${deckPath}/video`;
  let job: VideoJob = {
    key: 'a'.repeat(64), revision: deck.revision + 1,
    settings: { language: deck.language, aspect: '16:9', position: 'none', captions: true },
    status: 'ready', completed: deck.slides.length, total: deck.slides.length,
  };
  let starts = 0;
  const state = (): VideoState => ({ enabled: true, avatar: false, narrationOnly: true, job });
  await page.route(/\/api\/decks\/schoolyard-en\/video(?:\/cancel)?$/, async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      if (request.url().endsWith('/cancel')) {
        job = { ...job, status: 'cancelled' };
      } else {
        const input = request.postDataJSON() as Pick<VideoJob, 'revision' | 'settings'>;
        job = {
          ...input,
          key: String(++starts).padStart(64, '0'),
          status: 'queued',
          completed: 0,
          total: deck.slides.length,
        };
      }
    }
    await route.fulfill({ json: state() });
  });
  await page.route(/\/api\/decks\/schoolyard-en\/video\/[0-9a-f]{64}\/file(?:\?play=1)?$/, route =>
    route.fulfill({
      contentType: 'video/mp4',
      headers: { 'Content-Disposition': `${route.request().url().endsWith('?play=1') ? 'inline' : 'attachment'}; filename="lesson.mp4"` },
      body: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
    }));
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button', { name: 'Create video lesson', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const generate = dialog.getByRole('button', { name: 'Generate video lesson', exact: true });
  const download = dialog.getByRole('link', { name: 'Download MP4', exact: true });
  const subtitles = dialog.getByRole('checkbox', { name: 'Subtitles', exact: true });

  await expect(subtitles).toBeChecked();
  await expect(generate).toBeEnabled();
  await expect(download).toHaveCount(0);
  const start = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === videoPath);
  await generate.click();
  expect((await start).postDataJSON()).toMatchObject({
    revision: deck.revision, settings: { language: deck.language, aspect: '16:9', position: 'none', captions: true },
  });
  await expect(dialog.getByText('Queued for export', { exact: true })).toBeVisible();
  await expect(download).toHaveCount(0);

  job = { ...job, status: 'running', completed: 1 };
  await expect(dialog.getByText('Rendering slides', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('progressbar', { name: 'Video export progress' })).toBeVisible();
  const cancel = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === `${videoPath}/cancel`);
  await dialog.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await cancel;
  await expect(dialog.getByText('Export cancelled', { exact: true })).toBeVisible();
  await expect(download).toHaveCount(0);

  await generate.click();
  await expect(dialog.getByText('Queued for export', { exact: true })).toBeVisible();
  job = { ...job, status: 'verifying', completed: deck.slides.length };
  await expect(dialog.getByText('Verifying video markings', { exact: true })).toBeVisible();
  await expect(download).toHaveCount(0);

  job.status = 'ready';
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', `${videoPath}/${job.key}/file`);
  await dialog.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(dialog.locator('video[controls]')).toHaveAttribute('src', `${videoPath}/${job.key}/file?play=1`);
  await dialog.getByRole('button', { name: 'Back to slides', exact: true }).click();
  await subtitles.uncheck();
  await expect(download).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await subtitles.check();
  const saved = page.waitForEvent('download');
  await download.click();
  expect((await saved).suggestedFilename()).toBe('lesson.mp4');
  expect(starts).toBe(2);
});

test('export downloads the selected slide as a PNG file', async ({ page }) => {
  await page.goto('/#/deck/schoolyard-en');
  await page.getByRole('button', { name: 'Lesson actions' }).click();
  await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /PNG/ }).click();
  await expect(dialog.getByText('One slide', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PNG' }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.png$/u);
});

test('restoring the selected snapshot creates a new revision and preserves the previous edit', async ({
  page,
  request,
}) => {
  const url = '/api/decks/schoolyard-ru';
  const original = (await (await request.get(url)).json()) as Deck;
  const changed = await request.patch(url, {
    data: {
      operationId: crypto.randomUUID(),
      baseRevision: original.revision,
      op: { kind: 'deck', title: 'Проверка истории' },
    },
  });
  expect(changed.ok()).toBe(true);
  const edited = (await changed.json()) as Deck;
  const themed = await request.patch(url, {
    data: {
      operationId: crypto.randomUUID(),
      baseRevision: edited.revision,
      op: { kind: 'deck', theme: original.theme === 'blueprint' ? 'notebook' : 'blueprint' },
    },
  });
  expect(themed.ok()).toBe(true);
  const version = original.revision;
  await page.goto('/#/deck/schoolyard-ru');
  await page.getByRole('button', { name: 'Lesson actions' }).click();
  await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.rv-version').first()).toContainText('Theme change');
  await dialog.getByRole('button', { name: new RegExp('Version ' + version + '\\b') }).click();
  await expect(dialog.locator('.rv-history-main')).toContainText(original.title);
  await dialog.getByRole('button', { name: 'Restore this version' }).click();
  await expect(dialog.locator('.rv-version').first()).toContainText('Restored');
  const restored = (await (await request.get(url)).json()) as Deck;
  expect(restored.title).toBe(original.title);
  expect(restored.theme).toBe(original.theme);
  expect(restored.revision).toBe(version + 3);
  await expect(dialog.locator('.rv-version')).toHaveCount(version + 4);
});
