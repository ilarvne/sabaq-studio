import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import type { Deck } from '@sabaq/lesson/types';
import type { CoeditState } from '@sabaq/lesson/coedit';
import { createStudioServer } from '../app';

test('self-hosted editing converges across 100 overlapping changes, retains selective undo and enforces revocation',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-coedit-')),dbPath=join(dir,'studio.sqlite');
  const secret='local-shared-edit-test-0000000000000';
  const env={STUDIO_AUTH_MODE:process.env.STUDIO_AUTH_MODE,STUDIO_GATEWAY_SECRET:process.env.STUDIO_GATEWAY_SECRET,STUDIO_COEDIT:process.env.STUDIO_COEDIT};
  process.env.STUDIO_AUTH_MODE='gateway';process.env.STUDIO_GATEWAY_SECRET=secret;process.env.STUDIO_COEDIT='1';
  let app=createStudioServer({dbPath});
  t.after(async()=>{await app.close();for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});});
  const traffic=t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected network request');});
  const identity=(name:string,org='school')=>({'x-studio-gateway':secret,'x-studio-user':name,'x-studio-org':org});
  const a=identity('one'),b=identity('two');
  const created=await app.inject({method:'POST',url:'/api/decks',headers:a,payload:{topic:'Shared physics',template:'blank',language:'kk',provider:'fixture',review:false}});
  assert.equal(created.statusCode,201);const deck=created.json<Deck>(),slide=deck.slides[0];
  const path='/api/decks/'+deck.id,room='/api/coedit/'+deck.id+'/'+slide.id;
  const permission=(who:string,permission:'view'|'edit')=>app.inject({method:'PUT',url:path+'/access',headers:a,payload:{subject:who,permission}});
  await permission('two','edit');await permission('reader','view');
  const writer=(headers:ReturnType<typeof identity>)=>{
    const doc=new Y.Doc(),body=doc.getText('body'),origin={};
    const undo=new Y.UndoManager(body,{trackedOrigins:new Set([origin]),captureTimeout:0});
    const session=crypto.randomUUID();let state:CoeditState|undefined;
    const pending:Uint8Array[]=[];
    doc.on('update',(update:Uint8Array,source:unknown)=>{if(source===origin||source===undo)pending.push(update);});
    async function sync(){
      const count=pending.length;
      const response=await app.inject({method:'POST',url:room+'/sync',headers,payload:{session,room:state?.room,sequence:state?.sequence,
        vector:Buffer.from(Y.encodeStateVector(doc)).toString('base64'),update:count?Buffer.from(Y.mergeUpdates(pending)).toString('base64'):undefined,
        cursor:state && {field:'body',position:Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(body,body.length))).toString('base64')}}});
      assert.equal(response.statusCode,200,response.body);
      state=response.json<CoeditState>();if(state.update)Y.applyUpdate(doc,Buffer.from(state.update,'base64'),'remote');pending.splice(0,count);
      return state;
    }
    return {doc,body,origin,undo,sync,session};
  };
  const left=writer(a),right=writer(b);
  const raw=(headers:ReturnType<typeof identity>,data:Record<string,unknown>)=>app.inject({url:room+'/sync',method:'POST',headers,payload:{session:crypto.randomUUID(),...data}});
  assert.equal((await raw(identity('one','elsewhere'),{})).statusCode,403);
  assert.equal((await raw(identity('reader'),{})).statusCode,403);
  await app.inject({method:'POST',url:path+'/edit-session',headers:a});
  assert.equal((await raw(b,{})).statusCode,423);
  await left.sync();await right.sync();
  const intervals:number[]=[];
  for(let round=0;round<50;round++){
    // Both clients insert at the same position before seeing the other's change.
    left.doc.transact(()=>left.body.insert(0,'Ә'),left.origin);
    right.doc.transact(()=>right.body.insert(0,'Қ'),right.origin);
    const start=performance.now();
    await Promise.all([left.sync(),right.sync()]);
    const [,observed]=await Promise.all([left.sync(),right.sync()]);
    intervals.push(performance.now()-start);
    assert.equal(left.body.toString(),right.body.toString());
    assert.equal(observed.peers[0].name,'one');
    assert.equal(observed.peers[0].field,'body');
    const cursor=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(observed.peers[0].position!,'base64')),right.doc);
    assert.equal(cursor?.index,right.body.length);
  }
  const before=left.body.toString();
  assert.equal(before.length,100);assert.equal([...before].filter(c=>c==='Қ').length,50);
  left.undo.undo();await left.sync();await right.sync();
  assert.equal(left.body.toString(),right.body.toString());assert.equal(right.body.length,99);
  assert.equal([...right.body.toString()].filter(c=>c==='Қ').length,50);
  left.undo.redo();await left.sync();await right.sync();assert.equal(right.body.toString(),before);
  assert.equal((await app.inject({method:'PATCH',url:path,headers:a,payload:{op:{kind:'deck',title:'Cannot overwrite a live room'}}})).statusCode,423);
  const received=await left.sync();
  // A grant downgrade removes both write access and peer presence on the next request.
  await permission('two','view');
  assert.equal((await raw(b,{session:right.session,room:received.room})).statusCode,403);
  assert.deepEqual((await left.sync()).peers,[]);
  assert.equal((await app.inject({url:path,headers:a})).json<Deck>().slides[0].body,before);
  await app.close();app=createStudioServer({dbPath});
  const reopened=writer(a);const snapshot=await reopened.sync();
  assert.equal(reopened.body.toString(),before);assert.equal(snapshot.room,received.room);assert.deepEqual(snapshot.peers,[]);
  await app.inject({method:'POST',url:room+'/leave',headers:a,payload:{session:reopened.session}});
  const saved=(await app.inject({url:path,headers:a})).json<Deck>().slides[0];
  assert.equal((await app.inject({method:'PATCH',url:path,headers:a,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:saved.version,changes:{body:'Updated normally'}}}})).statusCode,200);
  assert.equal((await raw(a,{room:snapshot.room})).statusCode,409);
  const replacement=writer(a);assert.notEqual((await replacement.sync()).room,snapshot.room);assert.equal(replacement.body.toString(),'Updated normally');
  assert.equal(traffic.mock.callCount(),0);
  const sorted=intervals.sort((x,y)=>x-y);t.diagnostic('Two writes plus both reads per overlapping pair: p50 '+sorted[24].toFixed(1)+'ms, p95 '+sorted[47].toFixed(1)+'ms, max '+sorted.at(-1)!.toFixed(1)+'ms (in-process API).');
  for(const session of [left,right,reopened,replacement])session.doc.destroy();
});
