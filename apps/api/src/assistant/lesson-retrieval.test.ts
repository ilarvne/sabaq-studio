import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { Deck } from '@sabaq/lesson/types';
import { readLessonSlide } from './lesson-passages';
import { searchLesson } from './lesson-retrieval';
import { StudioStore } from '../persistence/storage';

const signal = new AbortController().signal;

function settings(t: TestContext, model = '') {
  const keys = ['STUDIO_EMBEDDING_MODEL','STUDIO_EMBEDDING_URL','STUDIO_OLLAMA_URL','STUDIO_AUTH_MODE',
    'STUDIO_KZ_PROVIDER_ORIGINS','ALEM_EMBEDDINGS_API_KEY','ALEM_RERANK_API_KEY'];
  const before = keys.map(key=>process.env[key]);
  for (const key of keys) delete process.env[key];
  process.env.STUDIO_EMBEDDING_MODEL = model;
  process.env.STUDIO_OLLAMA_URL = 'http://127.0.0.1:11434';
  t.after(()=>{
    keys.forEach((key,index)=>{
      const value = before[index];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  });
}

function withSource(id: string, text: string): Deck {
  return {...makeFixtureDeck('en'),id,slides:[],source:{name:'Class notebook',text}};
}

test('citations use exact Unicode ranges and update on revisions, deck restores and field edits', async t=>{
  settings(t);
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const original = '🌱 '.repeat(370) + 'Өсімдіктердің тамыры қоректік заттарды сіңіреді. ' + '🌱 '.repeat(400);
  const deck = withSource('class-a',original);
  const other = withSource('class-b','Unpublished log: igneous weathering.');
  store.put('decks',deck.id,deck);
  store.put('decks',other.id,other);
  assert.equal((await searchLesson(store,other,'weathering',signal)).hits.length,1);
  const found = await searchLesson(store,deck,'Қоректік заттар',signal);
  assert.equal(found.mode,'lexical');
  const hit = found.hits[0];
  assert.equal(hit.label,'Class notebook');
  assert.ok(hit.start > 0);
  assert.equal(hit.excerpt,[...original].slice(hit.start,hit.end).join(''));
  assert.deepEqual((await searchLesson(store,deck,'weathering',signal)).hits,[]);
  assert.deepEqual((await searchLesson(store,deck,'"() - OR *',signal)).hits,[]);

  const changed = {...deck,revision:deck.revision + 1,source:{name:'New',text:'Наблюдение за облаками и осадками.'}};
  store.put('decks',deck.id,changed);
  assert.deepEqual((await searchLesson(store,changed,'Қоректік',signal)).hits,[]);
  assert.equal((await searchLesson(store,changed,'осадки',signal)).hits[0].label,'New');
  await assert.rejects(searchLesson(store,deck,'Қоректік',signal),/changed during retrieval/);
  const restored = {...deck,revision:changed.revision + 1};
  store.put('decks',deck.id,restored);
  assert.equal((await searchLesson(store,restored,'Қоректік',signal)).hits[0].id,hit.id);
});

test('exact slide reads and search share chart, table, card and speaker-note evidence', async t=>{
  settings(t);
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const deck = makeFixtureDeck('en');
  const slide = deck.slides[0];
  slide.table = {headers:['Station','Depth'],rows:[['Ridgeline',63]]};
  slide.chart = {categories:['Spring'],series:[{name:'Meltwater',values:[8]}],alt:'Seasonal levels'};
  slide.notes = 'Bring the altimeter.';
  slide.design = {variant:'activity',cards:[{title:'Compass',text:'Plot a bearing.'}]};
  store.put('decks',deck.id,deck);
  const direct = readLessonSlide(deck,slide.id);
  for (const word of ['Ridgeline','Meltwater','altimeter','Compass']) {
    const result = await searchLesson(store,deck,word,signal);
    assert.equal(result.hits[0].slideId,slide.id);
    assert.ok(direct.some(hit=>hit.id === result.hits[0].id));
  }
  assert.deepEqual(readLessonSlide(deck,'elsewhere'),[]);
});

test('public source citations never cross publication boundaries and retain their original URL and offsets', async t=>{
  settings(t);
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const articles = [
    {id:'one',title:'First field note',url:'https://example.org/one',excerpt:'🌲 The tree grows.'},
    {id:'two',title:'Second field note',url:'https://example.org/two',excerpt:'🌼 Dandelions have taproots.'},
  ];
  const deck = withSource('field',articles.map(a=>a.excerpt).join('\n\n'));
  deck.research = {query:'plants',sources:articles};
  store.put('decks',deck.id,deck);
  const {hits:[citation]} = await searchLesson(store,deck,'taproots',signal);
  assert.equal(citation.url,articles[1].url);
  assert.equal(citation.label,articles[1].title);
  assert.equal(citation.excerpt,articles[1].excerpt);
  assert.equal(citation.excerpt,[...deck.source!.text].slice(citation.start,citation.end).join(''));
});

test('semantic-only recall reuses persisted embeddings after restart and refreshes changed passages or model digests', async t=>{
  settings(t,'local-encoder');
  const dir = mkdtempSync(join(tmpdir(),'sabaq-retrieval-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'studio.sqlite');
  const query = 'soil moisture';
  const target = 'A sapling absorbs water from the dirt.';
  const deck = withSource('plants',target);
  deck.slides = [makeFixtureDeck('en').slides[0]];
  const documents: string[] = [];
  let digest = 'version-1';
  t.mock.method(globalThis,'fetch',async (address: URL,init: RequestInit)=>{
    if (address.pathname === '/api/tags') return Response.json({models:[{name:'local-encoder:latest',digest,details:{format:'gguf'}}]});
    assert.equal(address.pathname,'/api/embed');
    const {input,model} = JSON.parse(String(init.body)) as {input:string[];model:string};
    assert.equal(model,'local-encoder:latest');
    documents.push(...input.filter(text=>text !== query));
    return Response.json({embeddings:input.map(text=>text === query || text === target ? [1,0] : [0,1])});
  });
  let store = new StudioStore(path);
  try {
    store.put('decks',deck.id,deck);
    const first = await searchLesson(store,deck,query,signal);
    assert.equal(first.mode,'hybrid');
    assert.equal(first.hits[0].excerpt,target);
    const coldCount = documents.length;
    assert.ok(coldCount > 1);
    store.db.close();
    store = new StudioStore(path);
    assert.deepEqual(await searchLesson(store,deck,query,signal),first);
    assert.equal(documents.length,coldCount);
    deck.revision++;
    deck.slides[0].notes = 'Bring a magnifying glass.';
    store.put('decks',deck.id,deck);
    await searchLesson(store,deck,query,signal);
    assert.deepEqual(documents.slice(coldCount),['Bring a magnifying glass.']);
    digest = 'version-2';
    await searchLesson(store,deck,query,signal);
    assert.equal(documents.filter(text=>text === target).length,2);
  } finally { store.db.close(); }
});

test('remote aliases receive no lesson text, failed encoders fall back to lexical, and cancellation propagates', async t=>{
  settings(t,'configured');
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const deck = withSource('class','The violet notebook');
  store.put('decks',deck.id,deck);
  let remote = true, embeds = 0;
  const request = t.mock.method(globalThis,'fetch',async (address: URL)=>{
    if (address.pathname === '/api/tags') return Response.json({models:[{name:'configured:latest',digest:'v1',details:{format:'gguf'},...(remote && {remote_host:'cloud.example'})}]});
    embeds++;
    throw new Error('offline');
  });
  assert.equal((await searchLesson(store,deck,'violet',signal)).mode,'lexical');
  assert.equal(embeds,0);
  remote = false;
  const fallback = await searchLesson(store,deck,'violet',signal);
  assert.equal(fallback.mode,'lexical');
  assert.equal(fallback.hits[0].excerpt,deck.source!.text);
  assert.equal(embeds,1);
  process.env.STUDIO_OLLAMA_URL = 'https://external.example';
  const calls = request.mock.callCount();
  assert.deepEqual(await searchLesson(store,deck,'violet',signal),fallback);
  assert.equal(request.mock.callCount(),calls);
  await assert.rejects(searchLesson(store,deck,'violet',AbortSignal.abort()),{name:'AbortError'});
});

function topicDeck(store: StudioStore, bodies: string[]) {
  const deck = makeFixtureDeck('en');
  const slide = deck.slides[0];
  deck.slides = bodies.map((body,index)=>({...slide,id:String(index),title:'',body,notes:'',image:undefined}));
  store.put('decks',deck.id,deck);
  return deck;
}

test('Alem embeddings recover a paraphrase and reuse indexed passage vectors', async t=>{
  settings(t);
  process.env.ALEM_EMBEDDINGS_API_KEY = 'embed-test';
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const query = 'soil moisture';
  const target = 'A sapling absorbs water from the dirt.';
  const deck = topicDeck(store,['The Moon orbits the Earth.',target]);
  const request = t.mock.method(globalThis,'fetch',async (address: URL,init: RequestInit)=>{
    assert.equal(address.href,'https://llm.alem.ai/v1/embeddings');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer embed-test');
    assert.equal(init.redirect,'error');
    const {input,model} = JSON.parse(String(init.body)) as {input:string | string[];model:string};
    assert.equal(model,'text-1024');
    const inputs = typeof input === 'string' ? [input] : input;
    const data = inputs.map((text,index)=>({object:'embedding',index,embedding:Array.from({length:1024},(_,i)=>
      Number(i === (text === query || text === target ? 0 : 1)),
    )}));
    return Response.json({object:'list',model,data:data.reverse(),usage:{prompt_tokens:23,total_tokens:23}});
  });
  const first = await searchLesson(store,deck,query,signal,5,{allowAlem:true});
  assert.equal(first.mode,'hybrid');
  assert.deepEqual(first.hits.map(hit=>hit.excerpt),[target]);
  const coldCalls = request.mock.callCount();
  assert.ok(coldCalls > 1);
  assert.deepEqual(await searchLesson(store,deck,query,signal,5,{allowAlem:true}),first);
  assert.equal(request.mock.callCount(),coldCalls + 1);
});

test('Alem reranking selects server citations and invalid indexes preserve the original ranking', async t=>{
  settings(t);
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const deck = topicDeck(store,['The violet notebook rests on a shelf.','The violet flower grows in a pot.']);
  const original = await searchLesson(store,deck,'violet',signal,2);
  assert.equal(original.hits.length,2);
  process.env.ALEM_RERANK_API_KEY = 'rerank-test';
  let invalid = false;
  const request = t.mock.method(globalThis,'fetch',async (address: URL,init: RequestInit)=>{
    assert.equal(address.href,'https://llm.alem.ai/v1/rerank');
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer rerank-test');
    assert.equal(init.redirect,'error');
    assert.deepEqual(JSON.parse(String(init.body)),{
      model:'reranker',query:'violet',documents:original.hits.map(hit=>hit.excerpt),top_n:1,
    });
    return Response.json({model:'reranker',results:[{index:invalid ? 2 : 1,relevance_score:0.9}]});
  });
  assert.deepEqual((await searchLesson(store,deck,'violet',signal,1,{allowAlem:true})).hits,[original.hits[1]]);
  invalid = true;
  assert.deepEqual((await searchLesson(store,deck,'violet',signal,1,{allowAlem:true})).hits,[original.hits[0]]);
  assert.equal(request.mock.callCount(),2);
});

test('Alem retrieval keeps private calls and unapproved shared-gateway traffic local', async t=>{
  settings(t);
  process.env.STUDIO_AUTH_MODE = 'gateway';
  process.env.ALEM_EMBEDDINGS_API_KEY = 'embed-test';
  process.env.ALEM_RERANK_API_KEY = 'rerank-test';
  const store = new StudioStore(':memory:');
  t.after(()=>store.db.close());
  const deck = topicDeck(store,['The violet notebook.','The violet flower.']);
  const request = t.mock.method(globalThis,'fetch',async ()=>new Response(null,{status:503}));
  const lexical = await searchLesson(store,deck,'violet',signal,1,{allowAlem:true});
  assert.equal(request.mock.callCount(),0);
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://llm.alem.ai';
  assert.deepEqual(await searchLesson(store,deck,'violet',signal,1),lexical);
  assert.equal(request.mock.callCount(),0);
  assert.deepEqual(await searchLesson(store,deck,'violet',signal,1,{allowAlem:true}),lexical);
  assert.equal(request.mock.callCount(),2);
});
