import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import sharp from 'sharp';
import { createStudioServer } from '../app';

function setEnv(t: TestContext, values: Record<string, string>) {
  const previous = Object.keys(values).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const binary = { 'content-type': 'application/octet-stream' };

function audio() {
  const bytes = Buffer.alloc(44 + 3200);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

function scan() {
  const drawing = (commands: string) => `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R >>',
    drawing('0 g 20 20 110 60 re f'),
    drawing('0 g 40 50 100 70 re f'),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('transcription uses each language model and credential through authenticated, bounded uploads', async t => {
  const secret = 'test-gateway-secret-for-media-123456';
  setEnv(t, { STUDIO_AUTH_MODE: 'gateway', STUDIO_GATEWAY_SECRET: secret,
    STUDIO_KZ_PROVIDER_ORIGINS: '', ALEM_STT_API_KEY: 'test-general', ALEM_STT_KK_API_KEY: 'test-kazakh' });
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const identity = {'x-studio-user': 'teacher', 'x-studio-org': 'school', 'x-studio-gateway': secret};
  const calls: { key: string | null; model: ReturnType<FormData['get']>; language: ReturnType<FormData['get']> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://llm.alem.ai/v1/audio/transcriptions');
    assert.equal(request.redirect, 'error');
    assert.ok(request.body instanceof FormData);
    const file = request.body.get('file');
    assert.ok(file instanceof Blob);
    assert.equal(file.type, 'audio/wav');
    assert.equal(Buffer.from(await file.arrayBuffer()).subarray(8, 12).toString(), 'WAVE');
    calls.push({ key: new Headers(request.headers).get('authorization'), model: request.body.get('model'), language: request.body.get('language') });
    return Response.json({ text: '  Жарық пен көлеңке.  ' });
  });
  const post = (language: string, payload = audio(), headers = { ...identity, ...binary }) =>
    app.inject({ method: 'POST', url: `/api/media/transcriptions/${language}?format=wav`, headers, payload });
  assert.equal((await post('kk', audio(), {...identity, ...binary, 'x-studio-gateway': ''})).statusCode, 401);
  assert.equal((await post('kk')).statusCode, 503);
  assert.equal(calls.length, 0);
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://llm.alem.ai';
  assert.deepEqual((await app.inject({ url: '/api/media/capabilities', headers: identity })).json().transcription, ['kk', 'ru', 'en']);
  assert.equal((await post('kk', Buffer.from('invalid'))).statusCode, 422);
  assert.equal((await post('kk')).json().text, 'Жарық пен көлеңке.');
  assert.equal((await post('ru')).statusCode, 200);
  assert.deepEqual(calls, [
    { key: 'Bearer test-kazakh', model: 'speech-to-text-kk', language: null },
    { key: 'Bearer test-general', model: 'speech-to-text', language: 'ru' },
  ]);
});

test('OCR recognizes uploaded images using inline JPEG data and an empty result stays unreadable', async t => {
  setEnv(t, { STUDIO_AUTH_MODE: 'local', ALEM_OCR_API_KEY: 'test-ocr' });
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  let content = '  Мәтін\r\nЖарық  ';
  const provider = t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://llm.alem.ai/v1/chat/completions');
    assert.equal(new Headers(request.headers).get('authorization'), 'Bearer test-ocr');
    assert.equal(request.redirect, 'error');
    const task = JSON.parse(String(request.body));
    assert.equal(task.model, 'deepseek-ocr');
    const image = task.messages[0].content.find((part: { type: string }) => part.type === 'image_url');
    assert.match(image.image_url.url, /^data:image\/jpeg;base64,/u);
    return Response.json({ choices: [{ message: { content } }] });
  });
  const post = (payload: Buffer, approved = true) => app.inject({
    method: 'POST', url: '/api/sources/extract/png' + (approved ? '?ocr=alem' : ''), headers: binary, payload,
  });
  const image = await sharp({ create: { width: 200, height: 120, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await post(image, false)).json().error, 'scan');
  assert.equal((await post(Buffer.from('invalid'))).statusCode, 422);
  assert.equal(provider.mock.callCount(), 0);
  assert.deepEqual((await post(image)).json(), { text: 'Мәтін\nЖарық' });
  content = '';
  assert.equal((await post(image)).statusCode, 422);
});

test('scanned PDF OCR requires explicit approval and preserves page order', async t => {
  setEnv(t, { STUDIO_AUTH_MODE: 'local', ALEM_OCR_API_KEY: 'test-ocr' });
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  let page = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: `Page ${++page}` } }] }));
  const post = (suffix: string) => app.inject({
    method: 'POST', url: '/api/sources/extract/pdf' + suffix, headers: binary, payload: scan(),
  });
  assert.equal((await post('')).json().error, 'scan');
  assert.equal(page, 0);
  const result = await post('?ocr=alem');
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().text, 'Page 1\n\nPage 2');
});
