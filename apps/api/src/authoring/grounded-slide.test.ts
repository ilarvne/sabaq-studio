import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

test('local document authoring retrieves evidence and falls back to the cited source if a model invents a number', async t => {
  const restore = process.env.STUDIO_AUTHORING_MODEL;
  process.env.STUDIO_AUTHORING_MODEL = 'test-local';
  t.after(()=>{ if (restore===undefined) delete process.env.STUDIO_AUTHORING_MODEL; else process.env.STUDIO_AUTHORING_MODEL=restore; });
  const app = createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  let calls = 0;
  let planCalls = 0;
  t.mock.method(globalThis,'fetch',async (url:URL|string,init?:RequestInit)=>{
    assert.equal(new URL(url).hostname,'127.0.0.1');
    if (new URL(url).pathname==='/api/tags') return Response.json({models:[{name:'test-local:latest',digest:'local-model',details:{format:'gguf'}}]});
    const {messages}=JSON.parse(String(init?.body));
    const input=JSON.parse(messages[1].content);
    if (input.count) {
      planCalls++;
      assert.ok(!('agenda' in input));
      assert.ok(!('source' in input));
      assert.equal(input.passages.length,3);
      const slides=Array.from({length:input.count},(_,i)=>({
        title:'Inspect the observations',summary:'Read the class evidence.',purpose:'Decide what the class can infer.',
        section:'Working with measurements',layout:i===1?'native-table':'centered',sourceExcerptId:i===2?'unverified':input.passages[1].id,
      }));
      return Response.json({message:{content:JSON.stringify({slides})}});
    }
    assert.ok(input.passages.length>0 && input.passages.length<=4);
    assert.ok(input.purpose);
    assert.ok(!('role' in input));
    const ref=input.passages[0];
    calls++;
    return Response.json({message:{content:JSON.stringify({title:'Classroom observations',
      body:calls===1?'Impossible result: 9999. A ruler measured 12 cm.':ref.excerpt,
      notes:calls===1?'The teacher said “unverified quotation”.':ref.excerpt,
      ...(input.layout==='native-table' && {table:{headers:['Observation'],rows:[[ref.excerpt]]}}),
      citations:[ref.id]})}});
  });
  const text = 'The water sample measured 12 millilitres. The plant had green leaves. The class used a ruler.';
  const response=await app.inject({method:'POST',url:'/api/decks',payload:{provider:'local',source:{name:'observations.txt',text},topic:'Observations',language:'en',review:false}});
  assert.equal(response.statusCode,201,response.body);
  const id=response.json().id;
  let deck:Deck=response.json();
  for(let i=0; i<250 && deck.phase!=='editing';i++){
    await delay(10);
    deck=(await app.inject({url:'/api/decks/'+id})).json();
  }
  assert.equal(deck.phase,'editing');
  assert.equal(planCalls,1);
  assert.ok(calls>=2);
  assert.equal(deck.outline[0].sourceExcerptId,'source-2');
  assert.equal(deck.outline[0].section,'Working with measurements');
  assert.equal(deck.outline[2].sourceExcerptId,'source-3');
  assert.equal(deck.outline[2].title,'The class used a ruler.');
  assert.equal(deck.slides[1].layout,'native-table');
  assert.deepEqual(deck.slides[1].table?.rows,[['The plant had green leaves.']]);
  assert.ok(deck.slides.every(slide=>slide.status==='ready' && slide.evidence?.length && !slide.body.includes('9999')));
  assert.ok(deck.slides.slice(1).some(slide=>slide.title==='Classroom observations'));
  assert.deepEqual(deck.slides[0].sourceReview,{numbers:['9999','12 cm'],quotations:1,unknownCitations:0});
  assert.ok(!deck.slides[0].notes.includes('unverified quotation'));
  for(const slide of deck.slides) for(const ref of slide.evidence!) assert.equal([...text].slice(ref.start,ref.end).join(''),ref.excerpt);
});
