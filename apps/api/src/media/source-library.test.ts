import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import type { SourceFile, SourceFileDetail } from '@sabaq/contracts/source-files';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

const gatewayKey = 'local-source-library-regression-test-key';
const headers = (user: string, org = 'school') => ({
  'x-studio-gateway':gatewayKey, 'x-studio-user':user, 'x-studio-org':org,
});
const latest = (body: string) => JSON.parse(body.trim().split('\n').at(-1)!) as AssistantSnapshot;

test('personal file uploads retain originals and ground assistant and lesson requests within the owner scope', async t => {
  const settings = {
    STUDIO_AUTH_MODE:'gateway', STUDIO_GATEWAY_SECRET:gatewayKey, STUDIO_ASSISTANT_OLLAMA_MODEL:'',
    STUDIO_AUTHORING_MODEL:'', STUDIO_EMBEDDING_MODEL:'', STUDIO_MODERATION_OLLAMA_MODEL:'',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
  Object.assign(process.env,settings);
  const app = createStudioServer({dbPath:':memory:'});
  t.after(async () => {
    await app.close();
    for (const [key,value] of Object.entries(previous)) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  });

  const owner = headers('teacher');
  const other = headers('other');
  const sourceName = 'Өлшеу дәптері.txt';
  const sourceText = 'Үлгі мәтіні. '.repeat(100) + '🌱 Арқардың саны 37 дарақ болды.';
  const original = Buffer.from('  '+sourceText+'\n','utf8');
  const upload = (name: string, payload: Buffer, principal = owner) => app.inject({method:'POST',
    url:'/api/source-files/txt?name='+encodeURIComponent(name),
    headers:{...principal,'content-type':'application/octet-stream'},payload});
  const saved = await upload(sourceName,original);
  assert.equal(saved.statusCode,201,saved.body);
  const file = saved.json<SourceFile>();
  assert.deepEqual(file,{id:file.id,name:sourceName,format:'txt',size:original.length,characterCount:[...sourceText].length,createdAt:file.createdAt});
  assert.equal((await upload(sourceName,original)).json<SourceFile>().id,file.id);
  assert.equal((await upload('invalid.txt',Buffer.from([0xC3,0x28]))).statusCode,422);
  assert.equal((await upload('huge.txt',Buffer.from('x'.repeat(100001)))).statusCode,413);
  const alternate = (await upload('Өсімдік.txt',Buffer.from('Үлгі бақшада өсімдік саны 19 болды.'))).json<SourceFile>();
  const otherFile = (await upload('Other teacher.txt',Buffer.from('Арқардың саны 810933 дарақ болды.'),other)).json<SourceFile>();

  const list = await app.inject({url:'/api/source-files',headers:owner});
  assert.equal(list.headers['cache-control'],'no-store');
  assert.deepEqual(list.json<SourceFile[]>().map(row=>row.id).sort(),[file.id,alternate.id].sort());
  assert.deepEqual((await app.inject({url:'/api/source-files',headers:other})).json<SourceFile[]>().map(row=>row.id),[otherFile.id]);
  assert.deepEqual((await app.inject({url:'/api/source-files',headers:headers('teacher','another-school')})).json(),[]);
  assert.equal((await app.inject({url:'/api/source-files'})).statusCode,401);
  const fileUrl = '/api/source-files/'+file.id;
  assert.equal((await app.inject({url:fileUrl,headers:owner})).json<SourceFileDetail>().text,sourceText);
  const download = await app.inject({url:fileUrl+'/download',headers:owner});
  assert.deepEqual(download.rawPayload,original);
  assert.match(String(download.headers['content-disposition']),/^attachment; filename\*=UTF-8''/);
  for (const url of [fileUrl,fileUrl+'/download']) {
    assert.equal((await app.inject({url,headers:other})).statusCode,404);
    assert.equal((await app.inject({url,headers:{...other,'x-studio-role':'system-admin'}})).statusCode,404);
  }
  assert.equal((await app.inject({method:'DELETE',url:fileUrl,headers:other})).statusCode,404);

  const lesson = {topic:'Арқарды зерттеу',language:'kk' as const,provider:'fixture' as const,review:true};
  const create = (payload:object, principal=owner) => app.inject({method:'POST',url:'/api/decks',headers:principal,payload:{...lesson,...payload}});
  const seeded = await create({sourceFileIds:[file.id,alternate.id],sourceNotes:'Сынып талқылауы.'});
  assert.equal(seeded.statusCode,201,seeded.body);
  assert.match(seeded.json<Deck>().source?.text ?? '',/Өлшеу дәптері\.txt[\s\S]*Өсімдік\.txt[\s\S]*Сынып талқылауы/);
  assert.equal((await create({sourceFileIds:[file.id]},other)).statusCode,404);
  assert.equal((await create({sourceFileIds:[file.id],sourceNotes:'x'.repeat(100_000)})).statusCode,413);
  assert.equal((await create({sourceFileIds:[file.id],source:{name:'Other',text:'Mixed.'}})).statusCode,400);

  const deck = (await create({template:'blank'})).json<Deck>();
  const deckUrl = '/api/decks/'+deck.id;
  assert.equal((await app.inject({method:'PUT',url:deckUrl+'/access',headers:owner,payload:{subject:'other',permission:'edit'}})).statusCode,200);
  const assistantUrl = deckUrl+'/assistant';
  const ask = (data:object, principal=owner) => app.inject({method:'POST',url:assistantUrl,headers:principal,
    payload:{clientId:randomUUID(),text:'Арқардың саны қанша?',locale:'kk',...data}});
  const search = await ask({searchSourceLibrary:true,clientId:'rag-all'});
  assert.equal(search.statusCode,200,search.body);
  assert.ok(!search.body.includes('810933'));
  const answer = latest(search.body);
  assert.equal(answer.messages.at(-2)?.searchedSourceLibrary,true);
  const citation = answer.messages.at(-1)?.citations?.[0];
  assert.equal(citation?.sourceFileId,file.id);
  assert.equal(citation.label,sourceName);
  assert.match(citation.excerpt,/37 дарақ/);
  assert.equal([...sourceText].slice(citation.start,citation.end).join(''),citation.excerpt);
  assert.deepEqual((await app.inject({url:assistantUrl,headers:other})).json<AssistantSnapshot>().messages,[]);
  assert.equal((await app.inject({method:'POST',url:deckUrl+'/edit-session/release',headers:owner})).statusCode,200);
  assert.equal((await ask({sourceFileIds:[file.id]},other)).statusCode,404);
  assert.equal((await ask({attachmentTurnId:'rag-all'},other)).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:deckUrl+'/edit-session/release',headers:other})).statusCode,200);

  const selected = await ask({sourceFileIds:[file.id],clientId:'rag-selected'});
  assert.equal(selected.statusCode,200,selected.body);
  assert.deepEqual(latest(selected.body).messages.at(-2)?.fileNames,[sourceName]);
  assert.equal((await ask({attachmentTurnId:'rag-selected'})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:fileUrl,headers:owner})).statusCode,204);
  assert.equal((await ask({attachmentTurnId:'rag-selected'})).statusCode,404);
  assert.equal((await app.inject({url:fileUrl+'/download',headers:owner})).statusCode,404);
  const retried = await ask({attachmentTurnId:'rag-all'});
  assert.equal(retried.statusCode,200,retried.body);
  assert.ok(latest(retried.body).messages.at(-1)?.citations?.every(hit=>hit.sourceFileId!==file.id) ?? true);
});
