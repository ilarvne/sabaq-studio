import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import type { AssistantSnapshot, AssistantWebResearch } from '@sabaq/contracts/assistant';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { researchDocument } from '../authoring/research';
import { Studio } from '../lessons/studio';
import { StudioStore } from '../persistence/storage';
import { DeckAssistant } from './assistant';
import { assistantWebResearchAvailable } from './web-research';

const lessonPath = '/api/decks/schoolyard-en';
const assistantPath = lessonPath + '/assistant';
const query = 'What causes a lunar eclipse?';
const nasa = {
  title: 'NASA Eclipse Guide', url: 'https://science.nasa.gov/eclipses/',
  highlights: ['A lunar eclipse occurs when Earth passes between the Sun and the Moon.'],
};
const observatory = { title: 'Observatory', url: 'https://example.org/eclipse', highlights: ['A lunar eclipse can occur only near a full Moon.'] };
const unsafe = { title: 'Invalid', url: 'javascript:void(0)' };

function setProviders(t: TestContext, key: string, alem = '') {
  const env = { EXA_API_KEY: key, STUDIO_ASSISTANT_OLLAMA_MODEL: '', ALEM_API_KEY: alem, STUDIO_MODERATION_OLLAMA_MODEL: '',
    STUDIO_EMBEDDING_MODEL:'', ALEM_EMBEDDINGS_API_KEY:'', ALEM_RERANK_API_KEY:'' };
  for (const [name,value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

function configure(t: TestContext, key: string, alem = '') {
  setProviders(t,key,alem);
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  return app;
}

function events(body: string) {
  return body.trim().split('\n').map(frame => JSON.parse(frame) as AssistantSnapshot);
}

test('assistant Web modes retrieve from Exa and write a cited answer with AlemLLM', async t => {
  const app = configure(t,'test-exa','test-alem');
  const sent: Record<string,unknown>[] = [];
  const modelRequests: Record<string,unknown>[] = [];
  t.mock.method(globalThis,'fetch',async (url: string, init: RequestInit) => {
    assert.equal(init.redirect,'error');
    const body = JSON.parse(String(init.body));
    if (url==='https://api.exa.ai/search') {
      assert.equal(new Headers(init.headers).get('x-api-key'),'test-exa');
      sent.push(body);
      return Response.json({
        results: [unsafe,nasa,{...nasa,url:nasa.url+'#duplicate'},observatory],
        output: { content: { findings: [{statement:'Exa-authored answer must be ignored.'}] } },
      });
    }
    assert.equal(url,'https://llm.alem.ai/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-alem');
    assert.equal(body.model,'alemllm');
    modelRequests.push(JSON.parse(body.messages[1].content));
    const findings = [
      {statement:'The Moon passes through Earth’s shadow.',citations:[1]},
      {statement:'This claim must be omitted.',citations:[99]},
      {statement:'A full Moon is required.',citations:[2,1]},
      {statement:'The eclipse always lasts 30 minutes.',citations:[2]},
    ];
    return Response.json({choices:[{message:{content:JSON.stringify({findings})}}]});
  });
  const deck = (await app.inject({url:lessonPath})).json<Deck>();
  const capabilities = (await app.inject({url:'/api/capabilities'})).json();
  assert.equal(capabilities.assistantWebResearch,true);
  const payload = {text:query, locale:'en',slideId:deck.slides[0].id};
  for (const forbidden of [{searchSourceLibrary:true},{attachments:[{name:'Private',text:'private attachment'}]},{canvasScope:{field:'slide'}}]) {
    const response = await app.inject({method:'POST',url:assistantPath,payload:{...payload,clientId:'forbidden',webResearch:'search',...forbidden}});
    assert.equal(response.statusCode,400);
  }
  assert.equal(sent.length,0);
  const submit = async (webResearch: AssistantWebResearch) => {
    const response = await app.inject({method:'POST',url:assistantPath,payload:{...payload,clientId:webResearch,webResearch}});
    assert.equal(response.statusCode,200);
    const messages = events(response.body);
    assert.ok(messages.some(frame => frame.messages.at(-1)?.activity?.some(step => step.status==='running')));
    assert.ok(messages.some(frame => frame.messages.at(-1)?.activity?.some(step => step.kind==='write_web_answer' && step.status==='running')));
    const end = messages.at(-1)!;
    assert.equal(end.messages.at(-2)?.webResearch,webResearch);
    const reply = end.messages.at(-1)!;
    assert.equal(reply.status,'complete');
    assert.deepEqual(reply.webSources?.map(source => source.url), [nasa.url,observatory.url]);
    assert.equal(reply.citations,undefined);
    assert.equal(reply.proposal,undefined);
    assert.equal(reply.activity?.[0]?.count,2);
    assert.equal(reply.activity?.[1]?.status,'complete');
    return reply;
  };
  assert.equal((await submit('search')).activity?.[0]?.kind,'web_search');
  const report = await submit('research');
  assert.equal(report.activity?.[0]?.kind,'web_research');
  assert.match(report.text,/Earth’s shadow\. \[1\]/u);
  assert.match(report.text,/full Moon is required\. \[2\] \[1\]/u);
  assert.doesNotMatch(report.text,/omitted/u);
  assert.doesNotMatch(report.text,/30 minutes|Exa-authored/u);
  const restored = (await app.inject({url:assistantPath})).json<AssistantSnapshot>();
  assert.deepEqual(restored.messages.at(-1)?.webSources,report.webSources);
  assert.deepEqual(sent.map(body => body.query),[query,query]);
  assert.deepEqual(sent.map(body => body.type),['auto','deep']);
  assert.ok(sent.every(body => Object.keys(body).every(key => ['query','type','numResults','moderation','contents'].includes(key))));
  const modelInput = {question:query,language:'en',evidence:[
    {number:1,title:nasa.title,excerpt:nasa.highlights[0]},
    {number:2,title:observatory.title,excerpt:observatory.highlights[0]},
  ]};
  assert.deepEqual(modelRequests,[modelInput,modelInput]);
});

test('AlemLLM outage leaves the retrieved web links available', async t => {
  const app = configure(t,'test-exa','test-alem');
  t.mock.method(globalThis,'fetch',async (url: string) => url==='https://api.exa.ai/search'
    ? Response.json({results:[nasa]})
    : new Response(null,{status:503}));
  const response=await app.inject({method:'POST',url:assistantPath,payload:{clientId:'alem-offline',locale:'en',text:query,webResearch:'research'}});
  const reply=events(response.body).at(-1)?.messages.at(-1);
  assert.equal(reply?.status,'complete');
  assert.equal(reply?.activity?.at(-1)?.kind,'write_web_answer');
  assert.equal(reply?.activity?.at(-1)?.status,'error');
  assert.match(reply?.text ?? '',/AlemLLM/u);
  assert.deepEqual(reply?.webSources?.map(source=>source.url),[nasa.url]);
});

test('ordinary agent chat can use Alem on a public research deck but keeps private source text local', async t => {
  setProviders(t,'','test-alem');
  const store=new StudioStore(':memory:'), studio=new Studio(store), assistant=new DeckAssistant(studio,tmpdir());
  t.after(()=>studio.close());
  const original=studio.deck('schoolyard-en');
  const sources=[{id:'public-1',title:nasa.title,url:nasa.url,excerpt:nasa.highlights[0]}];
  const source=researchDocument('en',sources);
  const deck:Deck={...original,provider:'alem',source,research:{query,mode:'search',sources}};
  let calls=0;
  t.mock.method(globalThis,'fetch',async (url: string, init: RequestInit) => {
    assert.equal(url,'https://llm.alem.ai/v1/chat/completions');
    const request=JSON.parse(JSON.parse(String(init.body)).messages[1].content);
    const match=request.evidence.find((item:{excerpt:string})=>item.excerpt===sources[0].excerpt);
    assert.ok(match);
    calls++;
    return Response.json({choices:[{message:{content:JSON.stringify({reply:`Earth blocks the Sun’s light. [[${match.key}]]`,actions:[]})}}]});
  });
  async function submit(clientId:string) {
    let last:AssistantSnapshot | undefined;
    for await (const frame of assistant.open(deck.id,{clientId,locale:'en',text:query}).events) last=frame;
    return last?.messages.at(-1);
  }
  store.put('decks',deck.id,deck);
  const publicReply=await submit('public');
  assert.equal(publicReply?.text,'Earth blocks the Sun’s light. [1]');
  assert.deepEqual(publicReply?.citations?.map(citation=>citation.url),[nasa.url]);
  store.put('decks',deck.id,{...deck,revision:deck.revision+1,source:{...source,text:source.text+' Private teacher text.'}});
  await submit('private');
  assert.equal(calls,1);
});

test('unconfigured or failed Exa search never masquerades as lesson retrieval', async t => {
  const app = configure(t,'');
  const post = () => app.inject({method:'POST',url:assistantPath,payload:{clientId:'offline',locale:'en',text:query,webResearch:'search'}});
  assert.equal((await app.inject({url:'/api/capabilities'})).json().assistantWebResearch,false);
  assert.equal((await post()).statusCode,503);

  process.env.EXA_API_KEY = 'test-exa';
  t.mock.method(globalThis,'fetch',async () => new Response(null,{status:429}));
  const reply = events((await post()).body).at(-1)?.messages.at(-1);
  assert.equal(reply?.status,'error');
  assert.equal(reply?.activity?.[0]?.status,'error');
  assert.match(reply?.text ?? '',/Exa.*limit/u);
  assert.equal(reply?.webSources,undefined);
  assert.equal(reply?.citations,undefined);
});

test('stopping a deep research turn aborts the provider and saves the stopped state', {timeout:5000}, async t => {
  const app = configure(t,'test-exa');
  let begin!: (signal: AbortSignal) => void;
  const opened = new Promise<AbortSignal>(resolve => { begin = resolve; });
  t.mock.method(globalThis,'fetch',async (_url: string, init: RequestInit) => {
    const signal = init.signal!;
    begin(signal);
    return await new Promise<Response>((_resolve,reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once:true});
    });
  });
  const clientId = 'stop-research';
  const run = app.inject({method:'POST',url:assistantPath,payload:{clientId,locale:'en',text:query,webResearch:'research'}});
  const signal = await opened;
  const response = await app.inject({method:'POST',url:assistantPath+'/cancel',payload:{clientId}});
  assert.equal(response.statusCode,200);
  assert.equal(signal.aborted,true);
  const reply = events((await run).body).at(-1)?.messages.at(-1);
  assert.equal(reply?.status,'cancelled');
  assert.equal(reply?.activity?.[0]?.status,'cancelled');
  assert.equal(reply?.webSources,undefined);
});

test('shared mode checks the approved provider origin', t => {
  for (const key of ['EXA_API_KEY','STUDIO_AUTH_MODE','STUDIO_KZ_PROVIDER_ORIGINS']) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  process.env.EXA_API_KEY = 'test-exa';
  process.env.STUDIO_AUTH_MODE = 'gateway';
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://other.example';
  assert.equal(assistantWebResearchAvailable(),false);
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://api.exa.ai';
  assert.equal(assistantWebResearchAvailable(),true);
});
