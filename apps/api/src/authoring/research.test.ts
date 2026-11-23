import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStudioServer } from '../app';
import type { Deck } from '@sabaq/lesson/types';

const query = 'Табиғаттағы су айналымы';
test('research mode checkpoints public evidence and uses only approved queries at the search boundary', async t => {
  const old = { provider: process.env.STUDIO_RESEARCH_PROVIDER, key: process.env.EXA_API_KEY, topics: process.env.STUDIO_RESEARCH_TOPICS };
  process.env.STUDIO_RESEARCH_PROVIDER = 'exa';
  process.env.EXA_API_KEY = 'test-only';
  process.env.STUDIO_RESEARCH_TOPICS = query;
  t.after(() => {
    for (const [key, value] of Object.entries({ STUDIO_RESEARCH_PROVIDER: old.provider, EXA_API_KEY: old.key, STUDIO_RESEARCH_TOPICS: old.topics })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const app = createStudioServer({ dbPath: ':memory:', fixtureDelay: 2 });
  t.after(() => app.close());
  const sent: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://api.exa.ai/search');
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ results: [
      { title: 'Unsafe link', url: 'javascript:void(0)', highlights: ['This source contains an unusable reference.'] },
      { title: 'Су айналымы', url: 'https://example.org/water', highlights: ['💧 Су буланып, қайтадан жер бетіне жауын түрінде оралады.'] },
      { title: 'Duplicate', url: 'https://example.org/water#x', highlights: ['Another passage pointing to the same resource.'] },
    ] });
  });
  const create = (more: object) => app.inject({ method: 'POST', url: '/api/decks', payload: { topic: 'Private teacher notes', language: 'kk', provider: 'fixture', review: false, ...more } });
  assert.equal((await create({ researchQuery: 'private query' })).statusCode, 400);
  assert.equal((await create({ researchQuery: query, source: { name: 'private', text: 'private' } })).statusCode, 400);
  assert.equal(sent.length, 0);
  let deck = (await create({ researchQuery: query })).json<Deck>();
  for (let i = 0; i < 150 && deck.phase !== 'editing'; i++) {
    await sleep(10);
    deck = (await app.inject({ url: '/api/decks/' + deck.id })).json<Deck>();
  }
  assert.equal(deck.phase, 'editing');
  assert.deepEqual(sent, [{ query, numResults: 6, contents: { highlights: true } }]);
  assert.equal(deck.slides.length, 3);
  assert.equal(deck.research?.sources?.length, 1);
  const slide = deck.slides[1], evidence = slide.evidence![0];
  assert.equal([...deck.source!.text].slice(evidence.start, evidence.end).join(''), evidence.excerpt);
  assert.ok(slide.notes.includes(evidence.url!));
});
