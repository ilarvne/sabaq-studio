import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Deck, Layout } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

test('a reviewed Alem plan drives themed layouts, semantic content and local illustrations', async (t) => {
  const savedKey = process.env.ALEM_API_KEY;
  const savedEndpoint = process.env.STUDIO_IMAGE_ENDPOINT;
  process.env.ALEM_API_KEY = 'test-key';
  delete process.env.STUDIO_IMAGE_ENDPOINT;
  t.after(() => {
    if (savedKey === undefined) delete process.env.ALEM_API_KEY;
    else process.env.ALEM_API_KEY = savedKey;
    if (savedEndpoint !== undefined) process.env.STUDIO_IMAGE_ENDPOINT = savedEndpoint;
  });

  const draftedPurposes: string[] = [];
  const layouts:Layout[] = ['quote','stacked','native-table','image-left','centered','data-chart','split'];
  const sections = ['A question of care','A question of care','Comparing responses','Comparing responses','What the class saw','What the class saw','What the class saw'];
  const plan = layouts.map((layout, i) => ({
    title:`Slide ${i+1}`, summary:`Explore observation ${i+1}`, layout, purpose:`Interpret observation ${i+1}`, section:sections[i],
  }));
  let plans = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://llm.alem.ai/v1/chat/completions');
    const [, { content }] = JSON.parse(String(request.body)).messages;
    const input = JSON.parse(content);
    let output: object;
    if (input.count) {
      assert.ok(!('agenda' in input) && !('structure' in input));
      plans++;
      output = { theme: 'steppe', slides: plan };
    } else {
      assert.ok(!('role' in input));
      draftedPurposes.push(input.purpose);
      const draft = { title: input.outlineTitle, body: input.outlineSummary, notes: 'Ask pupils to explain their answer.' };
      output = {
        ...draft,
        ...(input.slide === 2 && { numbered:true, cards: [{ title:'Notice', text:'Look before you act.' }] }),
        ...(input.slide === 3 && { table: { headers:['Ask','Offer'], rows:[['What would help?','I can carry this.'],['May I join?','Come and sit here.']] } }),
        ...(input.slide === 4 && { illustration:{asset:'kindness-notebooks'} }),
        ...(input.slide === 5 && { answer:'Ask what would be helpful.' }),
        ...(input.slide === 6 && { chart:{categories:['Monday','Tuesday'],series:[{name:'Observations',values:[3,6]}],alt:'Three observations on Monday and six on Tuesday.'} }),
        ...(input.slide === 7 && { diagram:{kind:'process',nodes:['Listen','Offer help','Ask how it went']} }),
      };
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
  });

  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 39 });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/decks',
    payload: { topic: 'Kindness. Our class recorded 3 observations on Monday and 6 on Tuesday.', language: 'en', provider: 'alem', slideCount:7, review: true },
  });
  assert.equal(response.statusCode, 201);
  const url = `/api/decks/${response.json<Deck>().id}`;
  async function until(predicate: (deck: Deck) => boolean) {
    const deadline = Date.now() + 6000;
    for (;;) {
      const deck = (await app.inject({ url })).json<Deck>();
      if (predicate(deck)) return deck;
      assert.ok(Date.now() < deadline, 'the requested deck state was not reached');
      await delay(5);
    }
  }

  const first = await until((deck) => deck.outline.length > 0);
  assert.equal((await app.inject({ method: 'POST', url: url + '/cancel' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: url + '/outline/retry' })).statusCode, 200);
  const outlined = await until((deck) => deck.outlineStatus === 'complete');
  assert.equal(plans, 1);
  assert.equal(outlined.outline[0].id, first.outline[0].id);
  assert.equal(outlined.theme, 'steppe');
  assert.ok(outlined.outline.every(item=>!('role' in item)));
  assert.deepEqual(outlined.outline.map(item=>item.section),sections);
  assert.deepEqual(outlined.outline.map(item=>item.layout),layouts);

  const revised = outlined.outline.map((item, i) => i === 4
    ? { ...item, purpose:'Decide how to help a classmate', section:'Class discussion', summary: 'What would you do?' }
    : item);
  const edited = await app.inject({ method: 'PATCH', url, payload: { op: { kind: 'outline', outline: revised } } });
  assert.equal(edited.statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: url + '/generate' })).statusCode, 200);
  const finished = await until((deck) => deck.phase === 'editing');
  assert.ok(finished.slides.every(({ status }) => status === 'ready'));
  assert.deepEqual(draftedPurposes,revised.map(item=>item.purpose));
  assert.deepEqual(finished.slides.map(slide=>slide.layout),layouts);
  assert.ok(finished.slides.every(slide=>!slide.design?.variant));
  assert.equal(finished.slides[0].design,undefined);
  assert.equal(finished.slides[1].design?.cards?.[0].title,'Notice');
  assert.equal(finished.slides[1].design?.numbered,true);
  assert.equal(finished.slides[2].table?.rows.length,2);
  assert.deepEqual(finished.slides[3].image?.provenance,{ source:'catalog',asset:'kindness-notebooks' });
  assert.ok(finished.slides[3].image?.alt);
  assert.equal(finished.slides[4].answer,'Ask what would be helpful.');
  assert.equal(finished.slides[4].body,'What would you do?');
  assert.deepEqual(finished.slides[5].chart?.series[0].values,[3,6]);
  assert.equal(finished.slides[6].diagram?.kind,'process');
  assert.equal(finished.slides.filter(slide=>slide.image).length,1);
});
