import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Deck, Slide } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { StudioStore } from '../persistence/storage';

test('an automatically selected literature theme includes a reason and allows a teacher override', async t => {
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 12 });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/decks', payload: {
      topic: 'Қазақ әдебиеті. Абайдың қара сөздері', language: 'kk', provider: 'fixture', review: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const created = response.json<Deck>();
  assert.equal(created.theme, 'editorial');
  assert.deepEqual(created.themeRecommendation, { theme: 'editorial', reason: 'reading' });
  const changed = await app.inject({
    method: 'PATCH', url: '/api/decks/' + created.id,
    payload: { op: { kind: 'deck', theme: 'chalkboard' } },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const url = '/api/decks/' + created.id;
  for (let attempt = 0; attempt < 100; attempt++) {
    const lesson = (await app.inject({ url })).json<Deck>();
    if (lesson.outlineStatus === 'complete') {
      assert.equal(lesson.theme, 'chalkboard');
      return;
    }
    await delay(10);
  }
  assert.fail('The outline did not complete');
});

test('agent-defined plan metadata and neutral designs survive editing, reordering and duplication', async t => {
  const app=createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  const created=await app.inject({method:'POST',url:'/api/decks',payload:{topic:'A disputed measurement',language:'en',provider:'fixture',review:true,slideCount:3}});
  assert.equal(created.statusCode,201,created.body);
  let deck=created.json<Deck>();
  const path='/api/decks/'+deck.id;
  const waitFor=async(condition:(value:Deck)=>boolean)=>{
    const deadline=Date.now()+15000;
    while(!condition(deck) && Date.now()<deadline) {
      await delay(10);
      deck=(await app.inject({url:path})).json<Deck>();
    }
    assert.ok(condition(deck));
  };
  await waitFor(value=>value.outlineStatus==='complete');
  const selected=deck.outline[0].id;
  const purpose='Compare conflicting interpretations and justify a measurement strategy.';
  const section='Can the measurements be trusted?';
  const outline=deck.outline.map(item=>{
    if(item.id!==selected) return item;
    const {role,...content}=item;
    return {...content,purpose,section};
  });
  const edit=async(op:unknown)=>{
    const response=await app.inject({method:'PATCH',url:path,payload:{baseRevision:deck.revision,op}});
    assert.equal(response.statusCode,200,response.body);
    deck=response.json<Deck>();
  };
  await edit({kind:'outline',outline});
  const generated=await app.inject({method:'POST',url:path+'/generate'});
  assert.equal(generated.statusCode,200,generated.body);
  await waitFor(value=>value.phase==='editing');
  await edit({kind:'slide',slideId:selected,baseVersion:deck.slides[0].version,changes:{layout:'stacked',design:{theme:'deck',numbered:true,cards:[{title:'Observe',text:'Compare the readings.'}]}}});
  assert.equal(deck.slides[0].design?.variant,undefined);
  await edit({kind:'reorder',slideIds:deck.slides.map(slide=>slide.id).reverse()});
  const retained=deck.outline.find(item=>item.id===selected)!;
  assert.equal(retained.purpose,purpose);
  assert.equal(retained.section,section);
  assert.equal(retained.role,undefined);
  await edit({kind:'duplicate',slideId:selected});
  assert.equal(deck.outline.at(-1)?.purpose,purpose);
  assert.equal(deck.outline.at(-1)?.section,section);
  assert.equal(deck.outline.at(-1)?.role,undefined);
  assert.equal(deck.slides.at(-1)?.design?.numbered,true);
});

test('library activity reflects saved lesson changes and excludes seeded examples', async (t) => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const endpoint = '/api/library/activity';
  assert.deepEqual((await app.inject({ url: endpoint })).json(), []);
  const created = await app.inject({
    method:'POST', url:'/api/decks',
    payload:{ topic:'Rock cycle', language:'en', review:false, provider:'fixture', template:'blank' },
  });
  assert.equal(created.statusCode,201);
  const lesson = created.json<Deck>();
  const changed = await app.inject({
    method:'PATCH', url:`/api/decks/${lesson.id}`,
    payload:{ op:{kind:'deck',title:'The rock cycle'} },
  });
  assert.equal(changed.statusCode,200);
  const rows = (await app.inject({ url:endpoint })).json<{ created:number; edited:number }[]>();
  assert.equal(rows.reduce((total,row)=>total+row.created,0),1);
  assert.equal(rows.reduce((total,row)=>total+row.edited,0),1);
});

test('library revision dates use the viewer time zone', () => {
  const store = new StudioStore(':memory:');
  try {
    store.saveRevision({id:'local-day',revision:0,updatedAt:'2026-11-22T20:00:00.000Z'},'Blank lesson');
    assert.equal(store.libraryActivity('2026-11-22','Asia/Almaty')[0].day,'2026-11-23');
    assert.equal(store.libraryActivity('2026-11-22','UTC')[0].day,'2026-11-22');
  } finally {
    store.db.close();
  }
});

test('edit and replay while generating; cancel, retry and reject stale changes', async (t) => {
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 42 });
  t.after(() => app.close());
  const list = (await app.inject({ url: '/api/decks' })).json<Deck[]>();
  assert.deepEqual(
    list.map((d) => d.language),
    ['kk', 'ru', 'en'],
  );
  const source = {
    name: 'lesson.txt',
    text: '  🌱 Two groups measured 12 millilitres.\nThe second measurement was verified.',
  };
  const { id } = (
    await app.inject({
      method: 'POST',
      url: '/api/decks',
      payload: { topic: 'A garden', provider: 'fixture', language: 'en', review: false, source },
    })
  ).json<Deck>();
  const url = '/api/decks/' + id;
  async function deck() {
    return (await app.inject({ url })).json<Deck>();
  }
  async function until(test: (d: Deck) => boolean) {
    const end = Date.now() + 6000;
    do {
      const d = await deck();
      if (test(d)) return d;
      await delay(6);
    } while (Date.now() < end);
    throw Error('timed out waiting for lesson');
  }
  const ready = await until(
    (d) => d.phase === 'generating' && d.slides.some((s) => s.status === 'ready'),
  );
  const first = ready.slides[0];
  assert.ok(first.evidence?.every((e) => [...source.text].slice(e.start, e.end).join('') === e.excerpt));
  const edit = {
    operationId: 'manual-1',
    op: {
      kind: 'slide',
      slideId: first.id,
      baseVersion: first.version,
      changes: { title: 'My lesson title' },
    },
  };
  assert.equal((await app.inject({ method: 'PATCH', url, payload: edit })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url, payload: edit })).statusCode, 200);
  assert.equal(
    (await app.inject({ method: 'PATCH', url, payload: { ...edit, operationId: 'manual-2' } }))
      .statusCode,
    409,
  );
  const cancelled = (await app.inject({ method: 'POST', url: url + '/cancel' })).json<Deck>();
  const target = cancelled.slides.find((s) => s.status === 'cancelled')!;
  assert.ok(target);
  assert.equal(
    (await app.inject({ method: 'POST', url: url + '/retry', payload: { slideId: target.id } }))
      .statusCode,
    200,
  );
  const restored = await until(
    (d) => d.phase === 'editing' && d.slides.find((s) => s.id === target.id)?.status === 'ready',
  );
  assert.equal(restored.slides[0].title, 'My lesson title');
  assert.ok(restored.slides.some((s) => s.status === 'cancelled'));
  const proposal = (
    await app.inject({
      method: 'POST',
      url: url + '/proposals',
      payload: { slideId: first.id, instruction: 'shorter' },
    })
  ).json();
  let s = restored.slides[0];
  await app.inject({
    method: 'PATCH',
    url,
    payload: {
      op: { kind: 'slide', slideId: s.id, baseVersion: s.version, changes: { notes: "Teacher's note" } },
    },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: url + '/proposals/' + proposal.id,
        payload: { action: 'apply' },
      })
    ).statusCode,
    409,
  );
  const p = (
    await app.inject({
      method: 'POST',
      url: url + '/proposals',
      payload: { slideId: first.id, instruction: 'shorter' },
    })
  ).json();
  const applied = (
    await app.inject({ method: 'POST', url: url + '/proposals/' + p.id, payload: { action: 'apply' } })
  ).json<Deck>();
  assert.equal(applied.slides[0].notes, "Teacher's note");
  assert.notEqual(applied.slides[0].body, s.body);
  const port = await app.listen({ port: 0, host: '127.0.0.1' });
  const aborter = new AbortController();
  try {
    const res = await fetch(port + url + '/events?after=1', { signal: aborter.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let log = '';
    while (!log.includes('RUN_FINISHED')) {
      const bytes = await reader.read();
      if (bytes.done) break;
      log += decoder.decode(bytes.value);
    }
    const events = log
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    assert.ok(events.length > 1);
    assert.equal(events[0].seq, 2);
    assert.ok(events.slice(1).every((e, i) => e.seq === events[i].seq + 1));
    assert.ok(events.some((e) => e.ag?.type === 'RUN_FINISHED'));
    await reader.cancel();
  } finally {
    aborter.abort();
  }
});

test('snapshots, structured media, restore, receipts and restart persist', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-db-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { dbPath: join(dir, 'data.sqlite'), fixtureDelay: 10 };
  let app = createStudioServer(options);
  const url = '/api/decks/schoolyard-en';
  const original = (await app.inject({ url })).json<Deck>();
  const chartSlide = original.slides.find((s: Slide) => s.chart)!;
  const chart = structuredClone(chartSlide.chart!);
  chart.series[0].values[0] = 97;
  const edit = {
    operationId: 'chart-data',
    op: { kind: 'slide', slideId: chartSlide.id, baseVersion: chartSlide.version, changes: { chart } },
  };
  assert.equal((await app.inject({ method: 'PATCH', url, payload: edit })).statusCode, 200);
  await app.close();
  app = createStudioServer(options);
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'PATCH', url, payload: edit })).statusCode, 200);
  const revisions = (await app.inject({ url: url + '/revisions' })).json();
  assert.equal(revisions.length, 2);
  assert.equal(
    revisions[0].deck.slides.find((s: Slide) => s.id === chartSlide.id).chart.series[0].values[0],
    97,
  );
  const previous = (
    await app.inject({ method: 'POST', url: url + '/revisions/0/restore', payload: { baseRevision: 1 } })
  ).json<Deck>();
  assert.equal(previous.slides.find((s) => s.id === chartSlide.id)!.chart!.series[0].values[0], 24);
  assert.equal(previous.revision, 2);
});

test('sources stay local and empty edits are rejected', async (t) => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/decks',
        payload: {
          topic: 'Sources',
          provider: 'alem',
          language: 'en',
          review: true,
          source: { name: 'example', text: 'private' },
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/decks/schoolyard-en',
        payload: { op: { kind: 'slide', slideId: 's01', baseVersion: 1, changes: {} } },
      })
    ).statusCode,
    400,
  );
});

test('a blank lesson opens immediately and schoolyard generation keeps matching language and source', async (t) => {
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 3 });
  t.after(() => app.close());
  const blank = (
    await app.inject({
      url: '/api/decks',
      method: 'POST',
      payload: {
        topic: 'Empty lesson',
        language: 'ru',
        provider: 'fixture',
        review: true,
        template: 'blank',
      },
    })
  ).json<Deck>();
  assert.equal(blank.phase, 'editing');
  assert.equal(blank.slides.length, 1);
  assert.equal(blank.slides[0].status, 'ready');
  const sample = (await app.inject({ url: '/api/decks/schoolyard-ru' })).json<Deck>();
  const d = (
    await app.inject({
      url: '/api/decks',
      method: 'POST',
      payload: {
        topic: 'Занятие',
        language: 'ru',
        provider: 'fixture',
        review: false,
        source: sample.source,
        answers: { duration: '45', image: 'none' },
      },
    })
  ).json<Deck>();
  const deadline = Date.now() + 6000;
  let done = d;
  while (done.phase !== 'editing' && Date.now() < deadline) {
    await delay(10);
    done = (await app.inject({ url: '/api/decks/' + d.id })).json<Deck>();
  }
  assert.equal(done.slides.length, 10);
  assert.ok(done.slides.every((s) => !s.image && s.status === 'ready'));
  assert.ok(done.slides.some((s) => s.chart));
  assert.ok(done.slides.some((s) => s.table));
  assert.ok(
    done.slides
      .flatMap((s) => s.evidence ?? [])
      .every(
        (e) =>
          e.id.startsWith('ru.') && [...done.source!.text].slice(e.start, e.end).join('') === e.excerpt,
      ),
  );
});

test('a reopened database retains completed edits and exposes interrupted generation for retry', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-interrupted-'));
  const options = { dbPath: join(dir, 'data.sqlite'), fixtureDelay: 60 };
  let app = createStudioServer(options);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const capabilities = await app.inject({ url: '/api/capabilities' });
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  const input = { topic: 'Soil samples', provider: 'fixture', language: 'en', review: false };
  const deck = (await app.inject({ method: 'POST', url: '/api/decks', payload: input })).json<Deck>();
  const url = '/api/decks/' + deck.id;
  async function waitFor(check: (value: Deck) => boolean) {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      const d = (await app.inject({ url })).json<Deck>();
      if (check(d)) return d;
      await delay(6);
    }
    throw Error('Timed out waiting for persisted fixture');
  }
  const first = (await waitFor((d) => d.slides.some((s) => s.status === 'ready'))).slides[0];
  await app.inject({
    method: 'PATCH',
    url,
    payload: {
      operationId: 'persisted-note',
      op: {
        kind: 'slide',
        slideId: first.id,
        baseVersion: first.version,
        changes: { notes: 'Keep my teaching note.' },
      },
    },
  });
  await app.close();
  app = createStudioServer(options);
  const latest = (await app.inject({ url })).json<Deck>();
  const target = latest.slides.find((s) => s.status === 'failed');
  assert.ok(target, 'Interrupted slots must be actionable after restart');
  assert.equal(latest.phase, 'editing');
  await app.inject({ method: 'POST', url: url + '/retry', payload: { slideId: target.id } });
  const recovered = await waitFor((d) =>
    d.slides.some((s) => s.id === target.id && s.status === 'ready'),
  );
  assert.equal(recovered.slides[0].notes, 'Keep my teaching note.');
});

test('outline status survives migration and retry retains the teacher’s partial outline', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-outline-'));
  const options = { dbPath: join(dir, 'data.sqlite'), fixtureDelay: 90 };
  let app = createStudioServer(options);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const input = { topic: 'Changes of state', provider: 'fixture', language: 'en', review: true };
  const deck = (await app.inject({ method: 'POST', url: '/api/decks', payload: input })).json<Deck>();
  const url = '/api/decks/' + deck.id;
  const post = (suffix: string) => app.inject({ method: 'POST', url: url + suffix });
  const read = async () => (await app.inject({ url })).json<Deck>();
  const waitFor = async (condition: (d: Deck) => boolean) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await read();
      if (condition(current)) return current;
      await delay(5);
    }
    throw Error('Timed out waiting for outline');
  };
  assert.equal(deck.outlineStatus, 'generating');
  assert.equal((await post('/outline/retry')).statusCode, 409);
  await waitFor((d) => d.outline.length > 0);
  const stopped = (await post('/cancel')).json<Deck>();
  assert.equal(stopped.outlineStatus, 'failed');
  const partial = stopped.outline.map((item) => ({ ...item, title: 'Teacher: ' + item.title }));
  await app.inject({ method: 'PATCH', url, payload: { op: { kind: 'outline', outline: partial } } });
  async function reopenAsOldDatabase() {
    await app.close();
    const store = new StudioStore(options.dbPath);
    store.db.exec(`
      UPDATE decks SET data=json_remove(data, '$.outlineStatus');
      UPDATE revisions SET data=json_remove(data, '$.outlineStatus');
    `);
    store.db.close();
    app = createStudioServer(options);
  }
  await reopenAsOldDatabase();
  assert.equal((await read()).outlineStatus, 'failed');
  assert.equal((await post('/outline/retry')).json<Deck>().outlineStatus, 'generating');
  const complete = await waitFor((d) => d.outlineStatus === 'complete');
  assert.deepEqual(complete.outline.slice(0, partial.length), partial);
  assert.equal(complete.outline.length, 7);
  assert.equal(complete.phase, 'outline');
  await reopenAsOldDatabase();
  assert.equal((await read()).outlineStatus, 'complete');
  assert.equal((await post('/outline/retry')).statusCode, 409);
  const restored = (await post('/revisions/0/restore')).json<Deck>();
  assert.equal(restored.outlineStatus, 'failed');
  assert.deepEqual(restored.outline, []);
});
