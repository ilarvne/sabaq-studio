import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStudioServer } from '../app';
import { ModerationError, requireSuitable } from './moderation';
import { resolveSlideIllustration } from '../media/visuals';
import type { Deck } from '@sabaq/lesson/types';

function setting(t:TestContext,key:string,value:string) {
  const was=process.env[key];
  process.env[key]=value;
  t.after(()=>{if(was===undefined) delete process.env[key]; else process.env[key]=was;});
}

function classifier(t:TestContext,decide:(stage:string,material:string)=>'allow'|'warn'|'refuse') {
  setting(t,'STUDIO_MODERATION_OLLAMA_MODEL','classroom');
  setting(t,'STUDIO_OLLAMA_URL','http://127.0.0.1:11434');
  return t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if (url.pathname==='/api/tags') return Response.json({models:[{name:'classroom:latest',details:{format:'gguf'},digest:'123'}]});
    assert.equal(url.pathname,'/api/chat');
    const payload=JSON.parse(String(init.body));
    const {stage,material}=JSON.parse(payload.messages[1].content);
    const decision=decide(stage,material);
    return Response.json({message:{content:JSON.stringify({decision,reason:'Classroom review: '+decision})}});
  });
}

test('source moderation warns, binds confirmation to the material and refuses before deck creation',async t=>{
  classifier(t,(_stage,text)=>text.includes('block-marker') ? 'refuse' : 'warn');
  const app=createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  const base={topic:'History lesson',language:'en',provider:'fixture',review:true};
  const create=(input:object)=>app.inject({method:'POST',url:'/api/decks',payload:input});
  const initial=(await app.inject({url:'/api/decks'})).json<Deck[]>().length;
  const warning=await create(base);
  assert.equal(warning.statusCode,409);
  const token=warning.json().moderationConfirmation;
  assert.match(token,/^[a-f0-9]{64}$/);
  const different=await create({...base,topic:'Another history lesson',moderationConfirmation:token});
  assert.equal(different.statusCode,409);
  assert.notEqual(different.json().moderationConfirmation,token);
  const blocked=await create({...base,source:{name:'materials',text:'classroom content '.repeat(330)+'block-marker'},moderationConfirmation:token});
  assert.equal(blocked.statusCode,422);
  assert.equal(blocked.json().moderationConfirmation,undefined);
  assert.match(blocked.json().message,/refuse/);
  assert.equal((await app.inject({url:'/api/decks'})).json<Deck[]>().length,initial);
  assert.equal((await create({...base,moderationConfirmation:token})).statusCode,201);
});

test('a rejected slide, assistant proposal, legacy rewrite and image prompt cannot publish',async t=>{
  classifier(t,(stage,material)=>stage==='image' || (stage==='output' && (material.includes('"body":') || material.includes('"actions"'))) ? 'refuse' : 'allow');
  const app=createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  const path='/api/decks/schoolyard-en';
  const before=(await app.inject({url:path})).json<Deck>();
  const rewrite=await app.inject({method:'POST',url:path+'/proposals',payload:{instruction:'Shorten the text',slideId:before.slides[0].id}});
  assert.equal(rewrite.statusCode,422);
  assert.match(rewrite.json().message,/refuse/);
  const answer=await app.inject({method:'POST',url:path+'/assistant',payload:{text:'Use the Editorial theme',locale:'en',clientId:'moderated'}});
  const message=JSON.parse(answer.body.trim().split('\n').at(-1)!).messages.at(-1);
  assert.equal(message.status,'error');
  assert.match(message.text,/refuse/);
  assert.equal(message.proposal,undefined);
  assert.equal((await app.inject({url:path})).json<Deck>().revision,before.revision);
  setting(t,'STUDIO_IMAGE_ENDPOINT','http://127.0.0.1:9999/generate');
  await assert.rejects(resolveSlideIllustration({prompt:'A classroom illustration',alt:'Supplies'},{
    language:'en',mediaRoot:'.unused',signal:new AbortController().signal,
  }),ModerationError);
  const created=await app.inject({method:'POST',url:'/api/decks',payload:{topic:'Plant cells',provider:'fixture',language:'en',review:false}});
  assert.equal(created.statusCode,201);
  const root='/api/decks/'+created.json<Deck>().id;
  let deck=created.json<Deck>();
  for(let i=0;i<100 && deck.phase!=='editing';i++){
    await sleep(10);
    deck=(await app.inject({url:root})).json<Deck>();
  }
  assert.equal(deck.phase,'editing');
  assert.ok(deck.slides.length);
  assert.ok(deck.slides.every(slide=>slide.status==='failed'));
  assert.ok(deck.slides.every(slide=>!slide.body && slide.moderationNotice==='Classroom review: refuse'));
});

test('a configured classifier that is unavailable fails closed',async t=>{
  setting(t,'STUDIO_MODERATION_OLLAMA_MODEL','classroom-cloud');
  const mock=t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected network request')});
  await assert.rejects(requireSuitable('Ordinary material','en','output'),(e:unknown)=>e instanceof ModerationError && e.status===503);
  assert.equal(mock.mock.callCount(),0);
});

test('production gateways require an installed local classifier for generated work',async t=>{
  setting(t,'NODE_ENV','production');
  setting(t,'STUDIO_AUTH_MODE','gateway');
  setting(t,'STUDIO_MODERATION_OLLAMA_MODEL','');
  await assert.rejects(requireSuitable('Ordinary material','en','output'),(e:unknown)=>e instanceof ModerationError && e.status===503);
});

test('an allow verdict on a sensitive Kazakh health topic still requires teacher confirmation',async t=>{
  classifier(t,()=> 'allow');
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const response=await app.inject({url:'/api/decks',method:'POST',payload:{topic:'Қатерлі ісік және отбасының қолдауы',provider:'fixture',language:'kk',review:true}});
  assert.equal(response.statusCode,409);
  assert.ok(response.json().moderationConfirmation);
});

test('blank manual presentations can be created with the classifier offline',async t=>{
  setting(t,'STUDIO_MODERATION_OLLAMA_MODEL','unavailable-cloud');
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const response=await app.inject({url:'/api/decks',method:'POST',payload:{topic:'Empty canvas',template:'blank',provider:'fixture',language:'en',review:true}});
  assert.equal(response.statusCode,201);
  assert.equal(response.json<Deck>().phase,'editing');
});
