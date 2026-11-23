import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Studio} from '../lessons/studio';
import {StudioStore} from '../persistence/storage';
import {VideoService} from './video';
import {digestFile} from './video-verification';
import {createStudioServer} from '../app';

test('gateway consent is subject-scoped, revocation blocks serving and purges every revision and scene, deletion retries after restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'biometric-lifecycle-'));
  const vars={STUDIO_VIDEO_REGION:'KZ',STUDIO_KZ_PROVIDER_ORIGINS:'https://vault.example,https://worker.example',STUDIO_AUTH_MODE:'gateway',STUDIO_GATEWAY_SECRET:'synthetic-gateway-secret-1234567890',
    STUDIO_BIOMETRIC_VAULT_URL:'https://vault.example',STUDIO_BIOMETRIC_VAULT_KEY:'synthetic-secret',
    STUDIO_BIOMETRIC_CONSENT_VERSION:'v1',STUDIO_VIDEO_AVATAR_ID:'shared-legacy'};
  const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
  const store=new StudioStore(join(dir,'db'));const studio=new Studio(store,1,dir);
  const config={url:'https://worker.example',version:'test',avatar:'shared-legacy',detector:join(dir,'detector'),anchors:join(dir,'ca'),token:undefined,c2pa:'c2patool'};
  await writeFile(config.detector,'detector');await writeFile(config.anchors,'CA');
  let deletesOnline=false, scenes=0;
  const operations:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:URL|string,init:RequestInit)=>{
    const url=new URL(input);const data=JSON.parse(String(init.body));
    if(url.origin==='https://vault.example'){
      assert.equal(new Headers(init.headers).get('Authorization'),'Bearer synthetic-secret');
      assert.equal(data.org,undefined);assert.equal(data.subject,undefined);
      const ref=data.subjectRef;assert.match(ref,/^[a-f0-9-]{36}$/);
      if(url.pathname==='/enrollments') return Response.json({subjectRef:ref,enrollmentUrl:'https://vault.example/verified-portal/'+ref});
      if(url.pathname==='/authorizations'){
        operations.push(data.operation);
        return Response.json({subjectRef:ref,state:'active',consentVersion:'v1',avatarId:'avatar-'+ref});
      }
      assert.equal(url.pathname,'/deletions');
      if(!deletesOnline)return new Response('',{status:503});
      return Response.json({subjectRef:ref,deletionId:ref,status:'deleted',erased:data.scopes,receipt:'synthetic-deletion'});
    }
    assert.equal(url.origin,'https://worker.example');
    assert.ok(data.subjectRef);
    if(url.pathname==='/scenes'){
      assert.equal(data.avatarId,'avatar-'+data.subjectRef);scenes++;return Response.json({sceneId:'s'+scenes});
    }
    assert.equal(url.pathname,'/assemble');
    return new Response('synthetic video',{headers:{'Content-Type':'video/mp4'}});
  });
  const service=()=>new VideoService(studio,{generated:dir,catalog:dir},dir,config,
    async file=>({sha256:await digestFile(file),frames:1,mark:'test',watermarkScheme:'synthetic',manifest:'synthetic'}),
    async()=>Buffer.from('synthetic pixels'));
  let video=service();
  t.after(async()=>{await video.close();await studio.close();await rm(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const teacher={org:'A',subject:'teacher',admin:false}, other={...teacher,org:'B'};
  const d=studio.create({topic:'Lesson',language:'en',template:'blank',review:true,provider:'fixture'},teacher);
  const options={language:'en',captions:true,position:'left'} as const;
  assert.equal(video.state(d.id,teacher).avatar,false);
  await assert.rejects(video.start(d.id,d.revision,options,teacher),/consent/);
  await video.vault.enroll(teacher,'v1');assert.equal((await video.vault.status(teacher)).state,'active');
  await video.vault.enroll(other,'v1');await video.vault.status(other);
  assert.notEqual(video.vault.identify(teacher),video.vault.identify(other));
  const ref=video.vault.identify(teacher)!;
  async function render() {
    await video.start(d.id,d.revision,options,teacher);
    for(let i=0;i<200;i++){const job=video.state(d.id,teacher).job;if(job?.status==='ready')return job;await delay(5);}
    assert.fail('Synthetic video did not complete.');
  }
  const first=await render();assert.ok(await video.file(d.id,first.key,teacher));
  d.revision++;d.slides[0].notes='A different scene';store.saveRevision(d,'Edited');const second=await render();
  const stream=await video.download(d.id,second.key,teacher);stream.on('error',()=>{});
  assert.equal((await readdir(dir)).filter(f=>f.endsWith('.mp4')).length,2);
  assert.equal((await video.vault.revoke(teacher)).state,'deleting');
  assert.equal(stream.destroyed,true);
  await assert.rejects(video.file(d.id,second.key));await assert.rejects(video.start(d.id,d.revision,options,teacher));
  assert.equal((await readdir(dir)).filter(f=>f.endsWith('.mp4')).length,0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM video_scenes').get()?.n,0);
  assert.equal(video.state(d.id,other).avatar,true);
  assert.deepEqual(new Set(operations),new Set(['status','start','scene','assemble','release','download']));
  await video.close();deletesOnline=true;video=service();
  for(let i=0;i<100 && video.vault.summary(teacher).state!=='deleted';i++)await delay(5);
  assert.equal(video.vault.summary(teacher).state,'deleted');
  assert.equal(store.db.prepare("SELECT detail FROM biometric_access WHERE ref=? AND action='deletion.confirmed'").get(ref)?.detail,'synthetic-deletion');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM biometric_artifacts WHERE ref=?').get(ref)?.n,0);
  const app=createStudioServer({dbPath:':memory:',mediaRoot:dir});
  try {
    assert.equal((await app.inject({method:'DELETE',url:'/api/biometrics/self'})).statusCode,401);
    const headers={'x-studio-gateway':vars.STUDIO_GATEWAY_SECRET,'x-studio-org':'A','x-studio-user':'teacher'};
    assert.equal((await app.inject({method:'POST',url:'/api/biometrics/self/enrollment',headers,payload:{policy:'v1',consent:false}})).statusCode,400);
    const enrolled=await app.inject({method:'POST',url:'/api/biometrics/self/enrollment',headers,payload:{policy:'v1',consent:true}});
    assert.equal(enrolled.statusCode,200,enrolled.body);
    const stranger={...headers,'x-studio-org':'B'};
    assert.equal((await app.inject({url:'/api/biometrics/self',headers:stranger})).json().state,'none');
    await app.inject({method:'DELETE',url:'/api/biometrics/self',headers:stranger});
    assert.equal((await app.inject({url:'/api/biometrics/self',headers})).json().state,'active');
  }finally{await app.close();}
});
