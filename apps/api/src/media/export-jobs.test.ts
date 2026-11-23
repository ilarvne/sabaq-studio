import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';
import { createStudioServer } from '../app';

const deck = '/api/decks/schoolyard-kk';
const exportsPath = deck + '/exports';
type ExportReceipt = { id: string; status: string };

async function awaitReady(app: ReturnType<typeof createStudioServer>, id: string) {
  const deadline = Date.now() + 10_000;
  do {
    const response = await app.inject(exportsPath + '/' + id);
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json<ExportReceipt>();
    if (job.status === 'ready') return;
    assert.notEqual(job.status, 'failed', response.body);
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail('Export did not finish.');
}

test('the export queue deduplicates a revision and downloads that revision after edit and restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sabaq-exports-'));
  const dbPath = join(directory, 'studio.sqlite');
  let app = createStudioServer({ dbPath });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

  const request = { method: 'POST' as const, url: exportsPath, payload: { format: 'pptx', revision: 0 } };
  const [first, second] = await Promise.all([app.inject(request), app.inject(request)]);
  assert.equal(first.statusCode, 202, first.body);
  const { id } = first.json<ExportReceipt>();
  assert.equal(second.json<ExportReceipt>().id, id);
  const original = (await app.inject(deck)).json();
  const edit = await app.inject({
    method: 'PATCH', url: deck,
    payload: { op: { kind: 'slide', slideId: original.slides[0].id, baseVersion: original.slides[0].version,
      changes: { title: 'Edited after export started' } } },
  });
  assert.equal(edit.statusCode, 200, edit.body);
  await awaitReady(app, id);
  const fileUrl = exportsPath + '/' + id + '/file';
  const downloaded = await app.inject(fileUrl);
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.match(String(downloaded.headers['content-disposition']), /filename\*=UTF-8''/);
  const slide = await (await JSZip.loadAsync(downloaded.rawPayload)).file('ppt/slides/slide1.xml')!.async('string');
  assert.ok(slide.includes(original.slides[0].title));
  assert.ok(!slide.includes('Edited after export started'));
  await app.close();

  app = createStudioServer({ dbPath });
  const stored = await app.inject(fileUrl);
  assert.equal(stored.statusCode, 200, stored.body);
  assert.deepEqual(stored.rawPayload, downloaded.rawPayload);
  assert.equal((await app.inject('/api/decks/schoolyard-en/exports/' + id + '/file')).statusCode, 404);
});

test('a new export worker recovers a job claimed by an interrupted process', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sabaq-export-recovery-'));
  const dbPath = join(directory, 'studio.sqlite');
  let app = createStudioServer({ dbPath });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.close();

  const db = new DatabaseSync(dbPath);
  const id = '34e36f84-a0a7-4e90-9464-19af3f4ec2db';
  try {
    db.prepare(`INSERT INTO export_jobs
      (id, deck_id, revision, format, slide_id, status, created_at, started_by, lease_until)
      VALUES (?, 'schoolyard-kk', 0, 'pptx', '', 'running', 0, 'interrupted-worker', 0)`).run(id);
  } finally {
    db.close();
  }

  app = createStudioServer({ dbPath });
  await awaitReady(app, id);
  const file = await app.inject(exportsPath + '/' + id + '/file');
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.rawPayload.subarray(0, 2).toString(), 'PK');
});

test('a viewer can export without taking an edit lease and revocation blocks the job and its file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sabaq-export-access-'));
  const key = 'test-only-export-gateway-secret-0000000';
  const previousMode = process.env.STUDIO_AUTH_MODE;
  const previousSecret = process.env.STUDIO_GATEWAY_SECRET;
  process.env.STUDIO_AUTH_MODE = 'gateway';
  process.env.STUDIO_GATEWAY_SECRET = key;
  const app = createStudioServer({ dbPath: join(directory, 'studio.sqlite') });
  t.after(async () => {
    await app.close();
    if (previousMode === undefined) delete process.env.STUDIO_AUTH_MODE;
    else process.env.STUDIO_AUTH_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.STUDIO_GATEWAY_SECRET;
    else process.env.STUDIO_GATEWAY_SECRET = previousSecret;
    await rm(directory, { recursive: true, force: true });
  });
  const headers = (user: string) => ({ 'x-studio-gateway': key, 'x-studio-org': 'school', 'x-studio-user': user });
  const owner = headers('teacher');
  const viewer = headers('viewer');
  const created = await app.inject({ method: 'POST', url: '/api/decks', headers: owner, payload: {
    topic: 'Water cycle lesson', language: 'en', provider: 'fixture', template: 'blank', review: false,
  } });
  assert.equal(created.statusCode, 201, created.body);
  const { id, revision } = created.json<{ id: string; revision: number }>();
  const deckPath = '/api/decks/' + id;
  const grant = deckPath + '/access';
  const target = deckPath + '/exports';
  const request = { method: 'POST' as const, url: target, headers: viewer, payload: { revision, format: 'pptx' } };
  assert.equal((await app.inject(request)).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: grant, headers: owner,
    payload: { subject: 'viewer', permission: 'view' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: deckPath + '/edit-session', headers: owner })).statusCode, 200);
  const accepted = await app.inject(request);
  assert.equal(accepted.statusCode, 202, accepted.body);
  const job = target + '/' + accepted.json<ExportReceipt>().id;
  assert.equal((await app.inject({ url: job, headers: viewer })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: grant + '/viewer', headers: owner })).statusCode, 200);
  assert.equal((await app.inject({ url: job, headers: viewer })).statusCode, 403);
  assert.equal((await app.inject({ url: job + '/file', headers: viewer })).statusCode, 403);
});
