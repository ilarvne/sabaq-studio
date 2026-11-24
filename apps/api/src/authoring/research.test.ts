import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStudioServer } from '../app';
import type { Deck } from '@sabaq/lesson/types';

const query = 'Табиғаттағы су айналымы';
test('research mode checkpoints public evidence and uses only approved queries at the search boundary', async t => {
  const old = { provider: process.env.STUDIO_RESEARCH_PROVIDER, key: process.env.EXA_API_KEY, topics: process.env.STUDIO_RESEARCH_TOPICS };
  process.env.STUDIO_RESEARCH_PROVIDER = 'exa';
  process.env.EXA_API_KEY = 'test-only';
  process.env.STUDIO_RESEARCH_TOPICS = query;
  t.after(() => {
    for (const [key, value] of Object.entries({ STUDIO_RESEARCH_PROVIDER: old.provider, EXA_API_KEY: old.key, STUDIO_RESEARCH_TOPICS: old.topics })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 2 });
  t.after(() => app.close());
  const sent: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://api.exa.ai/search');
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ results: [
      { title: 'Unsafe link', url: 'javascript:void(0)', highlights: ['This source contains an unusable reference.'] },
      { title: 'Су айналымы', url: 'https://example.org/water', highlights: ['💧 Су буланып, қайтадан жер бетіне жауын түрінде оралады.'] },
      { title: 'Duplicate', url: 'https://example.org/water#x', highlights: ['Another passage pointing to the same resource.'] },
    ] });
  });
  const create = (more: object) => app.inject({ method: 'POST', url: '/api/decks', payload: { topic: 'Private teacher notes', language: 'kk', provider: 'fixture', review: false, ...more } });
  assert.equal((await create({ researchQuery: 'private query' })).statusCode, 400);
  assert.equal((await create({ researchQuery: query, source: { name: 'private', text: 'private' } })).statusCode, 400);
  assert.equal(sent.length, 0);
  let deck = (await create({ researchQuery: query })).json<Deck>();
  for (let i = 0; i < 150 && deck.phase !== 'editing'; i++) {
    await sleep(10);
    deck = (await app.inject({ url: '/api/decks/' + deck.id })).json<Deck>();
  }
  assert.equal(deck.phase, 'editing');
  assert.deepEqual(sent, [{ query, numResults: 6, contents: { highlights: true } }]);
  assert.equal(deck.slides.length, 3);
  assert.equal(deck.research?.sources?.length, 1);
  const slide = deck.slides[1], evidence = slide.evidence![0];
  assert.equal([...deck.source!.text].slice(evidence.start, evidence.end).join(''), evidence.excerpt);
  assert.ok(slide.notes.includes(evidence.url!));
});

test('Exa retrieves public excerpts and AlemLLM authors the researched outline and slides', async t => {
  const before = {EXA_API_KEY:process.env.EXA_API_KEY,ALEM_API_KEY:process.env.ALEM_API_KEY};
  process.env.EXA_API_KEY = 'test-exa';
  process.env.ALEM_API_KEY = 'test-alem';
  t.after(() => {
    for (const [key,value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 2 });
  t.after(() => app.close());
  const topic = 'Compare how planted ground and pavement absorb rain';
  const primary = {
    title:'Water Science School', url:'https://www.usgs.gov/water',
    highlights:['Pervious soil can let rainwater infiltrate, while impervious surfaces produce runoff.'],
  };
  const second = {
    title:'Stormwater science', url:'https://example.org/stormwater',
    highlights:['💧 Vegetation can capture rainfall and slow surface runoff.'],
  };
  const sent: Record<string,unknown>[] = [];
  const modelCalls = {outline:0,slides:0,repairs:0};
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (url === 'https://api.exa.ai/search') {
      assert.equal(new Headers(init?.headers).get('x-api-key'),'test-exa');
      sent.push(body);
      return Response.json({results:[primary,second]});
    }
    assert.equal(url,'https://llm.alem.ai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-alem');
    assert.equal(body.model,'alemllm');
    const input = JSON.parse(body.messages[1].content);
    const excerpts = [primary.highlights[0],second.highlights[0]];
    let content: object;
    const slideDraft = {title:'Follow the rainwater',body:'Ask students to compare what happens on soil and pavement.',
      notes:'Discuss rainwater pathways with the class.'};
    if (input.sourceExcerpt) {
      modelCalls.repairs++;
      assert.ok(excerpts.includes(input.sourceExcerpt));
      assert.ok(!input.passages);
      content = slideDraft;
    } else if (input.count) {
      modelCalls.outline++;
      assert.ok(input.passages.every((passage:{id:string;excerpt:string}) => /^E\d+$/u.test(passage.id) && excerpts.includes(passage.excerpt)));
      content = {slides:Array.from({length:input.count},(_,i) => ({
        title:i===0 ? 'Where the rain goes' : 'Compare surfaces',
        summary:'Discuss why rain behaves differently on each surface.',
        purpose:'Connect rainwater to the ground it falls on.',
        layout:'body',sourceExcerptId:input.passages[i % input.passages.length].id,
      }))};
    } else {
      modelCalls.slides++;
      assert.ok(input.passages.every((passage:{id:string;excerpt:string}) => /^E\d+$/u.test(passage.id) && excerpts.includes(passage.excerpt)));
      if (modelCalls.slides === 1) content = slideDraft;
      else content = {...slideDraft,citations:modelCalls.slides === 2 ? ['invalid'] : input.passages.map(({id}:{id:string})=>id)};
    }
    return Response.json({choices:[{message:{content:JSON.stringify(content)}}]});
  });
  const create = (more: object) => app.inject({method:'POST', url:'/api/decks', payload:{
    topic, language:'en', provider:'alem', review:false, answers:{level:'middle school',imageSource:'none'}, ...more,
  }});
  assert.equal((await create({webResearch:'search',source:{name:'Private file',text:'Sensitive classroom notes.'}})).statusCode,400);
  assert.equal((await create({webResearch:'search',sourceFileIds:['11111111-1111-4111-8111-111111111111']})).statusCode,400);
  assert.equal((await create({webResearch:'research',researchQuery:query})).statusCode,400);
  assert.equal((await create({webResearch:'research',template:'blank'})).statusCode,400);
  assert.equal((await create({webResearch:'research',provider:'fixture'})).statusCode,400);
  assert.equal(sent.length,0);
  async function generate(webResearch: 'search' | 'research', slideCount?: number) {
    const response = await create({webResearch,...(slideCount && {slideCount})});
    assert.equal(response.statusCode,201);
    let deck = response.json<Deck>();
    for (let i=0; i<150 && deck.phase!=='editing'; i++) {
      await sleep(10);
      deck = (await app.inject({url:'/api/decks/'+deck.id})).json<Deck>();
    }
    assert.equal(deck.phase,'editing');
    assert.equal(deck.slides.length,slideCount ?? 7);
    assert.equal(deck.provider,'alem');
    assert.equal(deck.research?.mode,webResearch);
    assert.equal(deck.outline[0].title,'Where the rain goes');
    assert.ok(deck.slides.every(slide=>slide.status==='ready' && slide.title==='Follow the rainwater'));
    return deck;
  }
  const quick = await generate('search');
  assert.match(quick.slides[0].body,/Ask students to compare/u);
  for (const [index,slide] of quick.slides.slice(0,2).entries()) {
    const sourceId = quick.outline[index].sourceExcerptId;
    assert.deepEqual(slide.evidence?.map(ref=>ref.id),[sourceId]);
    assert.ok(slide.notes.includes(quick.research!.sources!.find(source=>source.id===sourceId)!.url));
  }
  const deep = await generate('research',3);
  const slide = deep.slides[1];
  assert.match(slide.notes,/Discuss rainwater pathways with the class/u);
  assert.equal(deep.research?.findings,undefined);
  assert.deepEqual(slide.evidence?.map(item => item.url).sort(),[primary.url,second.url].sort());
  for (const evidence of slide.evidence!) {
    assert.equal([...deep.source!.text].slice(evidence.start,evidence.end).join(''),evidence.excerpt);
    assert.ok(slide.notes.includes(evidence.url!));
  }
  assert.deepEqual(sent.map(body => body.type),['auto','deep']);
  assert.deepEqual(sent.map(body => body.query),[topic,topic]);
  assert.ok(sent.every(body => Object.keys(body).every(key =>
    ['query','type','numResults','moderation','contents'].includes(key))));
  assert.deepEqual(modelCalls,{outline:4,slides:10,repairs:2});

  delete process.env.EXA_API_KEY;
  assert.equal((await create({webResearch:'search'})).statusCode,503);
  process.env.EXA_API_KEY = 'test-exa';
  delete process.env.ALEM_API_KEY;
  assert.equal((await create({webResearch:'search'})).statusCode,503);
  assert.equal(sent.length,2);
});
