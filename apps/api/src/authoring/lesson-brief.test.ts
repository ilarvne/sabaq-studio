import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

const lesson = { topic:'Growing beans', language:'en', provider:'fixture', slideCount:3, review:false };

async function completed(app: ReturnType<typeof createStudioServer>, id: string) {
  for (let attempt=0; attempt<400; attempt++) {
    const deck = (await app.inject({url:'/api/decks/'+id})).json<Deck>();
    if (deck.phase==='editing') return deck;
    await delay(10);
  }
  throw new Error('The fixture lesson did not finish generating.');
}

test('a custom quiz and teacher-supplied image reach the outline and editable slides', async t => {
  const mediaRoot=await mkdtemp(join(tmpdir(),'sabaq-brief-'));
  const app=createStudioServer({dbPath:':memory:',mediaRoot,fixtureDelay:1});
  t.after(async()=> { await app.close(); await rm(mediaRoot,{recursive:true,force:true}); });
  const png=await sharp({create:{width:128,height:64,channels:3,background:'#fdd810'}}).png().toBuffer();
  const question='What would you change in the next trial?';
  const created=await app.inject({method:'POST',url:'/api/decks',payload:{...lesson,answers:{
    quiz:'include',quizInstruction:question,imageSource:'own',ownImage:{alt:'Seed pots on a desk',data:png.toString('base64')},
  }}});
  assert.equal(created.statusCode,201,created.body);
  const deck=await completed(app,created.json<Deck>().id);
  const check=deck.outline.find(item=>item.assessment);
  assert.equal(check?.summary,question);
  assert.ok(deck.outline.every(item=>item.narrationDraft));
  assert.ok(deck.slides.find(slide=>slide.id===check?.id)?.answer);
  assert.equal(deck.slides.filter(slide=>slide.image).length,1);
  assert.equal(deck.slides[0].image?.alt,'Seed pots on a desk');
  assert.equal(deck.slides[0].image?.provenance?.source,'upload');
  assert.equal((await app.inject({url:deck.slides[0].image?.src})).statusCode,200);
  assert.ok(!JSON.stringify(deck).includes(png.toString('base64')));
});

test('the no-image and no-quiz choices override inherited fixture content', async t => {
  const app=createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  const created=await app.inject({method:'POST',url:'/api/decks',payload:{...lesson,slideCount:10,sourceDeckId:'schoolyard-en',answers:{
    imageSource:'none',quiz:'omit',
  }}});
  assert.equal(created.statusCode,201,created.body);
  const deck=await completed(app,created.json<Deck>().id);
  assert.equal(deck.slides.length,10);
  assert.ok(deck.slides.every(slide=>slide.status==='ready'));
  assert.ok(deck.slides.every(slide=>!slide.image && !slide.answer));
  assert.ok(deck.outline.every(item=>!item.assessment && !item.visualDescription));
});
