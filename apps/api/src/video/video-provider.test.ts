import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { elevenLabsVoice, synthesizeElevenLabs } from './elevenlabs';
import { videoProviderEndpoint } from './video-provider';

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.entries(values).map(([key, value]) => {
    const original = process.env[key];
    process.env[key] = value;
    return [key, original] as const;
  });
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('a shared gateway accepts only a Kazakhstan video worker', t => {
  environment(t, {
    STUDIO_AUTH_MODE: 'gateway',
    STUDIO_VIDEO_REGION: 'global',
    STUDIO_VIDEO_PROVIDER_ORIGINS: 'https://global.example',
    STUDIO_KZ_PROVIDER_ORIGINS: 'https://regional.example',
  });

  assert.equal(videoProviderEndpoint('https://global.example'), undefined);
  assert.equal(videoProviderEndpoint('http://127.0.0.1:9700'), undefined);

  process.env.STUDIO_VIDEO_REGION = 'KZ';
  assert.equal(videoProviderEndpoint('https://regional.example/'), 'https://regional.example');
  assert.equal(videoProviderEndpoint('https://global.example'), undefined);
});

test('shared gateways disable the bundled ElevenLabs client and block its outbound requests', async t => {
  environment(t, { STUDIO_AUTH_MODE: 'gateway', ELEVENLABS_API_KEY: 'synthetic-test-key' });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));

  assert.equal(elevenLabsVoice(), undefined);
  await assert.rejects(synthesizeElevenLabs({
    key: 'synthetic-test-key', voiceId: 'JBFqnCBsd6RMkjVDRZzb', text: 'Sample notes', language: 'en',
  }), /workstation mode/i);
  assert.equal(fetch.mock.callCount(), 0);
});
