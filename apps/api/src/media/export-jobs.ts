import { randomUUID } from 'node:crypto';
import { existsSync, type ReadStream } from 'node:fs';
import { link, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { exportFilename, exportFormats, type ExportFormat, type ExportJob } from '@sabaq/contracts/export-file';
import type { Deck } from '@sabaq/lesson/types';
import { z } from 'zod';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';
import { makePowerPoint, type MediaRoots } from './powerpoint';
import { renderSlideFile } from './render-export';

const formats = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'image/png',
};
const leaseDuration = 15_000;
const pollInterval = 1_000;
const maxAttempts = 3;

const revisionNumber = z.number().int().nonnegative();
const slideIdentifier = z.string().min(1).max(160);
export const exportJobInput = z.object({
  revision: revisionNumber, format: z.enum(exportFormats), slideId: slideIdentifier.optional(),
}).strict();
const downloadIdentifier = z.object({ downloadId: z.uuid().optional() });

type Scope = ReturnType<typeof exportScope>;
type StoredJob = {
  id: string;
  deck_id: string;
  revision: number;
  format: ExportFormat;
  slide_id: string;
  status: ExportJob['status'];
  attempts: number;
};

function exportScope(deck: Deck, format: ExportFormat, slideId?: string) {
  const selected = format === 'png' ? deck.slides.find(slide => slide.id === slideId) : undefined;
  if (format === 'png' && !selected) throw new ApiError(404, 'Select a slide to export.');
  const slides = selected ? [selected] : deck.slides;
  if (!slides.length || slides.some(slide => slide.status !== 'ready')) {
    throw new ApiError(409, 'Wait until the selected slides are ready.');
  }
  return { deck, slides, format, title: selected?.title || deck.title, slideId: selected?.id ?? '' };
}

function renderExport(scope: Scope, roots: MediaRoots, signal?: AbortSignal): Promise<Buffer> {
  return scope.format === 'pptx'
    ? makePowerPoint(scope.deck, roots)
    : renderSlideFile({ ...scope.deck, slides: scope.slides }, scope.format, roots, signal);
}

class ExportQueue {
  private active?: { token: string; job: StoredJob; controller: AbortController; task: Promise<void> };
  private closed = false;
  private poll: ReturnType<typeof setInterval>;

  constructor(private studio: Studio, private roots: MediaRoots, private directory: string, private log: FastifyInstance['log']) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, format TEXT NOT NULL CHECK(format IN ('pptx','pdf','png')),
      slide_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
      created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
      started_by TEXT, lease_until INTEGER,
      UNIQUE(deck_id, revision, format, slide_id)
    );
    CREATE INDEX IF NOT EXISTS export_job_schedule ON export_jobs(status, retry_at, lease_until, created_at);`);
    this.poll = setInterval(() => this.tick(), pollInterval);
    this.poll.unref();
    this.tick();
  }

  private get db() { return this.studio.store.db; }
  private file(id: string) { return join(this.directory, id); }

  start(deckId: string, revision: number, format: ExportFormat, slideId?: string) {
    const deck = this.studio.deck(deckId);
    const prior = this.db.prepare('SELECT * FROM export_jobs WHERE deck_id=? AND revision=? AND format=? AND slide_id=?')
      .get(deckId, revision, format, format === 'png' ? slideId ?? '' : '') as StoredJob | undefined;
    if (!prior && revision !== deck.revision) throw new ApiError(409, 'The lesson has changed. Reopen export.');
    if (!prior) {
      const scope = exportScope(deck, format, slideId);
      this.db.prepare(`INSERT INTO export_jobs (id, deck_id, revision, format, slide_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'queued', ?) ON CONFLICT(deck_id, revision, format, slide_id) DO NOTHING`)
        .run(randomUUID(), deckId, revision, format, scope.slideId, Date.now());
    } else if (prior.status === 'failed' || (prior.status === 'ready' && !existsSync(this.file(prior.id)))) {
      this.db.prepare(`UPDATE export_jobs SET status='queued', attempts=0, retry_at=0
        WHERE id=? AND status=?`).run(prior.id, prior.status);
    }
    this.tick();
    const job = this.db.prepare('SELECT * FROM export_jobs WHERE deck_id=? AND revision=? AND format=? AND slide_id=?')
      .get(deckId, revision, format, format === 'png' ? slideId ?? '' : '') as StoredJob;
    return this.response(job);
  }

  private response(job: StoredJob): ExportJob {
    return { id: job.id, status: job.status, revision: job.revision, format: job.format, ...(job.slide_id && { slideId: job.slide_id }) };
  }

  private get(deckId: string, id: string) {
    const job = this.db.prepare('SELECT * FROM export_jobs WHERE deck_id=? AND id=?').get(deckId, id) as StoredJob | undefined;
    if (!job) throw new ApiError(404, 'Export not found.');
    return job;
  }

  state(deckId: string, id: string) {
    return this.response(this.get(deckId, id));
  }

  private snapshot(job: StoredJob) {
    const row = this.db.prepare('SELECT data FROM revisions WHERE deck_id=? AND revision=?').get(job.deck_id, job.revision);
    if (!row) throw new ApiError(404, 'Export revision not found.');
    return exportScope(JSON.parse(String(row.data)) as Deck, job.format, job.slide_id);
  }

  async open(deckId: string, id: string) {
    const job = this.get(deckId, id);
    if (job.status !== 'ready') throw new ApiError(409, 'The export is not ready.');
    const scope = this.snapshot(job);
    const handle = await open(this.file(id), 'r').catch(() => { throw new ApiError(409, 'The export file is unavailable. Retry the export.'); });
    return { scope, stream: handle.createReadStream() };
  }

  private tick() {
    if (this.closed) return;
    try {
      const now = Date.now();
      if (this.active) {
        const { token, job, controller } = this.active;
        const lease = this.db.prepare("UPDATE export_jobs SET lease_until=? WHERE id=? AND started_by=? AND status='running'")
          .run(now + leaseDuration, job.id, token);
        if (!lease.changes) controller.abort();
        return;
      }
      const token = randomUUID();
      const job = this.db.prepare(`UPDATE export_jobs SET status='running', started_by=?, lease_until=?
        WHERE id=(SELECT id FROM export_jobs WHERE (status='queued' AND retry_at<=?) OR (status='running' AND lease_until<=?)
          ORDER BY created_at, id LIMIT 1) RETURNING *`).get(token, now + leaseDuration, now, now) as StoredJob | undefined;
      if (!job) return;
      const controller = new AbortController();
      const task = this.run(job, token, controller.signal).catch(error => {
        if (!controller.signal.aborted) this.log.error(error, 'Export worker failed.');
        this.finish(job, token, controller.signal.aborted);
      }).finally(() => {
        this.active = undefined;
        this.tick();
      });
      this.active = { token, job, controller, task };
    } catch (error) {
      this.log.error(error, 'Could not poll the export queue.');
    }
  }

  private finish(job: StoredJob, token: string, interrupted: boolean) {
    const attempts = job.attempts + (interrupted ? 0 : 1);
    const status = attempts >= maxAttempts ? 'failed' : 'queued';
    this.db.prepare(`UPDATE export_jobs SET status=?, attempts=?, retry_at=?, started_by=NULL, lease_until=NULL
      WHERE id=? AND started_by=? AND status='running'`).run(status, attempts, Date.now() + (interrupted ? 0 : attempts * 1000), job.id, token);
  }

  private async run(job: StoredJob, token: string, signal: AbortSignal) {
    const target = this.file(job.id);
    const temporary = target + '.' + token + '.partial';
    if (!existsSync(target)) {
      const bytes = await renderExport(this.snapshot(job), this.roots, signal);
      signal.throwIfAborted();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        signal.throwIfAborted();
        // The final name appears only after the entire file has been written.
        await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
      } finally {
        await rm(temporary, { force: true });
      }
    }
    this.db.prepare(`UPDATE export_jobs SET status='ready', started_by=NULL, lease_until=NULL
      WHERE id=? AND started_by=? AND status='running'`).run(job.id, token);
  }

  async close() {
    this.closed = true;
    clearInterval(this.poll);
    this.active?.controller.abort();
    await this.active?.task;
  }
}

export function registerExports(app: FastifyInstance, studio: Studio, roots: MediaRoots, directory: string) {
  const queue = new ExportQueue(studio, roots, directory, app.log);
  app.addHook('preClose', () => queue.close());

  const base = '/api/decks/:id/exports';
  type DeckRoute = { Params: { id: string } };
  type JobRoute = { Params: { id: string; jobId: string } };
  app.post<DeckRoute>(base, (req, reply) => {
    const { revision, format, slideId } = exportJobInput.parse(req.body);
    return reply.code(202).send(queue.start(req.params.id, revision, format, slideId));
  });
  app.get<JobRoute>(base + '/:jobId', req => queue.state(req.params.id, z.uuid().parse(req.params.jobId)));
  app.get<JobRoute>(base + '/:jobId/file', async (req, reply) => {
    const { downloadId } = downloadIdentifier.parse(req.query);
    const { scope, stream } = await queue.open(req.params.id, z.uuid().parse(req.params.jobId));
    if (req.method === 'HEAD') {
      stream.destroy();
      return send(req, reply, scope, Buffer.alloc(0), downloadId);
    }
    return send(req, reply, scope, stream, downloadId);
  });

  // Keep the original synchronous API available to existing callers.
  let rendersInProgress = 0;
  app.get<{ Params: { id: string; format: string } }>('/api/decks/:id/export/:format', async (req, reply) => {
    const format = z.enum(exportFormats).safeParse(req.params.format);
    if (!format.success) throw new ApiError(404, 'Unknown export format.');
    const { revision, slideId, downloadId } = downloadIdentifier.extend({
      revision: z.coerce.number().int().nonnegative().optional(), slideId: slideIdentifier.optional(),
    }).parse(req.query);
    const deck = studio.deck(req.params.id);
    if (revision !== undefined && revision !== deck.revision) throw new ApiError(409, 'The lesson has changed. Reopen export.');
    const scope = exportScope(deck, format.data, slideId);
    if (rendersInProgress >= 2) throw new ApiError(429, 'Another export is running. Try again shortly.');
    rendersInProgress++;
    let bytes: Buffer;
    try {
      bytes = await renderExport(scope, roots);
    } catch (error) {
      app.log.error(error);
      throw new ApiError(422, 'Could not render this lesson.');
    } finally {
      rendersInProgress--;
    }
    return send(req, reply, scope, bytes, downloadId);
  });

  function send(req: FastifyRequest, reply: FastifyReply, scope: Scope, bytes: Buffer | ReadStream, downloadId: string = randomUUID()) {
    const filename = exportFilename(scope.title, scope.format);
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
    if (req.method !== 'HEAD') reply.raw.once('finish', () => {
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        try {
          studio.store.usage.deckEvent(scope.deck, 'download', downloadId);
        } catch (error) {
          app.log.error(error, 'Could not record the completed export.');
        }
      }
    });
    return reply.type(formats[scope.format])
      .header('Content-Disposition', `attachment; filename="lesson.${scope.format}"; filename*=UTF-8''${encoded}`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(bytes);
  }
}
