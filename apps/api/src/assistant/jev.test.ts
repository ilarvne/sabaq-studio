import assert from 'node:assert/strict';
import test from 'node:test';
import { runLessonAgent } from '@sabaq/agent/decisions';
import { jevAssessment, scoreJevSupport } from './jev';

const source = 'The classroom experiment took place indoors.';
const claim = 'The experiment was indoors. [1]';
const env = {TYPESAFE_API_KEY:'test',STUDIO_JEV_REGION:'KZ',STUDIO_JEV_ENDPOINT:'https://judge.example/v1/systemone',
  STUDIO_KZ_PROVIDER_ORIGINS:'https://judge.example'};

test('the Jev runtime requires an eligible turn and an explicitly approved endpoint',()=>{
  assert.ok(jevAssessment(false,env));
  assert.equal(jevAssessment(true,env),undefined);
  for (const override of [{TYPESAFE_API_KEY:''},{STUDIO_JEV_REGION:''},{STUDIO_KZ_PROVIDER_ORIGINS:''},
    {STUDIO_JEV_ENDPOINT:'http://judge.example/v1/systemone'},{STUDIO_JEV_ENDPOINT:'https://evil.example/v1/systemone'},
    {STUDIO_JEV_ENDPOINT:'https://judge.example/v1/systemone?key=1'}]) {
    assert.equal(jevAssessment(false,{...env,...override}),undefined);
  }
  assert.ok(jevAssessment(false,{...env,STUDIO_JEV_ENDPOINT:'http://127.0.0.1:7000/v1/systemone',STUDIO_KZ_PROVIDER_ORIGINS:''}));
  assert.throws(()=>jevAssessment(false,{...env,STUDIO_JEV_MIN_SUPPORT:'0'}));
});

test('the Jev adapter accepts the typed noul value and bounds the exact evidence payload',async t=>{
  let result:unknown={answers:{supported:{type:'noul',noul:0.94}}};
  t.mock.method(globalThis,'fetch',async (url:string,init:RequestInit)=>{
    assert.equal(url,env.STUDIO_JEV_ENDPOINT);
    assert.equal(init.redirect,'error');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test');
    const payload=JSON.parse(String(init.body));
    assert.deepEqual(payload.state,{claim,passages:[source]});
    assert.equal(payload.questions.supported.type,'noul');
    return Response.json(result);
  });
  const score=()=>scoreJevSupport({claim,passages:[source],apiKey:'test',endpoint:env.STUDIO_JEV_ENDPOINT});
  assert.equal(await score(),0.94);
  result={answers:{supported:{type:'noul',noul:1.2}}}; await assert.rejects(score);
  result={answers:{supported:{type:'choice',confidence:1}}}; await assert.rejects(score);
  result='x'.repeat(17000); await assert.rejects(score,/size/);
});

test('factual answers require support, permit one correction and abstain on an unavailable judge',async()=>{
  async function exercise(assess:(claim:string,passages:string[])=>Promise<boolean>) {
    let drafts=0;
    const events:string[]=[];
    const iter=runLessonAgent({locale:'en',query:'Where?',request:{},signal:new AbortController().signal,
      model:async()=>{ drafts++; return {reply:'The experiment was indoors. [[E1]]',actions:[]}; },
      readSlide:()=>[],readOutline:()=>[],
      search:async()=>({mode:'lexical',hits:[{id:'source',kind:'source',label:'Hidden filename',field:'source.text',excerpt:source,start:0,end:source.length}]}),
      assessSupport:assess});
    for (;;) {
      const item=await iter.next();
      if (item.done) return {answer:item.value,events,drafts};
      if (item.value.status==='running') events.push(item.value.kind);
    }
  }
  let attempts=0;
  const accepted=await exercise(async (reply,passages)=>{
    assert.equal(reply,claim); assert.deepEqual(passages,[source]); return ++attempts===2;
  });
  assert.equal(accepted.answer.reply,claim); assert.equal(accepted.drafts,2);
  assert.equal(accepted.events.filter(event=>event==='assess_support').length,2);
  const rejected=await exercise(async()=>false);
  assert.equal(rejected.drafts,2); assert.match(rejected.answer.reply,/find support/);
  const unavailable=await exercise(async()=>{throw new Error('Service unavailable');});
  assert.equal(unavailable.drafts,1); assert.match(unavailable.answer.reply,/find support/);
});
