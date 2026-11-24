import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { StudioAccess } from '../access/access';
import { Studio } from '../lessons/studio';
import { StudioStore } from '../persistence/storage';
import { registerVideo, VideoService } from './video';
import { digestFile, validateVideoReports } from './video-verification';
import type { Deck } from '@sabaq/lesson/types';

test('video validation binds two marks, a trusted active signature, audio and a BMFF hash to the final MP4', () => {
  const success = ['claimSignature.validated','signingCredential.trusted','assertion.bmffHash.match'].map(code => ({ code }));
  const c2pa = { active_manifest: 'signed-manifest', manifests: { 'signed-manifest': {} }, validation_results: { activeManifest: { success, failure: [] } } };
  const tracks = { streams: [{ codec_type: 'video', nb_read_frames: '20' }, { codec_type: 'audio', nb_read_frames: '33' }] };
  const evidence = { sha256: 'x', decodedFrames: 20, visibleLabel: 'ИИ', visibleLabelFrames: 20, watermarkScheme: 'example', watermarkFrames: 20 };
  assert.equal(validateVideoReports(c2pa, tracks, evidence, 'x').frames, 20);
  const tall={streams:[{...tracks.streams[0],width:1080,height:1920},tracks.streams[1]]};
  assert.equal(validateVideoReports(c2pa,tall,evidence,'x',{width:1080,height:1920}).frames,20);
  assert.throws(()=>validateVideoReports(c2pa,tall,evidence,'x',{width:1080,height:1080}),/dimensions/);
  const exportId = '4b7c759f6d324dfc9ac62428c4bc3c25';
  const provenance = { ...c2pa, manifests: { 'signed-manifest': { assertions: [{ label: 'c2pa.actions.v2', data: { actions: [
    { action: 'c2pa.created', digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' },
  ] } }] } } };
  assert.equal(validateVideoReports(provenance, tracks, { ...evidence, watermarkId: exportId }, 'x', undefined, exportId).frames, 20);
  assert.throws(() => validateVideoReports(provenance, tracks, { ...evidence, watermarkId: '1'.repeat(32) }, 'x', undefined, exportId));
  assert.throws(() => validateVideoReports(c2pa, tracks, { ...evidence, watermarkId: exportId }, 'x', undefined, exportId));
  for (const damaged of [{ sha256: 'y' }, { visibleLabel: 'AI' }, { watermarkFrames: 19 }, { decodedFrames: 21 }, { visibleLabelFrames: 0 }])
    assert.throws(() => validateVideoReports(c2pa, tracks, { ...evidence, ...damaged }, 'x'));
  assert.throws(() => validateVideoReports({ ...c2pa, validation_status: [{ code: 'signingCredential.untrusted' }] }, tracks, evidence, 'x'));
  assert.throws(() => validateVideoReports(c2pa, { streams: [tracks.streams[0]] }, evidence, 'x'));
  assert.throws(() => validateVideoReports({ ...c2pa, validation_results: { activeManifest: { success: success.slice(0, 2) } } }, tracks, evidence, 'x'));
});

test('new video revisions reuse unchanged scenes, recover after failed verification, and verify download integrity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sabaq-video-'));
  const store = new StudioStore(':memory:');
  const studio = new Studio(store, 0, directory);
  const config = { url: 'http://127.0.0.1:9700', version: 'test-v1', detector: join(directory, 'detector'), anchors: join(directory, 'roots'),
    c2pa: 'test', avatar: undefined, token: undefined };
  await writeFile(config.detector, 'independent'); await writeFile(config.anchors, 'local roots');
  let scenes = 0, assemblies = 0, verified = false;
  const diagnostics = t.mock.method(console, 'error', () => {});
  const exportIds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, req: RequestInit) => {
    assert.ok(new Headers(req.headers).get('Idempotency-Key'));
    if (url.endsWith('/scenes')) return Response.json({ sceneId: 'scene-' + ++scenes });
    exportIds.push(JSON.parse(String(req.body)).watermarkId);
    assemblies++; return new Response('fake-mp4-' + assemblies, { headers: { 'content-type': 'video/mp4' } });
  });
  const verify = async (file: string) => {
    if (!verified) throw new Error('Missing marks');
    return { sha256: await digestFile(file), frames: 10, watermarkScheme: 'test', manifest: 'test' };
  };
  let videos = new VideoService(studio, { generated: directory, catalog: directory }, directory, config, verify, async () => Buffer.from('test-image'));
  t.after(async () => { await videos.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); });
  const d = studio.create({ topic: 'Video test', template: 'blank', review: true, language: 'en', provider: 'fixture' });
  const deck: Deck = { ...d, revision: 1, slides: [d.slides[0], { ...d.slides[0], id: 'slide-2', title: 'Second' }] };
  store.saveRevision(deck, 'Two slides');
  const options = { language: 'en' as const, captions: true, position: 'none' as const };
  async function waitFor(status: 'failed' | 'ready') {
    for (let i=0;i<250;i++) { const job = videos.state(d.id).job; if (job?.status === status) return job; await delay(5); }
    assert.fail('Timed out awaiting ' + status);
  }
  await videos.start(d.id, 1, options);
  const failed = await waitFor('failed');
  assert.deepEqual(failed.failure, { stage: 'verify' });
  assert.deepEqual(diagnostics.mock.calls[0].arguments, ['Video export failed', { key: failed.key, revision: 1, stage: 'verify' }]);
  await assert.rejects(videos.file(d.id, failed.key));
  assert.equal(scenes, 2);
  await videos.close();
  videos = new VideoService(studio, { generated: directory, catalog: directory }, directory, config, verify, async () => Buffer.from('test-image'));
  verified = true;
  await videos.start(d.id, 1, options);
  const ready = await waitFor('ready');
  assert.equal(ready.failure, undefined);
  assert.equal(scenes, 2);
  assert.equal(await readFile(await videos.file(d.id, ready.key), 'utf8'), 'fake-mp4-2');
  deck.revision++; deck.slides[1].notes = 'Only this scene changes.';
  store.saveRevision(deck, 'New narration');
  await videos.start(d.id, 2, options);
  const edited = await waitFor('ready');
  assert.equal(scenes, 3); assert.equal(assemblies, 3);
  assert.match(exportIds[0], /^[a-f0-9]{32}$/);
  assert.equal(exportIds[0], exportIds[1]);
  assert.notEqual(exportIds[1], exportIds[2]);
  const app = Fastify();
  registerVideo(app, studio, { generated: directory, catalog: directory }, directory, new StudioAccess(store), videos);
  try {
    const url = `/api/decks/${d.id}/video/${edited.key}/file`;
    const download = await app.inject({ url });
    assert.equal(download.statusCode, 200);
    assert.equal(download.body, 'fake-mp4-3');
    assert.match(download.headers['content-disposition'] as string, /^attachment;/);
    assert.equal(download.headers['content-type'], 'video/mp4');
    assert.equal(download.headers['content-length'], '10');
    assert.equal(download.headers['accept-ranges'], 'bytes');
    assert.equal(download.headers['cache-control'], 'private, no-store');

    const inline = url + '?play=1';
    const segment = await app.inject({ url: inline, headers: { range: 'bytes=5-7', 'if-range': download.headers.etag } });
    assert.equal(segment.statusCode, 206);
    assert.equal(segment.body, 'mp4');
    assert.match(segment.headers['content-disposition'] as string, /^inline;/);
    assert.equal(segment.headers['content-length'], '3');
    assert.equal(segment.headers['content-range'], 'bytes 5-7/10');
    for (const range of ['bytes=-3', 'bytes=7-', 'bytes=7-99']) {
      const tail = await app.inject({ url: inline, headers: { range } });
      assert.equal(tail.statusCode, 206);
      assert.equal(tail.body, '4-3');
      assert.equal(tail.headers['content-range'], 'bytes 7-9/10');
    }
    for (const range of ['bytes=10-', 'bytes=6-2', 'bytes=-0', 'bytes=word']) {
      const invalid = await app.inject({ url: inline, headers: { range } });
      assert.equal(invalid.statusCode, 416);
      assert.equal(invalid.headers['content-range'], 'bytes */10');
      assert.equal(invalid.body, '');
    }
    const stale = await app.inject({ url: inline, headers: { range: 'bytes=0-1', 'if-range': '"stale"' } });
    assert.equal(stale.statusCode, 200);
    assert.equal(stale.body, download.body);
    const head = await app.inject({ method: 'HEAD', url: inline, headers: { range: 'bytes=0-1' } });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers['content-length'], '10');
    assert.equal(head.body, '');
  } finally { await app.close(); }
  const saved = await videos.file(d.id, edited.key);
  await writeFile(saved, 'Modified bytes');
  await assert.rejects(videos.file(d.id, edited.key), /integrity/);
  assert.equal(videos.state(d.id).job?.status, 'failed');
});

test('startup resumes an interrupted scene from the saved revision and cancellation removes a queued run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sabaq-video-restart-'));
  const store = new StudioStore(':memory:');
  const studio = new Studio(store, 0, directory);
  const config = { url: 'http://127.0.0.1:9700', version: 'test-v1', detector: join(directory, 'tool'), anchors: join(directory, 'ca'),
    c2pa: 'test', avatar: undefined, token: undefined };
  await writeFile(config.detector, 'local detector'); await writeFile(config.anchors, 'local anchors');
  let calls = 0, reached!: () => void;
  const interrupted = new Promise<void>(resolve => { reached = resolve; });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/assemble')) return new Response('verified-fixture', { headers: { 'Content-Type': 'video/mp4' } });
    calls++;
    if (calls === 2) {
      reached();
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Error('shutdown')), { once: true }));
    }
    return Response.json({ sceneId: 'scene-' + calls });
  });
  const worker = () => new VideoService(studio, { catalog: directory, generated: directory }, directory, config,
    async path => ({ sha256: await digestFile(path), frames: 1, watermarkScheme: 'fixture', manifest: 'fixture' }),
    async () => Buffer.from('slide'));
  let service = worker();
  t.after(async () => { await service.close(); await studio.close(); await rm(directory, { recursive: true, force: true }); });
  const create = () => studio.create({ topic: 'Interrupted', template: 'blank', review: true, language: 'en', provider: 'fixture' });
  const first = create();
  first.revision = 1; first.slides.push({ ...first.slides[0], title: 'Changed', id: 'second' });
  store.saveRevision(first, 'Second slide');
  const other = create();
  const options = { language: 'en' as const, captions: false, position: 'none' as const };
  await service.start(first.id, 1, options);
  await interrupted;
  assert.equal(service.state(first.id).job?.completed, 1);
  assert.equal((await service.start(other.id, 0, options)).job?.status, 'queued');
  assert.equal(service.cancel(other.id).job?.status, 'cancelled');
  await service.close();
  service = worker();
  for (let attempt = 0; service.state(first.id).job?.status !== 'ready' && attempt < 400; attempt++) await delay(5);
  assert.equal(service.state(first.id).job?.status, 'ready');
  assert.equal(calls, 3);
  assert.equal(service.state(other.id).job?.status, 'cancelled');
});

test('portrait paragraph scenes send progressive frame rasters and spoken ranges in order, keeping written notes intact',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'sabaq-reveal-'));
  const store=new StudioStore(':memory:'),studio=new Studio(store,0,directory);
  const config={url:'http://127.0.0.1:9700',version:'frames',detector:join(directory,'detector'),anchors:join(directory,'CA'),c2pa:'c2pa',avatar:undefined,token:undefined};
  await writeFile(config.detector,'detector');await writeFile(config.anchors,'ca');
  const received:{narration:string;frame:{width:number;height:number};imagePng:string;segment:{index:number;count:number}}[]=[];
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    const data=JSON.parse(String(init.body));
    if(url.endsWith('/scenes')){received.push(data);return Response.json({sceneId:'s'+data.segment.index});}
    assert.deepEqual(data.sceneIds,['s0','s1']);assert.deepEqual(data.frame,{width:1080,height:1920});
    return new Response('video',{headers:{'content-type':'video/mp4'}});
  });
  const videos=new VideoService(studio,{generated:directory,catalog:directory},directory,config,
    async(file,policy)=>{assert.deepEqual(policy.expectedSize,{width:1080,height:1920});return {sha256:await digestFile(file),frames:2,watermarkScheme:'w',manifest:'m'};},
    async()=>assert.fail('Legacy renderer should not handle a portrait slide.'),
    async(_deck,_roots,settings,count)=>{assert.equal(settings.aspect,'9:16');assert.equal(count,2);return [Buffer.from('first'),Buffer.from('second')];});
  t.after(async()=>{await videos.close();await studio.close();await rm(directory,{recursive:true,force:true});});
  const d=studio.create({topic:'Measurements',template:'blank',language:'en',provider:'fixture',review:true});
  const notes='Collect 3–5 samples.\nDiscuss the observations.';
  d.revision++;d.slides[0].body='Collect samples.\nDiscuss.';d.slides[0].notes=notes;store.saveRevision(d,'Notes');
  await videos.start(d.id,d.revision,{language:'en',captions:true,position:'none',aspect:'9:16',revealParagraphs:true});
  for(let i=0;i<100 && videos.state(d.id).job?.status!=='ready';i++)await delay(5);
  assert.equal(videos.state(d.id).job?.status,'ready');
  assert.deepEqual(received.map(s=>s.segment),[{index:0,count:2},{index:1,count:2}]);
  assert.deepEqual(received.map(s=>Buffer.from(s.imagePng,'base64').toString()),['first','second']);
  assert.match(received[0].narration,/3 to 5/);assert.equal(received[1].narration,'Discuss the observations.');
  assert.equal(studio.deck(d.id).slides[0].notes,notes);
  d.revision++;d.slides[0].importedPage=true;store.saveRevision(d,'Bitmap');
  await assert.rejects(videos.start(d.id,d.revision,{language:'en',captions:true,position:'none',aspect:'1:1',revealParagraphs:true}),
    /no editable elements for progressive reveals/);
});
