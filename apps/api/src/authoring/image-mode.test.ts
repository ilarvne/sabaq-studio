import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createInput } from '@sabaq/contracts/schema';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { CreateInput, Deck } from '@sabaq/lesson/types';
import { Studio } from '../lessons/studio';
import { makePowerPoint } from '../media/powerpoint';
import { StudioStore } from '../persistence/storage';
import { catalogRoot } from '../runtime-paths';

const common = { topic: 'Plant growth', language: 'en', provider: 'fixture', review: false } as const;

async function waitForDeck(studio: Studio, id: string, predicate: (deck: Deck) => boolean) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const deck = studio.deck(id);
    if (predicate(deck)) return deck;
    await delay(4);
  }
  throw new Error('Deck did not reach the expected generation state');
}

test('fixture creation applies explicit visual layouts and retains native text and full-slide imagery in PowerPoint', async t => {
  const mediaRoot = await mkdtemp(join(tmpdir(), 'sabaq-image-mode-'));
  const studio = new Studio(new StudioStore(':memory:'), 0, mediaRoot);
  t.after(async () => { await studio.close(); await rm(mediaRoot, { recursive: true, force: true }); });
  for (const mode of ['illustrated', 'image-led', 'auto'] as const) {
    const input = createInput.parse({ ...common, imageMode: mode, answers: { duration: '10' } });
    const { id } = studio.create(input);
    const deck = await waitForDeck(studio, id, d => d.phase === 'editing');
    assert.equal(deck.imageMode, mode);
    assert.equal(deck.slides.length, 5);
    assert.ok(deck.slides.every(slide => slide.status === 'ready' && slide.body.trim()));
    if (mode === 'auto') {
      assert.ok(deck.slides.every(slide => !slide.image));
      continue;
    }
    assert.equal(deck.slides[0].image?.provenance?.source, 'catalog');
    assert.equal(deck.slides[0].image?.src, '/assets/seedling-growth.webp');
    assert.ok(deck.slides.slice(1).every(slide => slide.image?.decorative && slide.image.src.startsWith('/api/media/')));
    assert.equal(new Set(deck.slides.map(slide => slide.image?.src)).size, 5);
    assert.deepEqual(deck.slides.map(slide => slide.layout), mode === 'image-led'
      ? Array(5).fill('image-full') : ['image-right', 'image-left', 'image-right', 'image-left', 'image-right']);
    if (mode === 'image-led') {
      const archive = await JSZip.loadAsync(await makePowerPoint(deck, { catalog: catalogRoot, generated: mediaRoot }));
      const xml = await archive.file('ppt/slides/slide1.xml')!.async('string');
      assert.ok(xml.indexOf('<p:pic>') >= 0 && xml.indexOf('<p:pic>') < xml.indexOf('Plant growth'));
      assert.match(xml, /<a:t>Plant growth<\/a:t>/u);
      assert.match(xml, /Image contrast overlay/u);
      assert.match(xml, /<a:off x="0" y="0"\/><a:ext cx="\d{8}" cy="6858000"\/>/u);
    }
  }
});

test('text-only legacy and explicit choices suppress sample images, including after reopening and retrying', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sabaq-image-mode-retry-'));
  const db = join(dir, 'studio.sqlite');
  let studio = new Studio(new StudioStore(db), 6, dir);
  t.after(async () => { await studio.close(); await rm(dir, { recursive: true, force: true }); });
  const sample = makeFixtureDeck('en');
  for (const options of [{ answers: { image: 'none' } }, { imageMode: 'none', answers: { image: 'illustrations' } }] satisfies Partial<CreateInput>[]) {
    const { id } = studio.create({ ...common, ...options, slideCount: 7, source: sample.source });
    const pending = await waitForDeck(studio, id, d => d.phase === 'generating' && d.slides.length > 0);
    await studio.close();
    studio = new Studio(new StudioStore(db), 0, dir);
    const interrupted = studio.deck(id);
    assert.equal(interrupted.imageMode, 'none');
    studio.generate(id);
    const complete = await waitForDeck(studio, id, d => d.phase === 'editing' && d.slides.every(slide => slide.status === 'ready'));
    assert.equal(complete.slides.length, pending.slides.length);
    assert.ok(complete.slides.every(slide => !slide.image && !slide.layout.startsWith('image-')));
    assert.ok(complete.slides.some(slide => slide.table || slide.chart));
  }
});

test('automatic lesson generation inserts OpenAI art only on eligible lessons and never redraws data slides', async t => {
  const names=['OPENAI_API_KEY','STUDIO_IMAGE_ENDPOINT','STUDIO_IMAGE_MODEL','STUDIO_IMAGE_VERIFY_MODEL','STUDIO_AUTH_MODE','STUDIO_MODERATION_OLLAMA_MODEL'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.OPENAI_API_KEY='test-image-key';
  const dir=await mkdtemp(join(tmpdir(),'sabaq-openai-autogen-'));
  const studio=new Studio(new StudioStore(':memory:'),0,dir);
  t.after(async()=>{
    await studio.close();
    for (const [name,value] of Object.entries(previous)) {
      if (value===undefined) delete process.env[name]; else process.env[name]=value;
    }
    await rm(dir,{recursive:true,force:true});
  });
  const png=await sharp({create:{width:320,height:180,channels:3,background:'#829bbb'}}).png().toBuffer();
  const worker=t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
    assert.equal(url.href,'https://api.openai.com/v1/images/generations');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-image-key');
    const {n,prompt,size}=JSON.parse(String(init.body));
    assert.equal(n,1);
    assert.equal(size,'1536x864');
    assert.match(prompt,/Plant growth/u);
    return Response.json({data:[{b64_json:png.toString('base64')}]});
  });
  const lesson=studio.create({...common,imageMode:'auto',slideCount:10});
  const ready=await waitForDeck(studio,lesson.id,deck=>deck.phase==='editing');
  const images=ready.slides.filter(slide=>slide.image?.provenance?.source==='generated');
  assert.equal(images.length,5);
  assert.ok(images.every(slide=>slide.image?.alt && !slide.table && !slide.chart && !slide.diagram));
  assert.equal(worker.mock.callCount(),5);

  for (const options of [{ imageMode:'none' as const },{ imageMode:'auto' as const,source:{name:'Private classroom notes',text:'A privately supplied source for the lesson.'} }]) {
    const other=studio.create({...common,...options,slideCount:5});
    await waitForDeck(studio,other.id,deck=>deck.phase==='editing');
  }
  assert.equal(worker.mock.callCount(),5);
});
