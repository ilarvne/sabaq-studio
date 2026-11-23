import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

test('a group copies, replays and undoes in one revision while enforcing source access and order',async t=>{
  const key='test-gateway-for-slide-group-regression';
  const env={STUDIO_AUTH_MODE:process.env.STUDIO_AUTH_MODE, STUDIO_GATEWAY_SECRET:process.env.STUDIO_GATEWAY_SECRET};
  process.env.STUDIO_AUTH_MODE='gateway';process.env.STUDIO_GATEWAY_SECRET=key;
  t.after(()=>{for (const [name,value] of Object.entries(env)) {if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  const app=createStudioServer({dbPath:':memory:'});t.after(()=>app.close());
  const headers=(user:string)=>({'x-studio-gateway':key,'x-studio-user':user,'x-studio-org':'school'});
  async function blank(user:string,source?:{name:string;text:string}) {
    const res=await app.inject({method:'POST',url:'/api/decks',headers:headers(user),payload:{
      topic:'Classroom',language:'en',provider:'fixture',template:'blank',slideCount:3,review:false,source}});
    assert.equal(res.statusCode,201,res.body);return res.json<Deck>();
  }
  const source=await blank('author',{name:'private-source',text:'Private teacher notes'}),destination=await blank('recipient');
  const root='/api/decks/'+destination.id;
  const op={kind:'copySlides',sourceDeckId:source.id,sourceRevision:source.revision,
    slideIds:[source.slides[2].id,source.slides[0].id],afterId:destination.slides[0].id};
  const body={op,operationId:randomUUID(),baseRevision:destination.revision};
  const patch=(payload:object)=>app.inject({method:'PATCH',url:root,headers:headers('recipient'),payload});
  assert.equal((await patch(body)).statusCode,403);
  await app.inject({method:'PUT',url:'/api/decks/'+source.id+'/access',headers:headers('author'),payload:{subject:'recipient',permission:'view'}});
  const res=await patch(body);assert.equal(res.statusCode,200,res.body);
  const copied=res.json<Deck>();assert.equal(copied.slides.length,5);assert.equal(copied.provider,'local');
  assert.equal(copied.source,undefined);assert.equal(copied.slides[1].title,source.slides[0].title);
  assert.equal(copied.slides[2].title,source.slides[2].title);
  assert.ok(copied.slides.every(slide=>!source.slides.some(original=>original.id===slide.id)));
  assert.equal((await patch(body)).json<Deck>().revision,copied.revision);
  const invalid=await patch({op:{...op,sourceRevision:source.revision+1},baseRevision:copied.revision});
  assert.equal(invalid.statusCode,409);
  assert.equal((await patch({op:{kind:'removeSlides',slideIds:copied.slides.map(s=>s.id)},baseRevision:copied.revision})).statusCode,400);
  assert.equal((await app.inject({url:root,headers:headers('recipient')})).json<Deck>().revision,copied.revision);
  const restored=await app.inject({method:'POST',url:root+'/revisions/'+destination.revision+'/restore',headers:headers('recipient'),
    payload:{baseRevision:copied.revision,intent:'undo',operationId:randomUUID()}});
  assert.equal(restored.statusCode,200,restored.body);assert.equal(restored.json<Deck>().slides.length,3);
});
