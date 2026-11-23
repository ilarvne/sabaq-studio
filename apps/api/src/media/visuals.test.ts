import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { illustrationCatalog, imageRequestSchema, resolveSlideIllustration } from './visuals';
import { catalogRoot } from '../runtime-paths';

function chunk(name: string, data: Buffer) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(name, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
function png(width = 1) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 32, 128, 64]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const scene = { prompt: 'A green bean seedling in soil', alt: 'Жасыл өскін топырақтан өсіп тұр.' };
const response = (data: Buffer) =>
  new Response(new Uint8Array(data), { headers: { 'content-type': 'image/png' } });
async function setup(t: TestContext) {
  const mediaRoot = await mkdtemp(join(tmpdir(), 'sabaq-visuals-'));
  const names = ['STUDIO_IMAGE_ENDPOINT', 'STUDIO_IMAGE_API_KEY', 'STUDIO_IMAGE_MODEL','STUDIO_IMAGE_VERIFY_MODEL','STUDIO_AUTH_MODE','STUDIO_OLLAMA_URL','OPENAI_API_KEY','STUDIO_KZ_PROVIDER_ORIGINS'];
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  for (const k of names) delete process.env[k];
  t.after(async () => {
    for (const k of names) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(mediaRoot, { force: true, recursive: true });
  });
  return { mediaRoot, language: 'kk' as const, signal: new AbortController().signal };
}

test('the local catalog has real assets and localized descriptions; empty and unconfigured requests stay offline', async (t) => {
  const ctx = await setup(t);
  const fetcher = t.mock.method(globalThis, 'fetch', async () => {
    throw Error('Unexpected outbound request');
  });
  for (const { id } of illustrationCatalog) {
    const result = await resolveSlideIllustration({ asset: id, alt: 'Ignore this model caption' }, ctx);
    assert.ok(result);
    assert.match(result.alt, /[а-яәіңғүұқөһ]/iu);
    assert.deepEqual(result.provenance, { source: 'catalog', asset: id });
    assert.equal(result.src, '/assets/' + id + '.webp');
    assert.equal((await readFile(join(catalogRoot, basename(result.src)))).toString('ascii', 8, 12), 'WEBP');
  }
  assert.equal(imageRequestSchema.safeParse({ asset: 'https://images.invalid/p.png' }).success, false);
  assert.equal(imageRequestSchema.safeParse({ url: 'https://images.invalid/p.png' }).success, false);
  assert.equal(await resolveSlideIllustration(scene, ctx), undefined);
  process.env.STUDIO_IMAGE_ENDPOINT = 'https://worker.invalid/images/generations';
  assert.equal(await resolveSlideIllustration({ prompt: scene.prompt }, ctx), undefined);
  assert.equal(await resolveSlideIllustration(undefined, ctx), undefined);
  assert.equal(fetcher.mock.callCount(), 0);
  assert.deepEqual(await readdir(ctx.mediaRoot), []);
});

test('a local hash-addressed PNG is validated, persisted and reused, preserving the current slide caption', async (t) => {
  const ctx = await setup(t);
  const bytes = png();
  process.env.STUDIO_IMAGE_ENDPOINT = 'http://127.0.0.1:8000/v1/images/generations';
  process.env.STUDIO_IMAGE_MODEL = 'local-illustrator';
  process.env.STUDIO_IMAGE_API_KEY = 'test-secret';
  process.env.OPENAI_API_KEY = 'openai-test-secret';
  const fetcher = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(String(url), process.env.STUDIO_IMAGE_ENDPOINT);
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-secret');
    const request = JSON.parse(String(init.body));
    assert.equal(request.model, 'local-illustrator');
    assert.equal(request.response_format, 'b64_json');
    assert.ok(request.prompt.endsWith(scene.prompt));
    assert.ok(!request.prompt.includes(scene.alt));
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
  });
  const expected = createHash('sha256').update(bytes).digest('hex') + '.png';
  const resolved = await resolveSlideIllustration(scene, ctx);
  assert.deepEqual(resolved, {
    src: '/api/media/' + expected,
    alt: scene.alt,
    provenance: { source: 'generated', model: 'local-illustrator' },
  });
  assert.deepEqual(await readFile(join(ctx.mediaRoot, expected)), bytes);
  const second = await resolveSlideIllustration({ ...scene, alt: 'A different caption' }, ctx);
  assert.equal(second?.src, resolved.src);
  assert.equal(second?.alt, 'A different caption');
  assert.equal(fetcher.mock.callCount(), 1);
  await rm(join(ctx.mediaRoot, expected));
  assert.equal((await resolveSlideIllustration(scene, ctx))?.src, resolved.src);
  assert.equal(fetcher.mock.callCount(), 2);
});

test('OpenAI generates an illustration in workstation mode with its native image request format', async (t) => {
  const ctx = await setup(t);
  process.env.OPENAI_API_KEY = 'openai-test-secret';
  const endpoint = 'https://api.openai.com/v1/images/generations';
  const raster = png();
  const fetcher = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.href, endpoint);
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer openai-test-secret');
    const { prompt, ...settings } = JSON.parse(String(init.body));
    assert.match(prompt, /green bean seedling/);
    assert.deepEqual(settings, { model:'gpt-image-2.6-flare', n:1, size:'1536x864', output_format:'png',quality:'medium' });
    return Response.json({ data:[{ b64_json:raster.toString('base64') }] });
  });
  assert.equal(await resolveSlideIllustration(scene, {...ctx, allowOpenAI:false}), undefined);
  const result = await resolveSlideIllustration(scene, ctx);
  assert.deepEqual(result?.provenance, { source:'generated', model:'gpt-image-2.6-flare' });
  assert.deepEqual(await readFile(join(ctx.mediaRoot, basename(result!.src))), raster);
  process.env.STUDIO_AUTH_MODE = 'gateway';
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://api.openai.com,https://eu.api.openai.com';
  process.env.STUDIO_IMAGE_ENDPOINT = endpoint;
  assert.equal(await resolveSlideIllustration(scene, ctx), undefined);
  process.env.STUDIO_IMAGE_ENDPOINT = 'https://eu.api.openai.com/v1/images/generations';
  assert.equal(await resolveSlideIllustration(scene, ctx), undefined);
  assert.equal(fetcher.mock.callCount(), 1);
});

test('HTML, URLs, invalid PNG bytes, invalid dimensions and excessive responses are rejected before publication', async (t) => {
  const ctx = await setup(t);
  process.env.STUDIO_IMAGE_ENDPOINT = 'http://127.0.0.1:8000/images';
  const bytes = png();
  const truncated = bytes.subarray(0, bytes.length - 11);
  const responses = [
    new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    response(Buffer.from('this is not a png')),
    response(truncated),
    response(png(10000)),
    response(png(2)), // one RGB pixel claimed as two
    Response.json({ data: [{ url: 'https://example.invalid/remote.png' }] }),
    Response.json({ data: [{ b64_json: 'XX-invalid' }] }),
    new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) },
    }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'image/png' } },
    ),
  ];
  const fetcher = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(String(url), process.env.STUDIO_IMAGE_ENDPOINT);
    return responses.shift()!;
  });
  const initialCount = responses.length;
  for (let i = 0; i < initialCount; i++) assert.equal(await resolveSlideIllustration(scene, ctx), undefined);
  assert.equal(fetcher.mock.callCount(), initialCount);
  assert.deepEqual(await readdir(ctx.mediaRoot), []);
});

test('concurrent slides share work while cancellation removes only its own subscription', async (t) => {
  const ctx = await setup(t);
  process.env.STUDIO_IMAGE_ENDPOINT = 'http://127.0.0.1:8000/images';
  const first = new AbortController();
  let began!: () => void;
  let finish!: (value: Response) => void;
  let workerSignal!: AbortSignal;
  const started = new Promise<void>((r) => {
    began = r;
  });
  const fetcher = t.mock.method(globalThis, 'fetch', (_url: URL, init: RequestInit) => {
    workerSignal = init.signal!;
    began();
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const cancelled = resolveSlideIllustration(scene, { ...ctx, signal: first.signal });
  const stillNeeded = resolveSlideIllustration({ ...scene, alt: 'Second caption' }, ctx);
  await started;
  const check = assert.rejects(cancelled, { name: 'AbortError' });
  first.abort();
  await check;
  assert.equal(workerSignal.aborted, false);
  finish(response(png()));
  const result = await stillNeeded;
  assert.ok(result);
  assert.equal(result.alt, 'Second caption');
  assert.deepEqual(await readFile(join(ctx.mediaRoot, basename(result.src))), png());
  assert.equal(fetcher.mock.callCount(), 1);
});

test('an entirely cancelled request leaves no published files and can be retried', async (t) => {
  const ctx = await setup(t);
  process.env.STUDIO_IMAGE_ENDPOINT = 'http://127.0.0.1:8000/images';
  const stop = new AbortController();
  let started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    if (++attempts > 1) return response(png());
    started();
    return new Promise<Response>((_, reject) =>
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
    );
  });
  const cancelled = resolveSlideIllustration(scene, { ...ctx, signal: stop.signal });
  await began;
  const check = assert.rejects(cancelled, { name: 'AbortError' });
  stop.abort();
  await check;
  assert.deepEqual(await readdir(ctx.mediaRoot), []);
  assert.ok(await resolveSlideIllustration(scene, ctx));
  assert.equal(attempts, 2);
});

test('gateway image generation checks cached and new pixels against the scene with an independent local vision model',async t=>{
  const ctx=await setup(t);
  const request={...scene,place:'Turkistan',period:'15th century'};
  const relevant={...ctx,topic:'Plants of the Silk Road'};
  process.env.STUDIO_IMAGE_ENDPOINT='http://127.0.0.1:8000/images';
  const bytes=png();
  let generated=0, reviewed=0, local=true, vision=true;
  let judgment='pass';
  const modelName='classroom-vision:latest';
  const fetcher=t.mock.method(globalThis,'fetch',async (url:URL,init:RequestInit)=>{
    if (url.href===process.env.STUDIO_IMAGE_ENDPOINT) {
      generated++;
      const {prompt}=JSON.parse(String(init.body));
      for (const value of [request.place,request.period,relevant.topic,'recognizable faces','lettering']) assert.ok(prompt.includes(value));
      return response(bytes);
    }
    assert.equal(url.origin,'http://127.0.0.1:11434');
    if (url.pathname==='/api/tags') return Response.json({models:[{name:modelName,digest:'installed-model-digest',details:{format:'gguf'},...(!local && {remote_host:'cloud.example'})}]});
    if (url.pathname==='/api/show') return Response.json({capabilities:vision?['completion','vision']:['completion']});
    assert.equal(url.pathname,'/api/chat');
    assert.equal(init.redirect,'error');
    const {messages,model}=JSON.parse(String(init.body));
    assert.equal(model,modelName);
    assert.equal(messages[1].images[0],bytes.toString('base64'));
    assert.deepEqual(JSON.parse(messages[1].content),{scene:scene.prompt,topic:relevant.topic,place:request.place,period:request.period});
    reviewed++;
    const content=JSON.stringify({subject:'pass',place:'pass',period:judgment,noLettering:'pass',noRecognizableFaces:'pass'});
    return Response.json({model:modelName,done:true,message:{content}});
  });
  // A private development asset can already be present when the same installation enables the gateway.
  assert.ok(await resolveSlideIllustration(request,relevant));
  process.env.STUDIO_AUTH_MODE='gateway';
  assert.equal(await resolveSlideIllustration(request,relevant),undefined);
  assert.equal(fetcher.mock.callCount(),1);
  process.env.STUDIO_IMAGE_VERIFY_MODEL='classroom-vision';
  const accepted=await resolveSlideIllustration(request,relevant);
  assert.equal(generated,1);
  assert.equal(reviewed,1);
  assert.ok(accepted?.provenance?.source==='generated');
  assert.equal(accepted.provenance.review?.imageSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(accepted.provenance.review?.modelDigest,'installed-model-digest');
  judgment='uncertain';
  assert.equal(await resolveSlideIllustration(request,relevant),undefined);
  // A rejected fresh raster never creates a media file or request index.
  const fresh={...relevant,mediaRoot:join(ctx.mediaRoot,'fresh')};
  assert.equal(await resolveSlideIllustration(request,fresh),undefined);
  assert.equal(generated,2);
  await assert.rejects(readdir(fresh.mediaRoot),{code:'ENOENT'});
  local=false;
  assert.equal(await resolveSlideIllustration(request,relevant),undefined);
  local=true;vision=false;
  assert.equal(await resolveSlideIllustration(request,relevant),undefined);
  assert.equal(reviewed,3);
});
