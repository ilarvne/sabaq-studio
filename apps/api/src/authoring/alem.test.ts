import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOutline, generateSlide } from './alem';

test('Alem adapter uses the configured server credential and validates returned lesson JSON', async context => {
  const previous = process.env.ALEM_API_KEY;
  process.env.ALEM_API_KEY = 'fixture-key';
  context.after(() => {
    if (previous === undefined) delete process.env.ALEM_API_KEY;
    else process.env.ALEM_API_KEY = previous;
  });

  const slide = { title:'Өлшеу', summary:'Ыдыстағы суды өлшеу', purpose:'Көлемнің қалай өлшенетінін көрсету', layout:'centered' } as const;
  context.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://llm.alem.ai/v1/chat/completions');
    assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer fixture-key');
    const body = JSON.parse(String(request.body));
    assert.equal(body.model, 'alemllm');
    assert.equal(body.stream, false);
    assert.equal(JSON.parse(body.messages[1].content).topic, 'Су көлемі');
    assert.equal(request.redirect, 'error');
    const input = JSON.parse(body.messages[1].content);
    assert.ok(!('agenda' in input) && !('role' in input));
    return Response.json({ choices: [{ message: { content: JSON.stringify({slides:[slide]}) } }] });
  });
  assert.deepEqual(await generateOutline('Су көлемі','kk',1), {items:[slide],theme:undefined});
  const item = { id:'s01', title:'Өлшеу', summary:'Ыдыстағы суды өлшеу', layout:'cover' } as const;
  await assert.rejects(
    generateSlide({topic:'Су көлемі',language:'kk',outline:[item]},item,0,new AbortController().signal),
    /did not match the requested format/,
  );
});
