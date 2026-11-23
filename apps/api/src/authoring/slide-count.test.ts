import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { maxLessonSlides, type CreateInput, type Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { researchOutline, researchSlide } from './research';
import { slideCountFor } from './slide-count';

const base:CreateInput = {topic:'Orbital motion', language:'en', provider:'fixture', review:false};

test('automatic sizing uses duration, audience, teaching scope and the supplied document', () => {
  assert.deepEqual(['10','20','45'].map(duration => slideCountFor({...base, answers:{duration}})), [5,7,10]);
  assert.equal(slideCountFor({...base, answers:{duration:'2'}}),3);
  assert.equal(slideCountFor({...base, topic:'40-minute class on orbital motion'}), 9);
  assert.equal(slideCountFor({...base, topic:'40 мин урока'}), 9);
  assert.equal(slideCountFor({...base, topic:'Күн жүйесі туралы 9 слайд жаса'}), 9);
  assert.equal(slideCountFor({...base, topic:'Prepare a 12-slide introduction', slideCount:4}), 4);
  assert.equal(slideCountFor({...base, topic:'A brief overview for beginners'}), 4);
  assert.equal(slideCountFor({...base, topic:'Detailed investigation for university students'}), 10);
  assert.equal(slideCountFor({...base, topic:'Teach these topics:\n1. Gravity\n2. Orbits\n3. Tides'}), 5);
  assert.equal(slideCountFor({...base, source:{name:'notes',text:'Gravity.\n\nOrbits.'}}), 4);
  assert.equal(slideCountFor({...base, source:{name:'course',text:'orbit '.repeat(5500)}}), maxLessonSlides);
});

test('deck creation validates exact counts and completes fitting outlines and slides through the API', async t => {
  const app = createStudioServer({dbPath:':memory:', fixtureDelay:1});
  t.after(() => app.close());
  const create = (fields:object) => app.inject({method:'POST',url:'/api/decks',payload:{...base,...fields}});
  for (const invalid of [0, 1, 2, maxLessonSlides + 1, -3, 2.5, '9']) assert.equal((await create({slideCount:invalid})).statusCode, 400);
  assert.equal((await create({topic:'Create a 2-slide deck about orbits.'})).statusCode,400);
  const sample = makeFixtureDeck('en');
  for (const [count, fields] of [
    [1, {template:'blank', slideCount:1}],
    [9, {template:'explain', slideCount:9, answers:{duration:'10'}}],
    [maxLessonSlides, {slideCount:maxLessonSlides, source:sample.source}],
    [6, {sourceDeckId:sample.id, slideCount:6}],
    [4, {topic:'A brief overview for beginners'}],
  ] as const) {
    const response = await create(fields);
    assert.equal(response.statusCode, 201, response.body);
    const path = '/api/decks/' + response.json<Deck>().id;
    let deck = response.json<Deck>();
    const deadline = Date.now() + 15000;
    while (deck.phase !== 'editing' && Date.now() < deadline) {
      await delay(10);
      deck = (await app.inject({url:path})).json<Deck>();
    }
    assert.equal(deck.outline.length, count);
    assert.equal(new Set(deck.outline.map(item => item.id)).size, count);
    assert.equal(deck.slides.length, count);
    assert.ok(deck.slides.every(slide => slide.status === 'ready'));
    if (count === maxLessonSlides) assert.ok(deck.slides.every(slide => slide.evidence?.length));
  }
});

test('a shortened reviewed outline must contain three slides before first generation', async t => {
  const app = createStudioServer({dbPath:':memory:', fixtureDelay:1});
  t.after(() => app.close());
  const response = await app.inject({method:'POST',url:'/api/decks',payload:{...base,review:true,slideCount:3}});
  assert.equal(response.statusCode,201);
  const path = '/api/decks/' + response.json<Deck>().id;
  let deck = response.json<Deck>();
  const deadline = Date.now() + 5000;
  while (deck.outlineStatus !== 'complete' && Date.now() < deadline) {
    await delay(10);
    deck = (await app.inject({url:path})).json<Deck>();
  }
  assert.equal(deck.outlineStatus,'complete');
  const shortened = await app.inject({method:'PATCH',url:path,payload:{baseRevision:deck.revision,op:{kind:'outline',outline:deck.outline.slice(0,2)}}});
  assert.equal(shortened.statusCode,200,shortened.body);
  const generated = await app.inject({method:'POST',url:path+'/generate'});
  assert.equal(generated.statusCode,400,generated.body);
  const saved = (await app.inject({url:path})).json<Deck>();
  assert.equal(saved.phase,'outline');
  assert.equal(saved.outline.length,2);
  assert.equal(saved.slides.length,0);
});

test('larger local and Alem outlines are assembled from validated, consecutive model responses', async t => {
  const saved = {ALEM_API_KEY:process.env.ALEM_API_KEY, STUDIO_AUTHORING_MODEL:process.env.STUDIO_AUTHORING_MODEL};
  process.env.ALEM_API_KEY = 'test-only';
  process.env.STUDIO_AUTHORING_MODEL = 'test-local';
  t.after(() => {
    for (const [key,value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const app = createStudioServer({dbPath:':memory:', fixtureDelay:1});
  t.after(() => app.close());
  const batches:number[] = [];
  t.mock.method(globalThis,'fetch',async (url:URL|string, init?:RequestInit) => {
    const endpoint = new URL(url);
    if (endpoint.pathname === '/api/tags') return Response.json({models:[{name:'test-local:latest',digest:'model',details:{format:'gguf'}}]});
    const {messages,format} = JSON.parse(String(init?.body));
    const input = JSON.parse(messages[1].content);
    assert.ok(!('agenda' in input));
    if (endpoint.pathname==='/api/chat') {
      assert.equal(format.properties.slides.minItems,input.count);
      assert.ok(format.properties.slides.items.required.includes('purpose'));
    }
    assert.equal(input.structure.length, input.count);
    assert.equal(input.earlierSlides.length, input.firstSlide - 1);
    assert.equal(input.totalSlideCount, 23);
    batches.push(input.count);
    const content = JSON.stringify({slides:input.structure.map((stage:{task:string}, i:number) => ({
      title:`Class activity ${input.firstSlide + i}`, summary:stage.task, purpose:stage.task, layout:'split',
    }))});
    return Response.json(endpoint.hostname === 'llm.alem.ai' ? {choices:[{message:{content}}]} : {message:{content}});
  });
  for (const provider of ['local','alem']) {
    const response = await app.inject({url:'/api/decks',method:'POST',payload:{...base,template:'engineering',provider,slideCount:23,review:true}});
    assert.equal(response.statusCode,201,response.body);
    let deck = response.json<Deck>();
    const path = '/api/decks/' + deck.id;
    const deadline = Date.now() + 6000;
    while (deck.outlineStatus === 'generating' && Date.now() < deadline) {
      await delay(10);
      deck = (await app.inject({url:path})).json<Deck>();
    }
    assert.equal(deck.outlineStatus, 'complete');
    assert.equal(deck.outline.length, 23);
    assert.equal(deck.outline.at(-1)?.title, 'Class activity 23');
  }
  assert.deepEqual(batches, [3,3,3,3,3,3,3,2,10,10,3]);
});

test('custom research lengths preserve source citations even for a single slide or extended practice', () => {
  const deck = makeFixtureDeck('en');
  const sources = [{id:'web-1',title:'Orbital paths',url:'https://example.org/orbits',excerpt:'An orbit follows a curved path.'}];
  deck.research = {query:deck.topic, sources};
  for (const count of [1,2,3,9,maxLessonSlides]) {
    const outline = researchOutline(deck,sources,count);
    assert.equal(outline.length,count);
    assert.equal(new Set(outline.map(item => item.id)).size,count);
    const references = outline.flatMap(item => researchSlide(deck,item).evidence ?? []);
    assert.ok(references.length > 0 && references.every(reference => reference.url === sources[0].url));
  }
});
