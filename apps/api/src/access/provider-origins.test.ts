import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedProviderEndpoint } from './provider-origins';
import { hasAlem } from '../authoring/alem';

test('a shared gateway requires an approved origin before sending lesson data', t => {
  const settings = ['STUDIO_AUTH_MODE', 'STUDIO_KZ_PROVIDER_ORIGINS', 'ALEM_API_KEY'];
  const previous = settings.map(key => process.env[key]);
  t.after(() => settings.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  process.env.STUDIO_AUTH_MODE = 'gateway';
  process.env.ALEM_API_KEY = 'test';
  delete process.env.STUDIO_KZ_PROVIDER_ORIGINS;
  assert.equal(hasAlem(), false);
  assert.equal(allowedProviderEndpoint('http://127.0.0.1:8000/inference'), true);
  process.env.STUDIO_KZ_PROVIDER_ORIGINS = 'https://llm.alem.ai, https://images.school.invalid';
  assert.equal(hasAlem(), true);
  assert.equal(allowedProviderEndpoint('https://images.school.invalid/worker'), true);
  assert.equal(allowedProviderEndpoint('http://images.school.invalid/worker'), false);
  assert.equal(allowedProviderEndpoint('https://images.school.invalid.example/worker'), false);
});
