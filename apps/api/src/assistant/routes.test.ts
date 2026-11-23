import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';

test('a disconnected browser can recover its ongoing assistant run', { timeout: 5000 }, async t => {
  const environment = {
    STUDIO_ASSISTANT_OLLAMA_MODEL: 'fixture',
    STUDIO_EMBEDDING_MODEL: '',
    STUDIO_MEM0_URL: '',
    STUDIO_OLLAMA_URL: 'http://127.0.0.1:11434',
  };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  let enteredProvider!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>(resolve => { enteredProvider = resolve; });
  let letProviderFinish!: () => void;
  const provider = new Promise<void>(resolve => { letProviderFinish = resolve; });
  const clientFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    if (url.pathname === '/api/tags')
      return Response.json({ models: [{ name: 'fixture:latest', digest: '1', details: { format: 'gguf' } }] });
    assert.equal(url.pathname, '/api/chat');
    enteredProvider(options.signal!);
    await provider;
    const body = 'Pupils made 12 measurements to compare results and recorded them in their notebooks.';
    return Response.json({ message: { content: JSON.stringify({ body }) } });
  });
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(async () => {
    letProviderFinish();
    await app.close();
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const deckPath = origin + '/api/decks/schoolyard-en';
  const path = deckPath + '/assistant';
  const deck = await (await clientFetch(deckPath)).json() as Deck;
  const slide = deck.slides[0];
  const body = 'In order to compare their results, the pupils made 12 measurements and wrote them down in their notebooks.';
  const headers = { 'Content-Type': 'application/json' };
  const edited = await clientFetch(deckPath, {
    method: 'PATCH', headers,
    body: JSON.stringify({ op: { kind: 'slide', slideId: slide.id, baseVersion: slide.version, changes: { body } } }),
  });
  assert.equal(edited.status, 200);

  await new Promise<void>((resolve, reject) => {
    const socket = request(path, { method: 'POST', headers }, reply => {
      if (reply.statusCode !== 200) reject(new Error(`Assistant returned ${reply.statusCode}`));
      reply.once('data', () => reply.destroy());
      reply.once('close', resolve);
    });
    socket.once('error', reject);
    socket.end(JSON.stringify({ clientId: 'detached', locale: 'en', slideId: slide.id, text: 'Shorten this slide.' }));
  });

  const providerSignal = await entered;
  const read = async (): Promise<AssistantSnapshot> => await (await clientFetch(path)).json() as AssistantSnapshot;
  const running = await read();
  assert.equal(running.activeClientId, 'detached');
  assert.equal(running.messages.at(-1)?.status, 'running');
  assert.equal(providerSignal.aborted, false);
  letProviderFinish();
  let recovered = await read();
  for (let attempt = 0; recovered.activeClientId && attempt < 40; attempt++) {
    await delay(25);
    recovered = await read();
  }
  assert.equal(recovered.activeClientId, undefined);
  assert.equal(recovered.messages.at(-1)?.proposal?.status, 'pending');
  const saved = await (await clientFetch(deckPath)).json() as Deck;
  assert.equal(saved.slides[0].body, body);
});
