import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deck, Slide } from '@sabaq/lesson/types';
import { videoSizes,type VideoJob, type VideoSettings, type VideoState } from '@sabaq/contracts/video';
import type { MediaRoots } from '../media/powerpoint';
import { imagePath } from '../media/powerpoint';
import { renderSlideFile, renderVideoSteps } from '../media/render-export';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';
import type { StudioAccess, Principal } from '../access/access';
import {scenePlan} from './scene-plan';
import { BiometricVault } from './biometrics';
import { registerNarration } from './narration-routes';
import { videoProviderEndpoint } from './video-provider';
import { digestFile, verifyVideo, videoWatermarkId } from './video-verification';

const settings = z.object({avatarPlacement:z.enum(['corner','half','clear']).optional(),aspect:z.enum(['16:9','9:16','1:1']).default('16:9'),revealParagraphs:z.boolean().optional(), language: z.enum(['kk', 'ru', 'en']), captions: z.boolean(), position: z.enum(['left', 'right', 'none']) });
export const videoStartInput = z.object({ revision: z.number().int().nonnegative(), settings });
export const biometricEnrollmentInput = z.object({consent:z.literal(true),policy:z.string().min(1).max(160)}).strict();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function environment() {
  const url = videoProviderEndpoint(process.env.STUDIO_VIDEO_WORKER_URL?.trim());
  const version = process.env.STUDIO_VIDEO_PIPELINE_VERSION?.trim();
  const detector = process.env.STUDIO_VIDEO_MARK_VERIFIER?.trim();
  const anchors = process.env.STUDIO_VIDEO_C2PA_ANCHORS?.trim();
  if (!(url && version && detector && isAbsolute(detector) && anchors && isAbsolute(anchors))) return;
  return { url, version, detector, anchors, c2pa: process.env.STUDIO_VIDEO_C2PATOOL || 'c2patool',
    ...(process.env.STUDIO_VIDEO_LOCAL_WORKER === '1' && { narrationOnly: true as const }),
    avatar: process.env.STUDIO_AUTH_MODE==='gateway' ? undefined : process.env.STUDIO_VIDEO_AVATAR_ID?.trim() || undefined, token: process.env.STUDIO_VIDEO_WORKER_KEY };
}

type Config = NonNullable<ReturnType<typeof environment>>;
type StoredJob = VideoJob & { deckId: string; digest?: string; policy?: string; watermarkId?: string; biometricRef?:string; avatarId?:string };
async function policyDigest(config: Config) {
  return hash(['export-specific-watermark', config.url, config.avatar, config.version, config.c2pa, await digestFile(config.anchors), await digestFile(config.detector)]);
}
const retryable = new Set([408, 429, 502, 503, 504]);

function byteRange(header: string | undefined, size: number) {
  const value = header?.trim();
  if (!value || !/^bytes\s*=/i.test(value) || value.includes(',')) return;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const [, first, last] = match;
  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(Number(last), size - 1) : size - 1;
  return start <= end ? { start, end } : null;
}

async function callWorker(config: Config, path: string, payload: unknown, key: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(config.url + path, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(config.token && { Authorization: 'Bearer ' + config.token }) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(240_000)]), body: JSON.stringify(payload),
    });
    if (response.ok) return response;
    await response.body?.cancel();
    if (attempt >= 2 || !retryable.has(response.status)) throw new Error('Video worker request failed.');
    await delay(300 * (2 ** attempt), undefined, { signal });
  }
}

async function fetchVideo(response: Response, file: string, signal: AbortSignal) {
  const limit = 400_000_000;
  if (!response.body || !response.headers.get('content-type')?.startsWith('video/mp4') || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('Invalid video response.');
  }
  const handle = await open(file, 'wx', 0o600);
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Video exceeds size limit.');
      await handle.writeFile(value);
    }
    if (!bytes) throw new Error('Empty video.');
  } finally { await reader.cancel().catch(() => {}); await handle.close(); }
}

export class VideoService {
  private closing = false;
  readonly vault:BiometricVault;
  private streams=new Map<string,Set<ReturnType<typeof createReadStream>>>();
  private get shared() {return process.env.STUDIO_AUTH_MODE==='gateway';}
  private waiting = new Map<string, StoredJob>();
  private active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  constructor(private studio: Studio, private roots: MediaRoots, private directory: string, private config = environment(),
    private verify = verifyVideo, private render = renderSlideFile,private renderSteps=renderVideoSteps) {
    const db = this.studio.store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS video_jobs (deck_id TEXT PRIMARY KEY REFERENCES decks(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS video_scenes (deck_id TEXT NOT NULL REFERENCES decks(id), cache_key TEXT NOT NULL, scene_id TEXT NOT NULL,
      PRIMARY KEY(deck_id,cache_key));`);
    this.vault=new BiometricVault(studio.store,ref=>this.purgeBiometrics(ref));
    // Resume only the current revision's saved immutable snapshot.
    if (config) for (const row of db.prepare("SELECT data FROM video_jobs WHERE json_extract(data,'$.status') IN ('queued','running','verifying')").all()) {
      this.enqueue(JSON.parse(String(row.data)) as StoredJob);
    }
  }
  private job(id: string): StoredJob | undefined {
    const row = this.studio.store.db.prepare('SELECT data FROM video_jobs WHERE deck_id=?').get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  state(id: string,person?:Principal): VideoState {
    this.studio.deck(id);
    const current=this.job(id);
    const saved=current?.watermarkId ? current : undefined;
    const job=this.shared && saved?.settings.position!=='none' && (!saved?.biometricRef || !this.vault.active(saved.biometricRef)) ? undefined : saved;
    return { enabled: !!this.config, avatar: !this.config?.narrationOnly && (this.shared ? !!(person && this.vault.identify(person)) : !!this.config?.avatar),
      ...(this.config?.narrationOnly && { narrationOnly: true }),
      ...(!this.config?.narrationOnly && this.shared && person && {biometrics:this.vault.summary(person)}),
      ...(job && { job: { key: job.key, revision: job.revision, status: job.status, settings: job.settings, completed: job.completed, total: job.total } }) };
  }
  async start(id: string, revision: number, options: VideoSettings,person?:Principal) {
    if (!this.config) throw new ApiError(503, 'Video worker and independent verification must be configured.');
    const biometricRef=options.position!=='none' && this.shared && person ? this.vault.identify(person) : undefined;
    const avatarId=options.position==='none' ? undefined : this.shared ?
      biometricRef && await this.vault.authorize(biometricRef,'start',{deck:id}) : this.config.avatar;
    if (options.position!=='none' && !avatarId) throw new ApiError(403,'A subject-consented avatar is required.');
    const deck = this.studio.deck(id);
    if (deck.revision !== revision || !deck.slides.length || deck.slides.some(slide => slide.status !== 'ready')) throw new ApiError(409, 'Reopen the completed lesson.');
    if (this.config.narrationOnly) {
      if (options.position !== 'none' || options.language !== deck.language) throw new ApiError(422, 'Export uses narration in the lesson language.');
      if (!deck.slides.some(slide => slide.notes.trim())) throw new ApiError(422, 'Add speaker notes to at least one slide.');
    }
    for(const slide of deck.slides) scenePlan(slide,deck.language,options);
    const policy = await policyDigest(this.config).catch(() => { throw new ApiError(503, 'Video verification is unavailable.'); });
    const previous = this.job(id);
    const key = hash([id, revision, options, this.config.version, this.config.url, policy, avatarId ?? null,biometricRef ?? null]);
    if (previous?.key === key && ['queued', 'running', 'verifying', 'ready'].includes(previous.status)) return this.state(id,person);
    if (this.active.has(id) || this.waiting.has(id)) throw new ApiError(409, 'Wait for the current video run to finish.');
    const watermarkId = previous?.key === key && previous.watermarkId ? previous.watermarkId : randomUUID().replaceAll('-', '');
    const job: StoredJob = { key, policy, watermarkId, biometricRef,avatarId, deckId: id, revision, settings: options, status: 'queued', completed: 0, total: deck.slides.length };
    this.save(job);
    this.enqueue(job);
    return this.state(id,person);
  }
  private save(job: StoredJob) {
    this.studio.store.transaction(()=>{
      if(job.biometricRef){
        if(job.status==='queued') this.vault.track(job.biometricRef,'video',job.key,job.deckId);
        else if(!this.vault.active(job.biometricRef)) return;
      }
      this.studio.store.db.prepare('INSERT INTO video_jobs(deck_id,data) VALUES(?,?) ON CONFLICT(deck_id) DO UPDATE SET data=excluded.data')
        .run(job.deckId, JSON.stringify(job));
      if(job.status==='queued' || job.status==='ready')
        this.studio.store.usage.deckEvent(this.studio.deck(job.deckId),job.status==='queued' ? 'video_start' : 'video_ready',job.key);
    });
  }
  cancel(id: string,person?:Principal) {
    const current = this.job(id);
    if (current && ['queued','running','verifying'].includes(current.status)) {
      this.waiting.delete(id);
      current.status = 'cancelled'; this.save(current); this.active.get(id)?.controller.abort();
    }
    return this.state(id,person);
  }
  async close() {
    this.closing = true;
    this.waiting.clear();
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map(({ task }) => task));
    await this.vault.close();
  }
  private enqueue(job: StoredJob) {
    this.waiting.set(job.deckId, job);
    this.next();
  }
  private next() {
    if (this.closing || this.active.size) return;
    const job = this.waiting.values().next().value;
    if (!job) return;
    this.waiting.delete(job.deckId);
    job.status = 'running';
    this.save(job);
    const controller = new AbortController();
    const task = this.run(job, controller.signal).catch(() => {
      if (!controller.signal.aborted) this.save({ ...job, status: 'failed' });
    }).finally(() => { this.active.delete(job.deckId); this.next(); });
    this.active.set(job.deckId, { task, controller });
  }
  private async scene(deck: Deck, slide: Slide, job: StoredJob, signal: AbortSignal) {
    const config = this.config!;
    const avatar=await this.authorizeJob(job,'scene',signal);
    const path = slide.image && imagePath(slide.image.src, this.roots);
    if (slide.image && !path) throw new Error('Unsupported slide image.');
    const gallery = await Promise.all((slide.additionalImages ?? []).map(image=>{
      const file=imagePath(image.src,this.roots);
      if (!file) throw new Error('Unsupported slide image.');
      return digestFile(file);
    }));
    const artwork=slide.importedArtwork && imagePath(slide.importedArtwork,this.roots);
    if(slide.importedArtwork && !artwork) throw new Error('Unsupported imported artwork.');
    const { id, version, status, evidence, ...content } = slide;
    const key = hash(['speaker-notes', deck.id, config.url, config.version, deck.theme, deck.brand, deck.powerPointStyle, deck.language, content, path && await digestFile(path), ...gallery, ...(artwork ? [await digestFile(artwork)] : []), job.settings, avatar, job.biometricRef ?? null]);
    const plan=scenePlan(slide,deck.language,job.settings);
    const native=!!(job.settings.aspect || job.settings.revealParagraphs || job.settings.avatarPlacement);
    const keys=plan.paragraphs.map((_,i)=>native ? hash([key,'native-layout',plan.frame,i]) : key);
    const db=this.studio.store.db;
    const find=db.prepare('SELECT scene_id FROM video_scenes WHERE deck_id=? AND cache_key=?');
    const cached=keys.map(k=>find.get(deck.id,k)?.scene_id as string|undefined);
    if(cached.every((entry):entry is string=>!!entry)) return cached;
    const single={...deck,slides:[slide]};
    const frames=native ? await this.renderSteps(single,this.roots,job.settings,plan.paragraphs.length,signal)
      : [await this.render(single,'png',this.roots)];
    if(frames.length!==keys.length) throw new Error('Incomplete video frames.');
    const selected:string[]=[];
    for(const [index,segment] of keys.entries()){
      signal.throwIfAborted();
      if(cached[index]){selected.push(cached[index]!);continue;}
      if(job.biometricRef) {
        if(index>0) await this.authorizeJob(job,'scene',signal);
        this.vault.track(job.biometricRef,'scene',segment,deck.id);
      }
      const response=await callWorker(config,'/scenes',{
        imagePng:frames[index].toString('base64'),narration:plan.paragraphs[index],sourceLanguage:deck.language,
        ...job.settings,avatarId:avatar,...(job.biometricRef && {subjectRef:job.biometricRef}),
        ...(native && {frame:plan.frame,segment:{index,count:keys.length}}),
        quiz:index===keys.length-1 && slide.answer ? {question:slide.body || slide.title,answer:slide.answer,pauseSeconds:4} : undefined,
        pipelineVersion:config.version,label:'ИИ',
      },segment,signal);
      const sceneId=await this.sceneHandle(response);
      signal.throwIfAborted();
      if(job.biometricRef && !this.vault.active(job.biometricRef)) throw new ApiError(403,'Avatar consent has been revoked.');
      db.prepare('INSERT OR REPLACE INTO video_scenes(deck_id,cache_key,scene_id) VALUES(?,?,?)').run(deck.id,segment,sceneId);
      selected.push(sceneId);
    }
    return selected;
  }
  private async sceneHandle(response:Response) {
    const reader = response.body?.getReader(); if (!reader) throw new Error('Missing scene handle.');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length;
        if (length > 2048) throw new Error('Scene handle is too large.'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const { sceneId } = z.object({ sceneId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/) }).parse(JSON.parse(Buffer.concat(chunks).toString()));
    return sceneId;
  }
  private async run(job: StoredJob, signal: AbortSignal) {
    if (job.policy !== await policyDigest(this.config!)) throw new Error('Video verification policy changed.');
    const watermarkId = videoWatermarkId.parse(job.watermarkId);
    const row = this.studio.store.db.prepare('SELECT data FROM revisions WHERE deck_id=? AND revision=?').get(job.deckId, job.revision);
    if (!row) throw new Error('Revision unavailable.');
    const deck: Deck = JSON.parse(String(row.data));
    const sceneIds: string[] = [];
    for (const [index,slide] of deck.slides.entries()) {
      signal.throwIfAborted();
      sceneIds.push(...await this.scene(deck, slide, job, signal));
      signal.throwIfAborted();
      job.completed = index+1; job.status = 'running'; this.save(job);
    }
    const config = this.config!;
    await this.authorizeJob(job,'assemble',signal);
    const response = await callWorker(config, '/assemble', { sceneIds, watermarkId, ...(job.settings.aspect && {frame:videoSizes[job.settings.aspect]}), ...(job.biometricRef && {subjectRef:job.biometricRef}), label: 'ИИ', pipelineVersion: config.version }, job.key, signal);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, job.key + '.partial.mp4');
    await rm(temp,{force:true});
    try {
      await fetchVideo(response, temp, signal);
      signal.throwIfAborted();
      job.status = 'verifying'; this.save(job);
      const proof = await this.verify(temp, {...config, expectedWatermarkId: watermarkId, expectedSize:job.settings.aspect ? videoSizes[job.settings.aspect] : undefined}, signal);
      signal.throwIfAborted();
      await this.authorizeJob(job,'release',signal);
      await rename(temp, join(this.directory, job.key + '.mp4'));
      signal.throwIfAborted();
      job.status = 'ready'; job.digest = proof.sha256; this.save(job);
    } finally { await rm(temp, { force: true }); }
  }
  private async authorizeJob(job:StoredJob,operation:string,signal?:AbortSignal,actor?:Principal) {
    if(job.settings.position==='none') return null;
    if(job.biometricRef) {
      const avatar=await this.vault.authorize(job.biometricRef,operation,{deck:job.deckId,job:job.key,...(actor && {actor:hash([actor.org,actor.subject])})},signal);
      if(avatar!==job.avatarId) throw new ApiError(403,'The avatar authorization changed. Render a new recording.');
      return avatar;
    }
    if(this.shared || !this.config?.avatar) throw new ApiError(403,'Subject-bound avatar authorization is required.');
    return this.config.avatar;
  }
  private async purgeBiometrics(ref:string) {
    for(const stream of this.streams.get(ref) ?? []) stream.destroy();
    const rows=this.studio.store.db.prepare('SELECT kind,key,deck FROM biometric_artifacts WHERE ref=?').all(ref);
    const stopped:Promise<void>[]=[];
    for(const {kind,deck} of rows) {
      if(kind!=='video') continue;
      const id=String(deck),current=this.job(id);
      if(current?.biometricRef!==ref) continue;
      this.waiting.delete(id);
      const active=this.active.get(id);
      if(active){active.controller.abort();stopped.push(active.task);}
    }
    await Promise.allSettled(stopped);
    for(const row of rows) if(row.kind==='video') {
      const key=String(row.key);
      if(!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid recording index.');
      await rm(join(this.directory,key+'.mp4'),{force:true});
      await rm(join(this.directory,key+'.partial.mp4'),{force:true});
    }
    this.studio.store.transaction(()=>{
      for(const row of rows) if(row.kind==='scene') this.studio.store.db.prepare('DELETE FROM video_scenes WHERE deck_id=? AND cache_key=?').run(row.deck,row.key);
      this.studio.store.db.prepare("DELETE FROM video_jobs WHERE json_extract(data,'$.biometricRef')=?").run(ref);
    });
  }
  async download(id:string,key:string,actor?:Principal) {
    const { stream } = await this.readDownload(id, key, actor);
    return stream!;
  }
  async readDownload(id: string, key: string, actor?: Principal, rangeHeader?: string, ifRange?: string | string[], metadataOnly = false) {
    const file=await this.file(id,key,actor);
    const { size } = await stat(file).catch(() => { throw new ApiError(404, 'Video unavailable.'); });
    const job=this.job(id);
    if(!job || job.key!==key || job.status!=='ready' || !job.digest) throw new ApiError(404,'Video unavailable.');
    const ref=job.biometricRef;
    if (ref && !this.vault.active(ref)) throw new ApiError(403, 'Avatar consent has been revoked.');
    const etag = `"${job.digest}"`;
    const range = !metadataOnly && (!ifRange || ifRange === etag) ? byteRange(rangeHeader, size) : undefined;
    if (range === null || metadataOnly) return { etag, size, range };
    if(ref) this.vault.track(ref,'video',key,id);
    const stream=createReadStream(file, range);
    if(ref) {
      const active=this.streams.get(ref) ?? new Set();
      active.add(stream);this.streams.set(ref,active);
      stream.once('close',()=>{active.delete(stream);if(!active.size)this.streams.delete(ref);});
    }
    return { etag, size, range, stream };
  }
  async file(id: string, key: string,actor?:Principal) {
    const current = this.job(id);
    if (!this.config || current?.status !== 'ready' || current.key !== key || !current.digest || !current.watermarkId) throw new ApiError(404, 'Verified video unavailable.');
    await this.authorizeJob(current,'download',undefined,actor);
    const file = join(this.directory, key + '.mp4');
    if (await policyDigest(this.config).catch(() => '') !== current.policy || await digestFile(file).catch(() => '') !== current.digest) {
      this.save({ ...current, status: 'failed' }); throw new ApiError(409, 'Video integrity check failed.');
    }
    if(current.biometricRef && !this.vault.active(current.biometricRef)) throw new ApiError(403,'Avatar consent has been revoked.');
    return file;
  }
}

export function registerVideo(app: FastifyInstance, studio: Studio, roots: MediaRoots, directory: string,access:StudioAccess,
  videos = new VideoService(studio, roots, directory)) {
  registerNarration(app, studio);
  app.addHook('preClose', () => videos.close());
  function subject(req:FastifyRequest) {
    const person=access.principal(req);
    if(!person) throw new ApiError(401,'Sign in to manage avatar consent.');
    return person;
  }
  app.get('/api/biometrics/self',req=>videos.vault.status(subject(req)));
  app.post('/api/biometrics/self/enrollment',req=>{
    const person=subject(req),input=biometricEnrollmentInput.parse(req.body);
    return videos.vault.enroll(person,input.policy);
  });
  app.delete('/api/biometrics/self',async(req,reply)=>{
    const result=await videos.vault.revoke(subject(req));
    return reply.code(result.state==='deleting' ? 202 : 200).send(result);
  });
  type Route = { Params: { id: string } };
  app.get<Route>('/api/decks/:id/video', req => videos.state(req.params.id,access.principal(req)));
  app.post<Route>('/api/decks/:id/video', req => {
    const body = videoStartInput.parse(req.body);
    return videos.start(req.params.id, body.revision, body.settings,access.principal(req));
  });
  app.post<Route>('/api/decks/:id/video/cancel', req => videos.cancel(req.params.id,access.principal(req)));
  app.route<{ Params: { id: string; key: string }; Querystring: { play?: string } }>({
    method: ['GET', 'HEAD'],
    url: '/api/decks/:id/video/:key/file',
    async handler(req, reply) {
      const { etag, size, range, stream } = await videos.readDownload(req.params.id, req.params.key, access.principal(req),
        req.headers.range, typeof req.headers['if-range']==='string' ? req.headers['if-range'] : undefined, req.method === 'HEAD');
      reply.headers({ 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      if (range === null) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      const disposition = req.query.play === '1' ? 'inline' : 'attachment';
      reply.type('video/mp4').header('Content-Disposition', `${disposition}; filename="lesson.mp4"`);
      if (range) reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      const length = range ? range.end - range.start + 1 : size;
      return reply.header('Content-Length', String(length)).send(stream);
    },
  });
}
