import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { matchingLocalVoice, narrationPrompts, narrationSource, spokenNarration } from '@sabaq/lesson/narration';
import { formatSpeechTime, formatTimeUnit, speechSeconds } from '@sabaq/lesson/speech-time';
import type { Deck } from '@sabaq/lesson/types';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import { createStudioServer } from '../app';
import { scenePlan } from '../video/scene-plan';

test('duration labels retain seconds and select units for the interface language',()=>{
  assert.equal(formatSpeechTime(9,'en'),'9 sec');
  assert.equal(formatSpeechTime(69,'ru'),'1 мин 9 с');
  assert.equal(formatSpeechTime(120,'kk'),'2 мин');
  assert.equal(formatTimeUnit(45,'kk','minute'),'45 мин');
});

test('lecture preview and the worker read RU/KK arithmetic and ranges without touching stored notes',()=>{
  const notes='3–5 үлгі; 2 + 3 = 5. 1,25 %';
  const slide={id:'one',status:'ready' as const,layout:'body' as const,title:'Су',body:'Су',notes,lessonPart:'lesson',version:1};
  const kk=spokenNarration(narrationSource(slide),'kk');
  assert.equal(kk,'үштен беске дейін үлгі; екі қосу үш тең бес. бір бүтін жүзден жиырма бес пайыз');
  assert.equal(spokenNarration('3–5. 2 + 3 = 5; x² = 4.','ru'),'от трёх до пяти. два плюс три равно пять; x в квадрате равно четыре.');
  assert.equal(spokenNarration('12,05 %; 21; 1002; 12.10.2026','ru'),'двенадцать целых пять сотых процента; двадцать один; одна тысяча два; 12.10.2026');
  assert.equal(spokenNarration('Read 3–5 values.','en'),'Read from 3 to 5 values.');
  assert.ok(speechSeconds(kk)>0);
  assert.equal(scenePlan(slide,'kk',{position:'none',captions:false,language:'kk'}).paragraphs[0],kk);
  assert.equal(slide.notes,notes);
  assert.equal(narrationSource({...slide,notes:''}),'Су');
});

test('only installed voices matching the lesson language can receive lecture text',()=>{
  const remote={lang:'kk-KZ',localService:false},wrong={lang:'ru-RU',localService:true};
  assert.equal(matchingLocalVoice([remote,wrong],'kk'),undefined);
  const exact={lang:'kk-KZ',localService:true};
  assert.equal(matchingLocalVoice([{lang:'kk',localService:true},remote,exact],'kk'),exact);
  assert.equal(matchingLocalVoice([wrong],'ru'),wrong);
});

test('rewrite for speech proposes only notes, survives replay and waits for approval',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error('No network access');});
  const app=createStudioServer({dbPath:':memory:'});t.after(()=>app.close());
  const deck=(await app.inject({method:'POST',url:'/api/decks',payload:{topic:'Salinity',template:'blank',provider:'fixture',language:'en',review:false}})).json<Deck>();
  const slide=deck.slides[0],url='/api/decks/'+deck.id;
  const raw='• Collect 3 samples\n• Compare readings';
  await app.inject({method:'PATCH',url,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{notes:raw}}}});
  const id=randomUUID(),payload={clientId:id,slideId:slide.id,text:narrationPrompts.en,locale:'en'};
  for(let i=0;i<2;i++) {
    const response=await app.inject({method:'POST',url:url+'/assistant',payload});
    assert.equal(response.statusCode,200);
    const snapshot=JSON.parse(response.body.trim().split('\n').at(-1)!) as AssistantSnapshot;
    assert.equal(snapshot.messages.at(-1)?.proposal?.status,'pending');
    assert.equal(snapshot.messages.filter(msg=>msg.proposal).length,1);
  }
  const saved=async ()=>(await app.inject({url})).json<Deck>().slides[0];
  assert.equal((await saved()).notes,raw);
  const decision=await app.inject({method:'POST',url:url+'/assistant/proposals/'+id,payload:{action:'apply'}});
  assert.equal(decision.statusCode,200);
  const result=await saved();
  assert.equal(result.notes,'Collect 3 samples.\nThen compare readings.');
  assert.equal(result.body,slide.body);
});
