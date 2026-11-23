import { strict as assert } from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { CreateInput, Deck } from '@sabaq/lesson/types';
import { StudioStore } from '../persistence/storage';
import { ApiError } from '../errors';
import { Studio } from '../lessons/studio';

const input: CreateInput = {topic:'Wetland observations',provider:'fixture',language:'en',review:true};

test('automatic slide generation records its run atomically with completed outline', async t => {
  const store = new StudioStore(':memory:');
  const studio = new Studio(store, 1);
  t.after(() => studio.close());
  store.db.exec(`
    CREATE TRIGGER reject_slide_run BEFORE INSERT ON runs
    WHEN json_extract(NEW.data, '$.stage') = 'slides'
    BEGIN SELECT RAISE(ABORT, 'test slide handoff error'); END
  `);

  const lesson = studio.create({ ...input, review: false });
  await until(() => studio.deck(lesson.id).outlineStatus === 'failed' ? true : undefined);
  assert.equal(studio.deck(lesson.id).phase, 'outline');
  assert.equal(studio.deck(lesson.id).slides.length, 0);
  assert.equal(store.events(lesson.id, 0).some(event => event.status === 'completed'), false);

  store.db.exec('DROP TRIGGER reject_slide_run');
  studio.retryOutline(lesson.id);
  const delivered = await until(() => {
    const deck = studio.deck(lesson.id);
    return deck.phase === 'editing' ? deck : undefined;
  });
  assert.ok(delivered.slides.length > 0 && delivered.slides.every(slide => slide.status === 'ready'));
});

async function until<T>(fn:()=> T | undefined) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await sleep(5);
  }
  throw new Error('Timed out waiting for the worker');
}

function threeSlides(id: string): Deck {
  const deck = makeFixtureDeck('en');
  deck.id = id;
  deck.outline = deck.outline.slice(0,3);
  deck.slides = deck.slides.slice(0,3).map(slide=>({...slide,status:'pending'}));
  deck.phase = 'editing';
  return deck;
}

test('starting the third active run rolls back creation for that owner and releases capacity on cancellation', async t=>{
  const store = new StudioStore(':memory:');
  const studio = new Studio(store,600);
  t.after(()=>studio.close());
  const a = {org:'school',subject:'Lina'};
  const one = studio.create(input,a);
  studio.create(input,a);
  const count = studio.list().length;
  assert.throws(()=>studio.create(input,a),error=>error instanceof ApiError && error.status === 429);
  assert.equal(studio.list().length,count);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM deck_owners WHERE org=? AND subject=?').get(a.org,a.subject)?.n,2);
  const independent = studio.create(input,{org:'other-school',subject:'Lina'});
  const colleague = studio.create(input,{org:'school',subject:'Vera'});
  const local = studio.create(input);
  studio.create(input);
  assert.throws(()=>studio.create(input),error=>error instanceof ApiError && error.status === 429);
  const blank = studio.create({...input,template:'blank'},a);
  assert.equal(store.db.prepare('SELECT subject FROM deck_owners WHERE deck_id=?').get(blank.id)?.subject,a.subject);
  studio.cancel(one.id);
  assert.equal(studio.create(input,a).outlineStatus,'generating');
  assert.deepEqual([independent,colleague,local].map(deck=>studio.deck(deck.id).outlineStatus),['generating','generating','generating']);
});

test('temporary errors retry, permanent slide failures do not stop siblings and targeted retry preserves finished steps', async t=>{
  const saved = process.env.ALEM_API_KEY;
  process.env.ALEM_API_KEY = 'test-credential';
  t.after(()=>{if (saved === undefined) delete process.env.ALEM_API_KEY; else process.env.ALEM_API_KEY = saved;});
  let repair = false;
  const calls = [0,0,0];
  t.mock.method(globalThis,'fetch',async (_:unknown,request:RequestInit)=>{
    const task = JSON.parse(JSON.parse(String(request.body)).messages[1].content);
    const index = task.slide - 1;
    calls[index]++;
    if (index === 0 && calls[index] === 1) return new Response(null,{status:503});
    if (index === 1 && !repair) return new Response(null,{status:400});
    return Response.json({choices:[{message:{content:JSON.stringify({title:`Observed ${index + 1}`,body:'The class records results.',notes:'Use the notebook.'})}}]});
  });
  const store = new StudioStore(':memory:');
  const studio = new Studio(store,1);
  t.after(()=>studio.close());
  const deck = threeSlides('partial');
  deck.provider = 'alem';
  store.saveRevision(deck,'Imported lesson');
  studio.generate(deck.id);
  const first = await until(()=>{const d=studio.deck(deck.id); return d.phase === 'editing' ? d : undefined;});
  assert.deepEqual(first.slides.map(s=>s.status),['ready','failed','ready']);
  assert.deepEqual(calls,[2,1,1]);
  const last = store.events(deck.id,0).at(-1)!;
  assert.equal(last.status,'failed');
  const teacher = studio.edit(deck.id,{kind:'slide',slideId:first.slides[0].id,baseVersion:first.slides[0].version,changes:{notes:'My note survives a retried sibling.'}});
  repair = true;
  studio.generate(deck.id,first.slides[1].id);
  const second = await until(()=>{const d=studio.deck(deck.id); return d.phase === 'editing' ? d : undefined;});
  assert.deepEqual(second.slides.map(s=>s.status),['ready','ready','ready']);
  assert.deepEqual(calls,[2,2,1]);
  assert.deepEqual(second.slides[0],teacher.slides[0]);
  assert.deepEqual(second.slides[2],teacher.slides[2]);
  const replay = store.events(deck.id,last.seq);
  assert.equal(replay[0].seq,last.seq+1);
  assert.equal(replay.at(-1)?.status,'completed');
});

test('an abruptly lost SQLite-active run resumes unfinished slides without regenerating accepted work', async t=>{
  const store = new StudioStore(':memory:');
  const id = 'active-on-crash';
  const deck = threeSlides(id);
  deck.phase = 'generating';
  deck.slides[0].status = 'ready';
  deck.slides[0].notes = 'Saved before worker loss.';
  deck.slides[1].status = 'generating';
  store.saveRevision(deck,'Before worker loss');
  store.put('runs','interrupted',{id:'interrupted',deckId:id,active:true,stage:'slides',review:false,count:3});
  const studio = new Studio(store,1);
  t.after(()=>studio.close());
  const resumed = await until(()=>{const d=studio.deck(id);return d.phase === 'editing' ? d : undefined;});
  assert.deepEqual(resumed.slides[0],deck.slides[0]);
  assert.ok(resumed.slides.every(s=>s.status === 'ready'));
  assert.equal(store.events(id,0).filter(event=>event.slideId === deck.slides[0].id).length,0);
  assert.equal(store.get<{active:boolean}>('runs','interrupted')?.active,false);
});

test('cancelling during retry backoff prevents another provider call and leaves adjacent ready slides intact', async t=>{
  const saved = process.env.ALEM_API_KEY;
  process.env.ALEM_API_KEY = 'test-credential';
  t.after(()=>{if (saved === undefined) delete process.env.ALEM_API_KEY; else process.env.ALEM_API_KEY = saved;});
  const fetch = t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:429}));
  const store = new StudioStore(':memory:');
  const studio = new Studio(store,1);
  t.after(()=>studio.close());
  const deck = threeSlides('cancel-at-backoff');
  deck.slides[0].status = 'ready';
  deck.provider = 'alem';
  store.saveRevision(deck,'Imported lesson');
  studio.generate(deck.id);
  await until(()=>fetch.mock.callCount() > 0 || undefined);
  const stopped = studio.cancel(deck.id);
  await sleep(320);
  assert.equal(fetch.mock.callCount(),1);
  assert.deepEqual(studio.deck(deck.id),stopped);
  assert.deepEqual(stopped.slides[0],deck.slides[0]);
  assert.deepEqual(stopped.slides.map(s=>s.status),['ready','cancelled','cancelled']);
});
