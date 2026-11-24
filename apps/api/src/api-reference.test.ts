import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioServer } from './app';

test('OpenAPI describes the registered API, including the export job, stream replay and public classroom access', async t => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/openapi.json' });
  assert.equal(response.statusCode, 200, response.body);
  const reference = response.json();
  assert.equal(reference.openapi, '3.1.0');
  assert.ok(Object.keys(reference.paths).length >= 45);
  assert.deepEqual(reference.paths['/api/decks/{id}/exports'].post.requestBody.content['application/json'].schema.required,
    ['revision', 'format']);
  assert.ok(reference.paths['/api/decks/{id}/exports'].post.responses['202']);
  const events = reference.paths['/api/decks/{id}/events'].get;
  assert.ok(events.parameters.some((parameter: { name: string }) => parameter.name === 'Last-Event-ID'));
  assert.ok(events.responses['200'].content['text/event-stream']);
  assert.equal(reference.paths['/api/classroom-polls/{code}'].post['x-studio-access'], 'Public classroom code');
  const biometrics = reference.paths['/api/biometrics/self'];
  assert.equal(biometrics.get['x-studio-access'], 'Signed-in biometric subject');
  assert.equal(biometrics.delete['x-studio-access'], 'Signed-in biometric subject');
  assert.match(biometrics.delete.responses['200'].description, /complete/i);
  assert.match(biometrics.delete.responses['202'].description, /pending/i);
  assert.ok(!JSON.stringify(reference).includes('x-studio-gateway'));
});
