import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { StudioStore } from '../persistence/storage';
import { Studio } from '../lessons/studio';
import { DeckAssistant } from './assistant';

function snapshots(body: string) {
  return body.trim().split('\n').map(line=>JSON.parse(line) as AssistantSnapshot);
}

test('the lesson assistant answers, reviews edits atomically and rejects stale approvals', async (t) => {
  const app = createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const path=root+'/assistant';
  const read = async () => (await app.inject({url:root})).json<Deck>();
  const send = async (clientId: string, text: string) => {
    const response=await app.inject({method:'POST',url:path,payload:{clientId,text,slideId:'s01',locale:'en'}});
    assert.equal(response.statusCode,200);
    assert.match(String(response.headers['content-type']),/application\/x-ndjson/);
    return snapshots(response.body);
  };
  const decision = (clientId: string, action: 'apply' | 'dismiss') =>
    app.inject({method:'POST',url:`${path}/proposals/${clientId}`,payload:{action}});

  const original=await read();
  await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:'s01',baseVersion:original.slides[0].version,changes:{design:{variant:'opening'}}}}});
  const before=await read();
  const answer=await send('notes','Show speaker notes');
  assert.equal(answer[0].activeClientId,'notes');
  assert.equal(answer.at(-1)?.activeClientId,undefined);
  assert.equal(answer.at(-1)?.messages.at(-1)?.text,before.slides[0].notes);
  const partials=answer.flatMap(snapshot=>snapshot.messages.at(-1)?.streamingText ?? []);
  assert.ok(partials.length>0);
  assert.ok(partials.every((text,index)=>before.slides[0].notes.startsWith(text) && (!index || text.length>partials[index-1].length)));
  assert.equal(answer.at(-1)?.messages.at(-1)?.streamingText,undefined);
  assert.equal((await read()).revision,before.revision);
  const replayed=await send('notes','Show speaker notes');
  assert.equal(replayed[0].messages.length,2);

  const proposed=await send('theme','Use the Editorial theme');
  assert.equal(proposed.at(-1)?.messages.at(-1)?.proposal?.status,'pending');
  assert.deepEqual(proposed.at(-1)?.messages.at(-1)?.proposal?.themes,{before:before.theme,after:'editorial'});
  assert.ok(proposed.at(-1)?.messages.at(-1)?.proposal?.changes?.[0].after);
  assert.equal((await read()).theme,before.theme);
  const applied=await decision('theme','apply');
  assert.equal(applied.statusCode,200);
  assert.equal(applied.json<AssistantSnapshot>().deck?.theme,'editorial');
  assert.equal(applied.json<AssistantSnapshot>().deck?.slides[0].design?.theme,'deck');
  assert.equal((await decision('theme','apply')).statusCode,200);
  assert.equal((await read()).revision,before.revision+1);

  await send('quiz','Add a quick quiz');
  const identity=(await read()).slides[0];
  await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:identity.id,baseVersion:identity.version,changes:{notes:'Teacher edit made during review.'}}}});
  const stale=await decision('quiz','apply');
  assert.equal(stale.statusCode,409);
  assert.equal(stale.json<AssistantSnapshot>().messages.at(-1)?.proposal?.status,'stale');
  assert.equal((await read()).slides.length,before.slides.length);
  assert.equal((await read()).slides[0].notes,'Teacher edit made during review.');
});

test('stopping a streamed reply preserves the delivered text on reopen and retry', async t=>{
  const store=new StudioStore(':memory:'), studio=new Studio(store), assistant=new DeckAssistant(studio,tmpdir());
  t.after(()=>studio.close());
  const input={clientId:'partial-notes',locale:'en' as const,slideId:'s01',text:'Show speaker notes'};
  let delivered='';
  for await(const snapshot of assistant.open('schoolyard-en',input).events) {
    const message=snapshot.messages.at(-1);
    if(!delivered && message?.streamingText) {
      delivered=message.streamingText;
      assert.equal(assistant.get('schoolyard-en').messages.at(-1)?.streamingText,delivered);
      assistant.cancel('schoolyard-en',input.clientId);
    }
  }
  assert.ok(delivered);
  for await(const replay of assistant.open('schoolyard-en',input).events) {
    const message=replay.messages.at(-1);
    assert.equal(message?.status,'cancelled');
    assert.equal(message?.text,delivered);
    assert.equal(message?.streamingText,undefined);
    assert.equal(message?.proposal,undefined);
  }
});

test('Alem can propose a multi-slide edit while preserving unrelated formatting', async (t) => {
  const previous=process.env.ALEM_API_KEY;
  process.env.ALEM_API_KEY='assistant-test-key';
  t.after(()=>{if(previous===undefined) delete process.env.ALEM_API_KEY; else process.env.ALEM_API_KEY=previous;});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const created=(await app.inject({method:'POST',url:'/api/decks',payload:{topic:'Seedlings',language:'en',provider:'alem',review:true,template:'blank'}})).json<Deck>();
  const root=`/api/decks/${created.id}`;
  const slideId=created.slides[0].id;
  const richBody={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Observe',marks:[{type:'bold'}]}]}]};
  const initial=(await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId,baseVersion:0,changes:{body:'Observe',richText:{body:richBody}}}}})).json<Deck>();
  let calls=0;
  t.mock.method(globalThis,'fetch',async (_:unknown,request:RequestInit)=>{
    const payload=JSON.parse(JSON.parse(String(request.body)).messages[1].content);
    assert.equal(payload.lesson.activeSlideId,slideId);
    if (++calls===1) return Response.json({choices:[{message:{content:'This reply is missing the JSON envelope.'}}]});
    const actions=[
      {tool:'edit_slide',slideId,changes:{title:'From seed to sprout'}},
      {tool:'add_slide',afterId:slideId,changes:{title:'Observe a bean seedling',body:'Describe the first leaves.'}},
      {tool:'edit_deck',theme:'museum'},
    ];
    return Response.json({choices:[{message:{content:JSON.stringify({reply:'Review the new title, second slide, and Museum theme.',actions})}}]});
  });
  const path=root+'/assistant';
  const response=await app.inject({method:'POST',url:path,payload:{clientId:'batch',locale:'en',slideId,text:'Rename the first slide, add an observation slide, and apply Museum.'}});
  assert.equal(response.statusCode,200);
  const staged=snapshots(response.body).at(-1)?.messages.at(-1);
  assert.equal(calls,2);
  assert.equal(staged?.proposal?.actions.length,3);
  const pending=(await app.inject({url:root})).json<Deck>();
  assert.equal(pending.revision,initial.revision);
  assert.equal(pending.slides.length,1);
  const result=(await app.inject({method:'POST',url:path+'/proposals/batch',payload:{action:'apply'}})).json<AssistantSnapshot>();
  const applied=result.deck!;
  assert.equal(applied.revision,initial.revision+1);
  assert.equal(applied.slides.length,2);
  assert.equal(applied.theme,'museum');
  assert.equal(applied.slides[0].title,'From seed to sprout');
  assert.deepEqual(applied.slides[0].richText?.body,richBody);
  assert.equal((await app.inject({url:path})).json<AssistantSnapshot>().messages.at(-1)?.proposal?.status,'applied');

  const theme=(await app.inject({method:'POST',url:path,payload:{clientId:'named-theme',locale:'ru',slideId,text:'Смени тему всей презентации на «Лаборатория».'}}));
  assert.equal(calls,2);
  assert.match(snapshots(theme.body).at(-1)?.messages.at(-1)?.proposal?.actions[0].detail ?? '',/Лаборатория/);
  const themed=(await app.inject({method:'POST',url:path+'/proposals/named-theme',payload:{action:'apply'}})).json<AssistantSnapshot>();
  assert.equal(themed.deck?.theme,'laboratory');
});

test('a deictic shortening stays on the selected slide and previews the edit', async (t) => {
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const path=root+'/assistant';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[2];
  const body='Record a new observation. Repeat this explanation in discussion. There were 17 observations.';
  const before=(await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{body}}}})).json<Deck>();
  const response=await app.inject({method:'POST',url:path,payload:{clientId:'short',locale:'en',slideId:slide.id,text:'Shorten the text on this slide.'}});
  assert.equal(response.statusCode,200);
  const pending=snapshots(response.body).at(-1)?.messages.at(-1)?.proposal;
  assert.equal(pending?.status,'pending');
  assert.deepEqual(pending?.changes?.map(change=>change.slideId),[slide.id]);
  assert.equal(pending?.changes?.[0].before?.body,body);
  const shortened=pending?.changes?.[0].after?.body;
  assert.equal(shortened,'Record a new observation. There were 17 observations.');
  assert.equal((await app.inject({url:root})).json<Deck>().slides[2].body,body);
  const result=(await app.inject({method:'POST',url:path+'/proposals/short',payload:{action:'apply'}})).json<AssistantSnapshot>();
  assert.equal(result.deck?.slides[2].body,shortened);
  assert.deepEqual(result.deck?.slides.slice(0,2),before.slides.slice(0,2));
});

test('Убери картинку prepares a selected-slide removal without calling a model', async t=>{
  agentSettings(t,{ALEM_API_KEY:'assistant-test',STUDIO_MODERATION_OLLAMA_MODEL:'',STUDIO_AUTH_MODE:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const creation=await app.inject({method:'POST',url:'/api/decks',
    payload:{topic:'Солнечная система',language:'ru',provider:'alem',review:true,template:'blank'}});
  assert.equal(creation.statusCode,201,creation.body);
  const deck=creation.json<Deck>();
  const slide=deck.slides[0];
  const root='/api/decks/'+deck.id;
  const path=root+'/assistant';
  const image={src:'/assets/water-lab.webp',alt:'Иллюстрация'};
  const setup=await app.inject({method:'PATCH',url:root,payload:{op:{
    kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{layout:'image-full',image,title:'Дорабатываем ответ',body:'Сохраните текст.',notes:'Сохраните заметки.'},
  }}});
  assert.equal(setup.statusCode,200,setup.body);
  const before=setup.json<Deck>();
  const fetch=t.mock.method(globalThis,'fetch',async ()=>{throw new Error('Unexpected model call');});
  const send=async (clientId:string)=>{
    const response=await app.inject({method:'POST',url:path,payload:{
      clientId,locale:'ru',slideId:slide.id,text:'Убери картинку',canvasScope:{field:'slide'},
    }});
    assert.equal(response.statusCode,200);
    return snapshots(response.body).at(-1)?.messages.at(-1);
  };
  const pending=await send('remove-illustration');
  assert.equal(pending?.proposal?.status,'pending');
  assert.equal(pending?.proposal?.actions[0].label,'Удалить иллюстрацию');
  assert.deepEqual(pending?.proposal?.changes?.map(change=>change.slideId),[slide.id]);
  assert.deepEqual(pending?.proposal?.changes?.[0].before?.image,image);
  const {image:_removed,...original}=before.slides[0];
  assert.deepEqual(pending?.proposal?.changes?.[0].after,{...original,layout:'body',version:original.version+1});
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);

  const approve=await app.inject({method:'POST',url:path+'/proposals/remove-illustration',payload:{action:'apply'}});
  assert.equal(approve.statusCode,200);
  assert.deepEqual(approve.json<AssistantSnapshot>().deck?.slides[0],pending?.proposal?.changes?.[0].after);
  const empty=await send('already-removed');
  assert.equal(empty?.proposal,undefined);
  assert.match(empty?.text ?? '',/нет отдельного изображения/iu);
  assert.equal(fetch.mock.callCount(),0);
});

test('image removal asks which gallery image to remove and preserves other image frames', async t=>{
  agentSettings(t,{STUDIO_MODERATION_OLLAMA_MODEL:'',STUDIO_AUTH_MODE:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-ru';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[2];
  const image=(index:number)=>({src:'/assets/water-lab.webp',alt:'Иллюстрация '+index});
  const frames=['title','body','image','image-2','image-3'].map((id,i)=>({
    id,x:i*12,y:i*5,w:10,h:20,rotation:0,
  }));
  const setup=await app.inject({method:'PATCH',url:root,payload:{op:{
    kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{layout:'image-grid',image:image(1),additionalImages:[image(2),image(3)],freeLayout:{items:frames}},
  }}});
  assert.equal(setup.statusCode,200,setup.body);
  const before=setup.json<Deck>();
  const send=async (clientId:string,text:string,slideId=slide.id)=>{
    const response=await app.inject({method:'POST',url:root+'/assistant',payload:{clientId,locale:'ru',slideId,text}});
    assert.equal(response.statusCode,200);
    return snapshots(response.body).at(-1)?.messages.at(-1);
  };
  const ambiguous=await send('which-image','Удали картинку со слайда 3');
  assert.equal(ambiguous?.proposal,undefined);
  assert.match(ambiguous?.text ?? '',/какое изображение/iu);
  const scoped=await send('numbered-image','Удали картинку № 2');
  assert.deepEqual(scoped?.proposal?.changes?.map(change=>change.slideId),[slide.id]);
  assert.deepEqual(scoped?.proposal?.changes?.[0].after?.additionalImages,[image(3)]);
  const primary=await send('primary-image','Удали картинку № 1 со слайда 3',deck.slides[0].id);
  assert.deepEqual(primary?.proposal?.changes?.map(change=>change.slideId),[slide.id]);
  const after=primary?.proposal?.changes?.[0].after;
  assert.deepEqual(after?.image,image(2));
  assert.deepEqual(after?.additionalImages,[image(3)]);
  const previous=before.slides[2].freeLayout?.items ?? [];
  assert.deepEqual(after?.freeLayout?.items.slice(0,4),[
    ...previous.slice(0,2),{...previous[3],id:'image'},{...previous[4],id:'image-2'},
  ]);
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
});

test('a selected-slide shortening rewrites a dense sentence without changing its figures or target', async t=>{
  agentSettings(t,{ALEM_API_KEY:'unused',STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:'',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434'});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-ru';
  const path=root+'/assistant';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[2];
  const body='Чтобы провести сравнение полученных результатов, участники записали 17 наблюдений в пятницу и 17 наблюдений в понедельник, затем сравнили записи в таблице.';
  const before=(await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{body}}}})).json<Deck>();
  const shortened='Участники записали 17 наблюдений в пятницу и 17 в понедельник и сравнили записи в таблице.';
  let attempts=0;
  t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if (url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'abc',details:{format:'gguf'}}]});
    assert.equal(url.pathname,'/api/chat');
    const payload=JSON.parse(JSON.parse(String(request.body)).messages[1].content);
    assert.equal(payload.body,body);
    assert.equal(payload.language,'ru');
    assert.equal(payload.context,undefined);
    assert.equal(payload.slides,undefined);
    const draft=++attempts===1 ? 'Участники записали 17 наблюдений и сравнили записи в таблице.' : shortened;
    return Response.json({message:{content:JSON.stringify({body:draft})}});
  });
  const response=await app.inject({method:'POST',url:path,payload:{clientId:'rewrite-dense',locale:'en',slideId:deck.slides[0].id,text:'Shorten slide 3.'}});
  assert.equal(response.statusCode,200);
  const events=snapshots(response.body).map(event=>event.messages.at(-1));
  assert.equal(attempts,2);
  assert.ok(events.some(message=>message?.activity?.some(step=>step.kind==='shorten_text' && step.status==='running')));
  const message=events.at(-1);
  assert.equal(message?.status,'complete');
  assert.ok(message?.activity?.every(step=>step.status==='complete'));
  const proposal=message?.proposal;
  assert.deepEqual(proposal?.changes?.map(change=>change.slideId),[slide.id]);
  assert.deepEqual(proposal?.changes?.[0].after,{...before.slides[2],body:shortened,version:before.slides[2].version+1});
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
});

test('a selected text revision preserves surrounding rich text and discards unrelated model actions',async t=>{
  agentSettings(t,{STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:'',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434'});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en', path=root+'/assistant';
  const deck=(await app.inject({url:root})).json<Deck>();
  const [slide, other]=deck.slides;
  const body='Record the measurements in your notebook.';
  const richText={body:{type:'doc',content:[{type:'paragraph',attrs:{textAlign:'center'},content:[
    {type:'text',text:'Record ',marks:[{type:'bold'}]},
    {type:'text',text:'the measurements',marks:[{type:'italic'}]},
    {type:'text',text:' in your notebook.'},
  ]}]}};
  const updated=await app.inject({method:'PATCH',url:root,payload:{op:{
    kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{body,richText},
  }}});
  assert.equal(updated.statusCode,200);
  const before=updated.json<Deck>();
  const canvasScope={field:'body',selection:{start:7,end:23,text:'the measurements'}};
  const afterBody='Record the readings in your notebook.';
  t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if(url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'abc',details:{format:'gguf'}}]});
    const messages=JSON.parse(String(request.body)).messages;
    assert.match(messages[0].content,/only the replacement for selection.text/);
    assert.deepEqual(JSON.parse(messages[1].content).canvasScope,{...canvasScope,slideId:slide.id});
    const actions=[
      {tool:'edit_deck',title:'Unrelated deck title'},
      {tool:'edit_slide',slideId:other.id,changes:{body:'Unrelated slide change'}},
      {tool:'edit_slide',slideId:slide.id,changes:{title:'Unrelated field',notes:'Unrelated notes',body:'the readings'}},
    ];
    return Response.json({message:{content:JSON.stringify({reply:'I prepared these changes for your review.',actions})}});
  });
  const response=await app.inject({method:'POST',url:path,payload:{
    clientId:'canvas-range',locale:'en',slideId:slide.id,text:'Simplify selected text. Slide 2 is unrelated.',canvasScope,
  }});
  assert.equal(response.statusCode,200);
  const transcript=snapshots(response.body).at(-1)!.messages;
  assert.deepEqual(transcript.at(-2)?.canvasScope,canvasScope);
  const proposal=transcript.at(-1)?.proposal;
  assert.deepEqual(proposal?.changes?.map(change=>change.slideId),[slide.id]);
  const draft=proposal?.changes?.[0].after;
  assert.equal(draft?.title,slide.title);
  assert.equal(draft?.notes,slide.notes);
  assert.equal(draft?.body,afterBody);
  assert.deepEqual(draft?.bodyRuns,[
    {text:'Record ',bold:true},{text:'the readings',italic:true},{text:' in your notebook.'},
  ]);
  assert.deepEqual((draft?.richText?.body?.content as typeof richText.body.content)[0].attrs,{textAlign:'center'});
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
  const applied=await app.inject({method:'POST',url:path+'/proposals/canvas-range',payload:{action:'apply'}});
  assert.equal(applied.statusCode,200);
  const saved=applied.json<AssistantSnapshot>().deck!;
  assert.equal(saved.title,deck.title);
  assert.equal(saved.slides[0].body,afterBody);
  assert.deepEqual(saved.slides[1],other);
  const stale=await app.inject({method:'POST',url:path,payload:{
    clientId:'canvas-stale-range',locale:'en',slideId:slide.id,text:'Simplify selected text.',canvasScope,
  }});
  assert.equal(stale.statusCode,409);
});

test('stopping an in-flight assistant edit settles its active tool and saves no proposal', async t=>{
  agentSettings(t,{STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:'',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434'});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const path=root+'/assistant';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[0];
  const body='In order to compare their results, the pupils made 12 measurements and wrote them down in their notebooks.';
  const before=(await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{body}}}})).json<Deck>();
  let enteredProvider!:()=>void;
  const entered=new Promise<void>(resolve=>{enteredProvider=resolve;});
  t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    if (url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'1',details:{format:'gguf'}}]});
    assert.equal(url.pathname,'/api/chat');
    return new Promise<Response>((_,reject)=>{
      request.signal!.addEventListener('abort',()=>reject(request.signal!.reason),{once:true});
      enteredProvider();
    });
  });
  const response=app.inject({method:'POST',url:path,payload:{clientId:'interrupted-edit',locale:'en',slideId:slide.id,text:'Shorten this slide.'}});
  const guard=AbortSignal.timeout(5000);
  await Promise.race([entered,new Promise<void>((_,reject)=>guard.addEventListener('abort',()=>reject(guard.reason),{once:true}))]);
  const stop=await app.inject({method:'POST',url:path+'/cancel',payload:{clientId:'interrupted-edit'}});
  const completed=await response;
  const ended=stop.json<AssistantSnapshot>().messages.at(-1);
  const history=snapshots(completed.body).at(-1)?.messages.at(-1);
  assert.equal(ended?.status,'cancelled');
  assert.equal(ended?.activity?.find(step=>step.kind==='shorten_text')?.status,'cancelled');
  assert.deepEqual(history,ended);
  assert.equal(history?.proposal,undefined);
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
});

test('a canvas object proposal targets one object and can be restored as one edit',async t=>{
  agentSettings(t,{STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:'',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434'});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en', path=root+'/assistant';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[0];
  const box={id:crypto.randomUUID(),kind:'text' as const,text:'Describe your observations.',color:'#123456',
    x:10,y:70,w:35,h:15,rotation:0,fontSize:24,bold:false,align:'left' as const};
  const arrow={id:crypto.randomUUID(),kind:'arrow' as const,color:'#123456',x:50,y:70,w:20,h:15,rotation:0};
  const update=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{objects:[box,arrow]}}}});
  assert.equal(update.statusCode,200);
  const before=update.json<Deck>();
  const canvasScope={field:'object',objectId:box.id,version:before.slides[0].version,theme:before.theme};
  t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if(url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'abc',details:{format:'gguf'}}]});
    const messages=JSON.parse(String(request.body)).messages;
    assert.deepEqual(JSON.parse(messages[1].content).canvasScope,{...canvasScope,slideId:slide.id,object:box});
    const actions=[
      {tool:'edit_slide',slideId:slide.id,changes:{title:'Unrelated title'}},
      {tool:'edit_object',slideId:slide.id,objectId:arrow.id,changes:{},remove:true},
      {tool:'edit_object',slideId:slide.id,objectId:box.id,changes:{text:'Share what you saw.',color:'#264488'}},
    ];
    return Response.json({message:{content:JSON.stringify({reply:'I prepared these changes for your review.',actions})}});
  });
  const payload={clientId:'selected-object',locale:'en',slideId:slide.id,text:'Simplify the selected text box.',canvasScope};
  const response=await app.inject({method:'POST',url:path,payload});
  assert.equal(response.statusCode,200);
  const proposal=snapshots(response.body).at(-1)?.messages.at(-1)?.proposal;
  const objects=[{...box,text:'Share what you saw.',color:'#264488'},arrow];
  assert.deepEqual(proposal?.actions.map(action=>action.kind),['edit_object']);
  assert.deepEqual(proposal?.changes?.[0].after?.objects,objects);
  assert.equal(proposal?.changes?.[0].after?.title,slide.title);
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
  const decision=(action:string)=>app.inject({method:'POST',url:path+'/proposals/selected-object',payload:{action}});
  assert.deepEqual((await decision('apply')).json<AssistantSnapshot>().deck?.slides[0].objects,objects);
  const stale=await app.inject({method:'POST',url:path,payload:{...payload,clientId:'stale-object'}});
  assert.equal(stale.statusCode,409);
  assert.deepEqual((await decision('restore')).json<AssistantSnapshot>().deck?.slides[0].objects,[box,arrow]);
});

test('teaching memory is durable, deck-scoped, deduplicated and removable', async (t) => {
  const dir=mkdtempSync(join(tmpdir(),'sabaq-memory-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async ()=>Response.json({ids:[]}));
  const dbPath=join(dir,'studio.sqlite');
  const path='/api/decks/schoolyard-en/assistant/memory';
  const other='/api/decks/schoolyard-ru/assistant/memory';
  const text='Prefer one concrete vocabulary example.';
  let app=createStudioServer({dbPath});
  const memory=(await app.inject({method:'POST',url:path,payload:{text}})).json<AssistantSnapshot>().memory!;
  assert.equal(memory[0].text,text);
  assert.deepEqual((await app.inject({method:'POST',url:path,payload:{text}})).json<AssistantSnapshot>().memory,memory);
  await app.close();
  app=createStudioServer({dbPath});
  try {
    assert.deepEqual((await app.inject({url:path})).json<AssistantSnapshot>().memory,memory);
    assert.deepEqual((await app.inject({url:other})).json<AssistantSnapshot>().memory,[]);
    await app.inject({method:'DELETE',url:`${other}/${memory[0].id}`});
    assert.deepEqual((await app.inject({url:path})).json<AssistantSnapshot>().memory,memory);
    assert.deepEqual((await app.inject({method:'DELETE',url:`${path}/${memory[0].id}`})).json<AssistantSnapshot>().memory,[]);
  } finally {
    await app.close();
  }
});

test('the selected numeric table becomes a reviewable chart with the same values', async (t) => {
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const original=(await app.inject({url:root})).json<Deck>();
  const slide=original.slides.find(item=>item.table)!;
  const response=await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'chart',locale:'en',slideId:slide.id,text:'Convert the numeric data on the selected slide into a chart.',
  }});
  const changes=snapshots(response.body).at(-1)?.messages.at(-1)?.proposal?.changes;
  assert.deepEqual(changes?.map(change=>change.slideId),[slide.id]);
  assert.deepEqual(changes?.[0].before?.table,slide.table);
  assert.deepEqual(changes?.[0].after?.chart?.series[0].values,slide.table!.rows.map(row=>row[1]));
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),original);
});

test('an informal image and chart request moves the existing picture and asks for chart data', async t=>{
  agentSettings(t,{STUDIO_MODERATION_OLLAMA_MODEL:'',STUDIO_AUTH_MODE:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-ru';
  const original=(await app.inject({url:root})).json<Deck>();
  const slide=original.slides[2];
  const image={src:'/assets/seedling-growth.webp',alt:'Росток фасоли'};
  const update=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{layout:'image-full',image,body:'Как определить, что ответ соответствует требованиям?',notes:'Оцените 1) точность и 2) понимание.'}}}});
  assert.equal(update.statusCode,200,update.body);
  const before=update.json<Deck>();
  const fetch=t.mock.method(globalThis,'fetch',async ()=>{throw new Error('Unexpected model call');});
  const response=await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'image-and-chart',locale:'ru',slideId:slide.id,text:'Сделай члайд нормальнм, добавь графики, картинка не фон а сбоку',
  }});
  assert.equal(response.statusCode,200,response.body);
  const message=snapshots(response.body).at(-1)?.messages.at(-1);
  assert.match(message?.text ?? '',/категории и числовые значения/u);
  assert.equal(message?.citations,undefined);
  assert.equal(fetch.mock.callCount(),0);
  assert.equal(message?.proposal?.status,'pending');
  assert.deepEqual(message?.proposal?.changes?.map(change=>change.slideId),[slide.id]);
  const moved=message?.proposal?.changes?.[0].after;
  assert.deepEqual(moved,{...before.slides[2],layout:'image-right',version:before.slides[2].version+1});
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
  const applied=await app.inject({method:'POST',url:root+'/assistant/proposals/image-and-chart',payload:{action:'apply'}});
  assert.equal(applied.statusCode,200,applied.body);
  assert.deepEqual(applied.json<AssistantSnapshot>().deck?.slides[2],moved);
});

test('images can be placed beside the text with a real chart and preserved teaching details', async t=>{
  agentSettings(t,{STUDIO_MODERATION_OLLAMA_MODEL:'',STUDIO_AUTH_MODE:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const original=(await app.inject({url:root})).json<Deck>();
  const slide=original.slides[2];
  const image={src:'/assets/water-lab.webp',alt:'Three measuring vessels'};
  const table={headers:['Vessel','Volume'],rows:[['A',12],['B','15,5']]};
  const cards=[{title:'Compare',text:'Use the same unit.'}];
  const update=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{layout:'image-full',image,table,design:{variant:'opening',cards}}}}});
  assert.equal(update.statusCode,200,update.body);
  const response=await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'image-and-data',locale:'en',slideId:slide.id,canvasScope:{field:'slide'},
    text:'Add a chart and move the image to the left.',
  }});
  assert.equal(response.statusCode,200,response.body);
  const pending=snapshots(response.body).at(-1)?.messages.at(-1)?.proposal;
  const moved=pending?.changes?.[0].after;
  assert.equal(pending?.status,'pending');
  assert.equal(moved?.layout,'image-left');
  assert.deepEqual(moved?.image,image);
  assert.deepEqual(moved?.table,table);
  assert.deepEqual(moved?.chart?.series,[{name:'Volume',values:[12,15.5]}]);
  assert.deepEqual(moved?.design?.cards,cards);
});

test('a picture can be placed in free space without moving manual text frames', async t=>{
  agentSettings(t,{STUDIO_MODERATION_OLLAMA_MODEL:'',STUDIO_AUTH_MODE:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const deck=(await app.inject({url:root})).json<Deck>();
  const slide=deck.slides[2];
  const title={id:'title',x:6,y:10,w:42,h:15,rotation:0};
  const body={id:'body',x:6,y:30,w:42,h:58,rotation:0};
  const eyebrow={id:'eyebrow',x:6,y:5,w:42,h:4,rotation:0};
  const image={id:'image',x:0,y:0,w:100,h:100,rotation:0};
  const update=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{layout:'image-full',image:{src:'/assets/water-lab.webp',alt:'Vessels'},freeLayout:{items:[image,title,body,eyebrow]}}}}});
  assert.equal(update.statusCode,200,update.body);
  const response=await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'move-free-image',locale:'en',slideId:slide.id,text:'Put the image beside the text.',
  }});
  const pending=snapshots(response.body).at(-1)?.messages.at(-1)?.proposal;
  assert.equal(pending?.status,'pending');
  const after=pending?.changes?.[0].after;
  assert.equal(after?.layout,'image-right');
  assert.deepEqual(after?.freeLayout?.items.slice(1),[title,body,eyebrow]);
  assert.ok((after?.freeLayout?.items[0].x ?? 0)>52);
});

function agentSettings(t: import('node:test').TestContext, settings:Record<string,string>) {
  for (const [name,value] of Object.entries(settings)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(()=>{if (previous===undefined) delete process.env[name]; else process.env[name]=previous;});
  }
}

test('an Alem topic answer can cite evidence recovered by embeddings and reranking', async t=>{
  agentSettings(t,{ALEM_API_KEY:'assistant-test',ALEM_EMBEDDINGS_API_KEY:'embed-test',ALEM_RERANK_API_KEY:'rerank-test',
    STUDIO_AUTH_MODE:'',STUDIO_EMBEDDING_MODEL:'',STUDIO_MODERATION_OLLAMA_MODEL:''});
  const app = createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const topic = {topic:'Seedlings',language:'en',provider:'alem',review:true,template:'blank'};
  const created = (await app.inject({method:'POST',url:'/api/decks',payload:topic})).json<Deck>();
  const path = `/api/decks/${created.id}`;
  const slide = created.slides[0];
  const target = 'A sapling absorbs water from the dirt.';
  const query = 'How does soil moisture enter a plant?';
  const edited = await app.inject({method:'PATCH',url:path,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{title:'Moisture log',body:target}}}});
  assert.equal(edited.statusCode,200);
  let reranked = false;
  t.mock.method(globalThis,'fetch',async (url:string | URL,request:RequestInit)=>{
    const {pathname} = new URL(url);
    const payload = JSON.parse(String(request.body));
    if (pathname === '/v1/embeddings') {
      const inputs: string[] = typeof payload.input === 'string' ? [payload.input] : payload.input;
      return Response.json({data:inputs.map((text,index)=>({index,embedding:Array.from({length:1024},(_,i)=>
        Number(i === (text === query || text === target ? 0 : 1)),
      )}))});
    }
    if (pathname === '/v1/rerank') {
      assert.equal(payload.query,query);
      assert.ok(payload.documents.includes('Moisture log'));
      assert.ok(payload.documents.includes(target));
      reranked = true;
      return Response.json({results:payload.documents.map((text:string,index:number)=>({index,relevance_score:text === target ? 0.9 : 0.1}))});
    }
    assert.equal(pathname,'/v1/chat/completions');
    assert.ok(reranked);
    const chat = JSON.parse(payload.messages[1].content);
    const evidence = chat.evidence[0];
    assert.equal(evidence.excerpt,target);
    const answer = {reply:`${target} [[${evidence.key}]]`,actions:[],citations:[evidence.key]};
    return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});
  });
  const response = await app.inject({method:'POST',url:path+'/assistant',payload:{clientId:'alem-retrieval',locale:'en',text:query}});
  assert.equal(response.statusCode,200);
  const turn = snapshots(response.body).at(-1)?.messages.at(-1);
  assert.equal(turn?.text,target+' [1]');
  assert.equal(turn?.reads?.[0].mode,'hybrid');
  assert.equal(turn?.citations?.[0].excerpt,target);
});

test('the local model can follow a lesson search with an exact slide read and validated citations', async t=>{
  agentSettings(t,{STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:'',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434'});
  const app = createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const path = '/api/decks/schoolyard-en/assistant';
  const memory = 'Always ask about measurement units.';
  const notes = 'Use the amber worksheet to record the calculation.';
  const deck = (await app.inject({url:'/api/decks/schoolyard-en'})).json<Deck>();
  const slide = deck.slides[3];
  await app.inject({method:'PATCH',url:'/api/decks/schoolyard-en',payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{notes}}}});
  let calls = 0;
  t.mock.method(globalThis,'fetch',async (url:URL,req:RequestInit)=>{
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if (url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'abc',details:{format:'gguf'}}]});
    assert.equal(url.pathname,'/api/chat');
    const payload = JSON.parse(JSON.parse(String(req.body)).messages[1].content);
    assert.equal(payload.lesson.slides[3].notes,undefined);
    assert.equal(payload.lesson.slides[3].body,undefined);
    assert.deepEqual(payload.preferences,calls<4 ? [] : [memory]);
    calls++;
    const source = payload.evidence.find((item:{excerpt:string})=>item.excerpt===notes);
    let result;
    if (calls===1) result = {read:{tool:'read_slide',slideId:slide.id}};
    else if (calls===2) result = {reply:'An invented citation [[E99]].',actions:[],citations:['E99']};
    else if (calls===3) {
      assert.match(payload.feedback,/valid keys/);
      result = {reply:'Use 999 amber worksheets. [['+source.key+']]',actions:[],citations:[source.key]};
    } else {
      assert.ok(source);
      if(calls===4) assert.match(payload.feedback,/numbers and verbatim quotations/);
      result = {reply:'Use the amber worksheet. [['+source.key+']]',actions:[],citations:[source.key]};
    }
    return Response.json({message:{content:JSON.stringify(result)}});
  });
  async function ask(id:string,text:string) {
    const response = await app.inject({method:'POST',url:path,payload:{clientId:id,slideId:'s01',locale:'en',text}});
    assert.equal(response.statusCode,200);
    return snapshots(response.body).at(-1)!.messages.at(-1)!;
  }
  const result = await ask('grounded','Which worksheet should students use?');
  assert.equal(calls,4);
  assert.deepEqual(result.reads?.map(read=>read.tool),['search_lesson','read_slide']);
  assert.equal(result.text,'Use the amber worksheet. [1]');
  assert.equal(result.citations?.length,1);
  assert.equal(result.citations[0].excerpt,notes);
  assert.equal(result.citations[0].slideId,slide.id);
  assert.equal(result.proposal,undefined);
  await app.inject({method:'POST',url:path+'/memory',payload:{text:memory}});
  await ask('remembered','Which amber worksheet should students use?');
  assert.equal(calls,5);
  const replay = (await app.inject({url:path})).json<AssistantSnapshot>();
  assert.deepEqual(replay.messages[1].citations,result.citations);
});

test('a private deck stays extractive when its configured local tag is a cloud alias', async t=>{
  agentSettings(t,{ALEM_API_KEY:'ignored',ALEM_EMBEDDINGS_API_KEY:'ignored',ALEM_RERANK_API_KEY:'ignored',
    STUDIO_ASSISTANT_OLLAMA_MODEL:'private',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434',STUDIO_EMBEDDING_MODEL:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const requests:string[] = [];
  t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    requests.push(url.href);
    assert.equal(request?.body,undefined);
    return Response.json({models:[{name:'private:latest',digest:'some-digest',details:{format:'gguf'},remote_host:'https://example.invalid'}]});
  });
  const path='/api/decks/schoolyard-en/assistant';
  const response=await app.inject({method:'POST',url:path,payload:{clientId:'private',locale:'en',text:'Which containers collected water?'}});
  const last = snapshots(response.body).at(-1)!.messages.at(-1)!;
  assert.deepEqual(requests,['http://127.0.0.1:11434/api/tags']);
  assert.equal(last.status,'complete');
  assert.ok(last.citations?.length);
  assert.equal(last.reads?.[0].mode,'lexical');
  assert.equal(last.proposal,undefined);
});

test('the model budget bounds repeated reads and cannot turn an unfinished answer into an edit', async t=>{
  agentSettings(t,{STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson:latest',STUDIO_OLLAMA_URL:'http://127.0.0.1:11434',STUDIO_EMBEDDING_MODEL:'',STUDIO_MEM0_URL:''});
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  let calls=0;
  t.mock.method(globalThis,'fetch',async (url:URL)=>{
    if (url.pathname==='/api/tags') return Response.json({models:[{name:'lesson:latest',digest:'1',details:{format:'gguf'}}]});
    calls++;
    return Response.json({message:{content:JSON.stringify({read:{tool:'search_lesson',query:'worksheets'}})}});
  });
  const path='/api/decks/schoolyard-en/assistant';
  const response=await app.inject({method:'POST',url:path,payload:{clientId:'limit',locale:'en',text:'Explain the measurements.'}});
  const last = snapshots(response.body).at(-1)!.messages.at(-1)!;
  assert.equal(calls,4);
  assert.equal(last.reads?.length,2);
  assert.match(last.text,/could not finish/);
  assert.equal(last.proposal,undefined);
});

test('teachers review the same slide identity before and after applying a durable proposal', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sabaq-proposal-'));
  const dbPath = join(directory, 'studio.sqlite');
  let app = createStudioServer({dbPath});
  t.after(async () => {
    await app.close();
    rmSync(directory, {recursive:true,force:true});
  });
  const root = '/api/decks/schoolyard-en';
  const path = root + '/assistant';
  const read = async () => (await app.inject({url:root})).json<Deck>();
  const before = await read();
  const response = await app.inject({method:'POST',url:path,payload:{
    clientId:'durable-review',locale:'en',slideId:'s01',text:'Duplicate this slide',
  }});
  const preview = snapshots(response.body).at(-1)?.messages.at(-1)?.proposal;
  assert.equal(preview?.status,'pending');
  assert.deepEqual(await read(),before);

  await app.close();
  app = createStudioServer({dbPath});
  const reopened = (await app.inject({url:path})).json<AssistantSnapshot>();
  assert.deepEqual(reopened.messages.at(-1)?.proposal,preview);
  const apply = () => app.inject({method:'POST',url:path+'/proposals/durable-review',payload:{action:'apply'}});
  const [accepted,repeated] = [await apply(),await apply()];
  assert.equal(accepted.statusCode,200);
  assert.equal(repeated.statusCode,200);
  const after = await read();
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.slides[1].id,preview?.changes?.[0].slideId);
  assert.equal(accepted.json<AssistantSnapshot>().appliedRevision,after.revision);
  assert.equal(repeated.json<AssistantSnapshot>().appliedRevision,after.revision);
  const restore = (proposalId:string) => app.inject({method:'POST',url:path+'/proposals/'+proposalId,payload:{action:'restore'}});
  const restored=await restore('durable-review');
  assert.equal(restored.statusCode,200,restored.body);
  assert.equal(restored.json<AssistantSnapshot>().messages.at(-1)?.proposal?.status,'restored');
  assert.deepEqual((await read()).slides.map(slide=>slide.id),before.slides.map(slide=>slide.id));
  assert.equal((await restore('durable-review')).json<AssistantSnapshot>().restoredRevision,after.revision+1);

  await app.inject({method:'POST',url:path,payload:{clientId:'stale-restore',locale:'en',slideId:'s01',text:'Duplicate this slide'}});
  assert.equal((await app.inject({method:'POST',url:path+'/proposals/stale-restore',payload:{action:'apply'}})).statusCode,200);
  assert.equal((await app.inject({method:'PATCH',url:root,payload:{op:{kind:'deck',title:'Newer teacher title'}}})).statusCode,200);
  assert.equal((await restore('stale-restore')).statusCode,409);
  assert.equal((await read()).title,'Newer teacher title');
  assert.equal((await read()).slides.length,before.slides.length+1);
});

test('the local model reads structured slide data as citable evidence', async t => {
  agentSettings(t,{
    STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson:latest', STUDIO_OLLAMA_URL:'http://127.0.0.1:11434',
    STUDIO_EMBEDDING_MODEL:'', STUDIO_MEM0_URL:'', LANGSMITH_TRACING:'true',
    LANGSMITH_ENDPOINT:'http://127.0.0.1:1', LANGSMITH_API_KEY:'mock-key',
  });
  const app = createStudioServer({dbPath:':memory:'});
  t.after(() => app.close());
  const deck = (await app.inject({url:'/api/decks/schoolyard-en'})).json<Deck>();
  const table = deck.slides.find(slide => slide.table)!;
  assert.ok(table);
  let calls = 0;
  const destinations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, req: RequestInit) => {
    destinations.push(String(url));
    if (new URL(url).origin !== 'http://127.0.0.1:11434') return new Response(null,{status:204});
    if (url.pathname==='/api/tags')
      return Response.json({models:[{name:'lesson:latest',digest:'one',details:{format:'gguf'}}]});
    assert.equal(url.pathname,'/api/chat');
    const request = JSON.parse(JSON.parse(String(req.body)).messages[1].content);
    calls++;
    const data = request.evidence.find((item: {field: string; slideId: string}) =>
      item.field === 'table' && item.slideId === table.id);
    const result = calls === 1
      ? {read:{tool:'read_slide_data',slideId:table.id,field:'data'}}
      : data
        ? {reply:'Consult the table. [[' + data.key + ']]',actions:[],citations:[data.key]}
        : {reply:'Insufficient evidence',actions:[],insufficientEvidence:true};
    return Response.json({message:{content:JSON.stringify(result)}});
  });
  const response = await app.inject({method:'POST',url:'/api/decks/schoolyard-en/assistant',payload:{
    clientId:'table-read',locale:'en',text:'What does the comparison show?',
  }});
  const turn = snapshots(response.body).at(-1)?.messages.at(-1);
  assert.deepEqual(turn?.reads?.map(read => read.tool),['search_lesson','read_slide_data']);
  assert.equal(turn?.citations?.[0].field,'table');
  assert.equal(turn?.citations?.[0].slideId,table.id);
  assert.equal(turn?.proposal,undefined);
  assert.equal(calls,2);
  assert.ok(destinations.every(address => address.startsWith('http://127.0.0.1:11434/')));
});

test('the agent reads a bounded outline and prepares an accessibility edit for approval', async t => {
  agentSettings(t,{
    STUDIO_ASSISTANT_OLLAMA_MODEL:'lesson:latest', STUDIO_OLLAMA_URL:'http://127.0.0.1:11434',
    STUDIO_EMBEDDING_MODEL:'', STUDIO_MEM0_URL:'',
  });
  const app = createStudioServer({dbPath:':memory:'});
  t.after(() => app.close());
  const root = '/api/decks/schoolyard-en';
  const before = (await app.inject({url:root})).json<Deck>();
  const imageSlide = before.slides.find(slide => slide.image)!;
  assert.ok(imageSlide);
  const order = before.outline;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL, req: RequestInit) => {
    if (url.pathname==='/api/tags')
      return Response.json({models:[{name:'lesson:latest',digest:'one',details:{format:'gguf'}}]});
    const request = JSON.parse(JSON.parse(String(req.body)).messages[1].content);
    if (++calls === 1)
      return Response.json({message:{content:JSON.stringify({read:{tool:'read_outline',start:2,count:2}})}});
    const outlines = request.evidence.filter((item: {field: string}) => item.field === 'outline');
    assert.equal(outlines.length,3);
    assert.ok(outlines[1].excerpt.startsWith('2. ' + order[1].title));
    assert.ok(outlines[2].excerpt.startsWith('3. ' + order[2].title));
    return Response.json({message:{content:JSON.stringify({
      reply:'I prepared the image description for review.',
      actions:[{tool:'edit_slide',slideId:imageSlide.id,changes:{},imageDecorative:true}],
    })}});
  });
  const response = await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'outline-accessibility',locale:'en',text:'Review the first teaching activity and improve image accessibility.',
  }});
  const message = snapshots(response.body).at(-1)?.messages.at(-1);
  assert.equal(message?.reads?.at(-1)?.tool,'read_outline');
  assert.equal(message?.proposal?.status,'pending');
  assert.equal(message.proposal.changes?.[0].after?.image?.decorative,true);
  assert.equal((await app.inject({url:root})).json<Deck>().revision,before.revision);
  const dismissal = await app.inject({method:'POST',url:root+'/assistant/proposals/outline-accessibility',payload:{action:'dismiss'}});
  assert.equal(dismissal.statusCode,200);
  assert.equal(dismissal.json<AssistantSnapshot>().messages.at(-1)?.proposal?.status,'dismissed');
  assert.deepEqual((await app.inject({url:root})).json<Deck>(),before);
});

test('attached documents supply bounded local evidence and never appear in a later Alem request', async t => {
  agentSettings(t,{
    ALEM_API_KEY:'attachment-test-key', STUDIO_ASSISTANT_OLLAMA_MODEL:'', STUDIO_EMBEDDING_MODEL:'', STUDIO_MEM0_URL:'',
  });
  const app = createStudioServer({dbPath:':memory:'});
  t.after(() => app.close());
  const created = await app.inject({method:'POST',url:'/api/decks',payload:{
    topic:'Water measurement',language:'en',provider:'alem',review:true,template:'blank',
  }});
  assert.equal(created.statusCode,201);
  const deck = created.json<Deck>();
  const path = `/api/decks/${deck.id}/assistant`;
  const name = 'coastal-field-notes.txt';
  const firstText = 'Irrelevant preface. '.repeat(80) + '🌊 The marine tide gauge reported 17 observations.';
  const lastLine = 'The marine tide gauge reported 17 observations.';
  const payload = {
    clientId:'document-proof',locale:'en',slideId:deck.slides[0].id,text:'What did the marine tide gauge report for this slide?',
    attachments:[{name,text:firstText},{name:'instrument-name.txt',text:'The station used an amber survey marker.'}],
  };
  const send = (input:object) => app.inject({method:'POST',url:path,payload:input});
  const provider = t.mock.method(globalThis,'fetch',async (_url:URL, request:RequestInit)=>{
    const sent = String(request.body);
    for (const confidential of [name, 'instrument-name.txt', 'marine tide gauge', 'Irrelevant preface', 'amber survey marker'])
      assert.ok(!sent.includes(confidential));
    return Response.json({choices:[{message:{content:JSON.stringify({reply:'Review the new title.',actions:[{tool:'edit_deck',title:'Updated water lesson'}]})}}]});
  });

  const response = await send(payload);
  assert.equal(response.statusCode,200);
  const snapshotsForTurn = snapshots(response.body);
  assert.deepEqual(snapshotsForTurn[0].messages[0].fileNames,[name,'instrument-name.txt']);
  assert.ok(!response.body.includes(firstText));
  const final = snapshotsForTurn.at(-1)?.messages.at(-1);
  assert.match(final?.text ?? '',new RegExp(lastLine,'u'));
  const source = final?.citations?.[0];
  assert.equal(source?.field,'attachment.text');
  assert.equal(source.label,name);
  assert.equal(Array.from(firstText).slice(source.start,source.end).join(''),source.excerpt);
  assert.ok(source.end-source.start<=640);
  assert.equal(final?.citations?.[1].label,'instrument-name.txt');
  assert.equal(provider.mock.callCount(),0);
  const stored = (await app.inject({url:path})).json<AssistantSnapshot>();
  assert.deepEqual(stored.messages,snapshotsForTurn.at(-1)?.messages);
  assert.equal((await send(payload)).statusCode,200);
  assert.equal((await send({...payload,attachments:[{name,text:'Different file.'}]})).statusCode,409);
  assert.equal((await send({...payload,clientId:'long',attachments:[{name,text:'a'.repeat(12001)}]})).statusCode,400);
  assert.equal((await send({...payload,clientId:'many',attachments:Array(3).fill({name,text:'Example'})})).statusCode,400);

  const retry = {clientId:'retry-document',locale:'en',text:payload.text,attachmentTurnId:payload.clientId};
  const retried = await send(retry);
  assert.equal(retried.statusCode,200);
  const retriedMessages = snapshots(retried.body).at(-1)?.messages;
  assert.deepEqual(retriedMessages?.at(-2)?.fileNames,[name,'instrument-name.txt']);
  assert.equal(retriedMessages?.at(-1)?.citations?.[0].excerpt,source.excerpt);
  assert.equal((await send({...retry,clientId:'retry-again',attachmentTurnId:retry.clientId})).statusCode,200);
  assert.equal((await send({...retry,clientId:'lost-file',attachmentTurnId:'nonexistent'})).statusCode,404);
  assert.equal((await send({...retry,clientId:'mixed-sources',attachments:payload.attachments})).statusCode,400);
  const otherDeck = await app.inject({method:'POST',url:'/api/decks/schoolyard-en/assistant',payload:retry});
  assert.equal(otherDeck.statusCode,404);
  assert.equal(provider.mock.callCount(),0);

  const cloud = await send({clientId:'ordinary-turn',locale:'en',text:'Rename this lesson.'});
  assert.equal(cloud.statusCode,200);
  assert.equal(snapshots(cloud.body).at(-1)?.messages.at(-1)?.proposal?.status,'pending');
  assert.equal(provider.mock.callCount(),1);
});

test('cloud source RAG requires explicit consent and sends only matches for that turn', async t=>{
  agentSettings(t,{
    STUDIO_AUTH_MODE:'local', ALEM_API_KEY:'source-rag-mock-key', STUDIO_CLOUD_SOURCE_RAG:'0',
    STUDIO_ASSISTANT_OLLAMA_MODEL:'', STUDIO_EMBEDDING_MODEL:'', STUDIO_AUTHORING_MODEL:'',
    STUDIO_MODERATION_OLLAMA_MODEL:'', STUDIO_MEM0_URL:'', TYPESAFE_API_KEY:'',
  });
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const deck = (await app.inject({method:'POST',url:'/api/decks',payload:{
    topic:'SENSITIVE_DECK_TITLE',language:'en',provider:'alem',review:true,template:'blank',
  }})).json<Deck>();
  const path='/api/decks/'+deck.id;
  const slide=deck.slides[0];
  assert.equal((await app.inject({method:'PATCH',url:path,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{notes:'SENSITIVE_UNREAD_SPEAKER_NOTES'}}}})).statusCode,200);
  const upload = await app.inject({method:'POST',url:'/api/source-files/txt?name=Field%20observations.txt',
    headers:{'Content-Type':'application/octet-stream'},
    payload:Buffer.from('UNRETRIEVED_PREFACE_TOKEN '.repeat(140)+'\n'+'Background. '.repeat(110)+'The tide gauge recorded 17 observations.')});
  assert.equal(upload.statusCode,201,upload.body);
  const fileId=upload.json<{id:string}>().id;
  const query='How many observations did the tide gauge record?';
  const ask = (fields:object) => app.inject({method:'POST',url:path+'/assistant',payload:{
    locale:'en',slideId:slide.id,text:query,...fields,
  }});
  const provider=t.mock.method(globalThis,'fetch',async (url:URL,request:RequestInit)=>{
    assert.equal(String(url),'https://llm.alem.ai/v1/chat/completions');
    const payload=JSON.parse(JSON.parse(String(request.body)).messages[1].content);
    const serialized=JSON.stringify(payload);
    for (const secret of ['UNRETRIEVED_PREFACE_TOKEN','PRIVATE_PREVIOUS_PROMPT'])
      assert.ok(!serialized.includes(secret));
    if (payload.message===query) {
      assert.ok(!serialized.includes('SENSITIVE_DECK_TITLE'));
      assert.ok(!serialized.includes('SENSITIVE_UNREAD_SPEAKER_NOTES'));
      assert.equal(payload.context,undefined);
      assert.equal(payload.lesson.selectedContent,undefined);
      assert.ok(payload.evidence.length>0 && payload.evidence.length<=3);
      const hit=payload.evidence.find((e:{excerpt:string})=>e.excerpt.includes('17 observations'));
      assert.equal(hit?.label,'Field observations.txt');
      assert.ok(payload.evidence.every((e:{excerpt:string})=>[...e.excerpt].length<=640));
      return Response.json({choices:[{message:{content:JSON.stringify({reply:'The gauge recorded 17 observations [[E1]].',citations:['E1'],actions:[]})}}]});
    }
    assert.equal(payload.message,'Rename the lesson.');
    assert.ok(!serialized.includes('Field observations.txt'));
    assert.ok(!serialized.includes(query));
    assert.ok(!serialized.includes('17 observations'));
    return Response.json({choices:[{message:{content:JSON.stringify({reply:'Suggested a title.',actions:[{tool:'edit_deck',title:'Water measurement'}]})}}]});
  });

  const capability=async ()=>(await app.inject({url:'/api/capabilities'})).json<{cloudSourceRag:boolean}>().cloudSourceRag;
  assert.equal(await capability(),false);
  assert.equal((await ask({clientId:'disabled',sourceFileIds:[fileId],useCloudSourceRag:true})).statusCode,503);
  process.env.STUDIO_CLOUD_SOURCE_RAG='1';
  assert.equal(await capability(),true);
  assert.equal((await ask({clientId:'unscoped',useCloudSourceRag:true})).statusCode,400);
  const privateResponse=await ask({clientId:'local-only',sourceFileIds:[fileId],text:query+' PRIVATE_PREVIOUS_PROMPT'});
  assert.equal(snapshots(privateResponse.body).at(-1)?.messages.at(-1)?.citations?.[0].sourceFileId,fileId);
  assert.equal(provider.mock.callCount(),0);

  const response = await ask({clientId:'cloud-selected',sourceFileIds:[fileId],useCloudSourceRag:true});
  assert.equal(response.statusCode,200,response.body);
  const answer = snapshots(response.body).at(-1)?.messages.at(-1);
  assert.match(answer?.text ?? '', /^The gauge recorded 17 observations \[1\]\.$/);
  assert.equal(answer?.citations?.[0].sourceFileId,fileId);
  assert.equal((await ask({clientId:'retry-local',attachmentTurnId:'cloud-selected'})).statusCode,200);
  const missing = await ask({clientId:'cloud-missing',text:'Xylobranthym?',searchSourceLibrary:true,useCloudSourceRag:true});
  assert.match(snapshots(missing.body).at(-1)?.messages.at(-1)?.text ?? '',/couldn’t find support/u);
  assert.equal(provider.mock.callCount(),1);
  const ordinary = await ask({clientId:'ordinary',text:'Rename the lesson.'});
  assert.equal(snapshots(ordinary.body).at(-1)?.messages.at(-1)?.proposal?.status,'pending');
  assert.equal(provider.mock.callCount(),2);
});

test('Alem history excludes unclassified legacy and interrupted private turns', async t=>{
  agentSettings(t,{ALEM_API_KEY:'history-test-key',STUDIO_AUTH_MODE:'local',STUDIO_MODERATION_OLLAMA_MODEL:'',
    ALEM_EMBEDDINGS_API_KEY:'',ALEM_RERANK_API_KEY:'',STUDIO_EMBEDDING_MODEL:'',STUDIO_ASSISTANT_OLLAMA_MODEL:'',STUDIO_MEM0_URL:''});
  const store=new StudioStore(':memory:'),studio=new Studio(store),assistant=new DeckAssistant(studio,tmpdir());
  t.after(()=>studio.close());
  const deck=studio.create({topic:'Plant seedlings',language:'en',provider:'alem',template:'blank',review:false});
  const input=(clientId:string,text:string)=>({clientId,text,locale:'en' as const,slideId:deck.slides[0].id});
  const previous=input('legacy','Private field diary question');
  store.saveAssistantTurn(deck.id,previous.clientId,{
    input:previous,user:{id:'user-legacy',role:'user',text:previous.text,slideId:previous.slideId},
    assistant:{id:'assistant-legacy',role:'assistant',text:'Private diary response',status:'complete'},
  });

  const publicTurn=input('ordinary','Use the Editorial theme.');
  const consume=async(events:ReturnType<DeckAssistant['open']>['events'])=>{for await(const snapshot of events)assert.ok(snapshot.messages.length);};
  await consume(assistant.open(deck.id,publicTurn).events);
  const privateTurn=input('interrupted','Unpublished assessment results');
  const preference=assistant.memory.add(deck.id,'Private assessment preference').memory[0];
  assistant.open(deck.id,privateTurn);
  // Cancellation before the first model or moderation step must preserve the privacy decision.
  assistant.cancel(deck.id,privateTurn.clientId);
  const cancelled=store.assistantTurn<{localOnly?:boolean;assistant:{status:string}}>(deck.id,privateTurn.clientId);
  assert.equal(cancelled?.assistant.status,'cancelled');
  assert.equal(cancelled.localOnly,true);
  const inFlight=input('started-with-preference','Use the Museum theme for the private worksheet.');
  const retained=assistant.open(deck.id,inFlight);
  await assistant.memory.remove(deck.id,preference.id);
  await consume(retained.events);
  assert.equal(store.assistantTurn<{localOnly?:boolean}>(deck.id,inFlight.clientId)?.localOnly,true);

  const prompts:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:URL|string,init:RequestInit)=>{
    assert.equal(new URL(url).hostname,'llm.alem.ai');
    prompts.push(String(init.body));
    return Response.json({choices:[{message:{content:JSON.stringify({
      reply:'Review the new lesson name.',actions:[{tool:'edit_deck',title:'Seedling observations'}],
    })}}]});
  });
  await consume(assistant.open(deck.id,input('follow-up','Rename this lesson.')).events);
  assert.ok(prompts.length>0);
  for(const prompt of prompts){
    const context=JSON.parse(JSON.parse(prompt).messages[1].content).context as {question:string}[];
    assert.deepEqual(context.map(turn=>turn.question),[publicTurn.text]);
    for(const secret of [previous.text,'Private diary response',privateTurn.text,inFlight.text,preference.text])
      assert.ok(!prompt.includes(secret));
  }
  assert.equal(assistant.get(deck.id).messages.at(-1)?.proposal?.status,'pending');
});
