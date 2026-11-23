import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStudioServer } from '../app';
import type { Deck } from '@sabaq/lesson/types';

test('gateway ownership covers lists, memory, edits, source reuse, comments, revocation and audited admin reads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-access-')), file = join(dir,'studio.sqlite');
  const prev = [process.env.STUDIO_AUTH_MODE,process.env.STUDIO_GATEWAY_SECRET];
  const token = 'local-test-only-key-0000000000000000';
  process.env.STUDIO_AUTH_MODE = 'gateway'; process.env.STUDIO_GATEWAY_SECRET = token;
  t.after(async () => {
    for (const [i,k] of ['STUDIO_AUTH_MODE','STUDIO_GATEWAY_SECRET'].entries()) {
      if (prev[i]===undefined) delete process.env[k]; else process.env[k]=prev[i];
    }
    await rm(dir,{recursive:true,force:true});
  });
  const app = createStudioServer({dbPath:file});
  t.after(()=>app.close());
  const headers = (user:string,org='school') => ({'x-studio-gateway':token,'x-studio-user':user,'x-studio-org':org});
  const owner = headers('owner'), viewer = headers('viewer'), outsider = headers('viewer','other');
  const input = {topic:'Private lesson', template:'blank', slideCount:3, language:'en', review:false, provider:'fixture',
    source:{name:'notes',text:'Class material'}};
  assert.equal((await app.inject({url:'/api/decks',headers:{'x-studio-user':'owner'}})).statusCode,401);
  const created = await app.inject({url:'/api/decks',method:'POST',headers:owner,payload:input});
  assert.equal(created.statusCode,201,created.body);
  const deck = created.json<Deck>(), url='/api/decks/'+deck.id;
  assert.equal(deck.viewerPermission,'owner');
  assert.deepEqual((await app.inject({url:'/api/decks',headers:viewer})).json(),[]);
  for (const path of ['', '/assistant/memory','/events','/revisions','/export/pptx','/comments'])
    assert.equal((await app.inject({url:url+path,headers:viewer})).statusCode,403,path);
  assert.deepEqual((await app.inject({url:'/api/sources',headers:viewer})).json(),[]);
  assert.equal((await app.inject({url:'/api/decks',method:'POST',headers:viewer,payload:{...input,source:undefined,sourceDeckId:deck.id}})).statusCode,403);
  assert.equal((await app.inject({url:url+'/access',method:'PUT',headers:owner,payload:{subject:'viewer',permission:'view'}})).statusCode,200);
  for (const path of ['/assistant','/assistant/memory'])
    assert.equal((await app.inject({url:url+path,headers:viewer})).statusCode,403,path);
  assert.equal((await app.inject({url,headers:viewer})).json().viewerPermission,'view');
  assert.equal((await app.inject({url,headers:outsider})).statusCode,403);
  assert.equal((await app.inject({url:url+'/access',headers:viewer})).statusCode,403);
  assert.equal((await app.inject({url,method:'PATCH',headers:viewer,payload:{op:{kind:'deck',title:'updated'}}})).statusCode,403);
  assert.equal((await app.inject({url:url+'/comments',method:'POST',headers:viewer,payload:{text:'Hi',slideId:deck.slides[0].id}})).statusCode,200);
  assert.equal((await app.inject({url:url+'/comments',headers:owner})).json()[0].subject,'viewer');
  assert.equal((await app.inject({url:url+'/comments/unread',headers:owner})).json().unread,1);
  const commentId=(await app.inject({url:url+'/comments',headers:owner})).json()[0].id;
  await app.inject({url:url+'/comments/read',method:'POST',headers:owner,payload:{id:commentId}});
  assert.equal((await app.inject({url:url+'/comments/unread',headers:owner})).json().unread,0);
  const view={session:crypto.randomUUID(),slideId:deck.slides[0].id};
  for (let i=0;i<2;i++) assert.equal((await app.inject({url:url+'/view-state',method:'POST',headers:viewer,payload:view})).statusCode,200);
  assert.deepEqual((await app.inject({url:url+'/access/views',headers:owner})).json(),{opens:1,completed:0,lastSlide:deck.slides[0].id});
  for (let i=1;i<10;i++) {
    const session=crypto.randomUUID();
    const report=(slideId:string)=>app.inject({url:url+'/view-state',method:'POST',headers:viewer,payload:{session,slideId}});
    await report(deck.slides[0].id);
    if(i<=5) { await report(deck.slides.at(-1)!.id);await report(deck.slides[0].id); }
  }
  assert.deepEqual((await app.inject({url:url+'/access/views',headers:owner})).json(),{opens:10,completed:5,lastSlide:deck.slides[0].id});
  await app.inject({url:url+'/access',method:'PUT',headers:owner,payload:{subject:'viewer',permission:'edit'}});
  assert.equal((await app.inject({url:url+'/edit-session',method:'POST',headers:viewer})).statusCode,200);
  assert.equal((await app.inject({url:url+'/edit-session',method:'POST',headers:owner})).statusCode,423);
  assert.equal((await app.inject({url:url+'/edit-session/release',method:'POST',headers:viewer})).statusCode,200);
  assert.equal((await app.inject({url:url+'/edit-session',method:'POST',headers:owner})).statusCode,200);
  assert.equal((await app.inject({url:url+'/access/viewer',method:'DELETE',headers:owner})).statusCode,200);
  assert.equal((await app.inject({url:url+'/comments',headers:viewer})).statusCode,403);
  assert.equal((await app.inject({url,headers:{...headers('support'),'x-studio-role':'system-admin'}})).statusCode,200);
  const audit = new DatabaseSync(file,{readOnly:true});
  assert.deepEqual(audit.prepare("SELECT name FROM pragma_table_info('deck_views')").all().map(row=>row.name),
    ['deck_id','session','slide_id','completed','at']);
  assert.equal(audit.prepare('SELECT subject FROM admin_access WHERE deck_id=?').get(deck.id)?.subject,'support');
  audit.close();
});
