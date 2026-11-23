import { lessonTemplates, matchingTemplates, templatePlan, templateSubjects } from '@sabaq/lesson/lesson-templates';
import { checkCreation, ModerationError } from './authoring/moderation';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { StudioAccess, classroomCodeRoute, commentInput, deckRouteAction, grantInput } from './access/access';
import { registerApiReference } from './api-reference';
import { registerOrganization } from './organization/routes';
import { registerCoedit } from './collaboration/coedit';
import { researchCapabilities } from './authoring/research';
import { localAuthoringModel } from './authoring/local-generation';
import { hasAlem } from './authoring/alem';
import { cloudSourceRagAvailable, DeckAssistant } from './assistant/assistant';
import { registerAssistantRoutes } from './assistant/routes';
import { createInput, decideInput, editInput, proposeInput, retryInput } from '@sabaq/contracts/schema';
import { StudioStore } from './persistence/storage';
import { ApiError } from './errors';
import { Studio } from './lessons/studio';
import { generatedImageName } from './media/visuals';
import { registerExports } from './media/export-jobs';
import { registerLessonImages, checkImagePath, normalizeLessonImage } from './media/lesson-images';
import { registerLanguageVersions } from './lessons/language-version-routes';
import { sourceRoutes } from './media/source-files';
import { SourceLibrary } from './media/source-library';
import { convert, importPages } from './media/page-import';
import { extractPowerPointStyle } from './media/pptx-import';
import { registerVideo } from './video/video';
import { catalogRoot, defaultDatabase, defaultMediaRoot, defaultStaticRoot } from './runtime-paths';

import { registerPolls } from './lessons/polls';

export function createStudioServer(
  options: { dbPath?: string; fixtureDelay?: number; staticRoot?: string; mediaRoot?: string } = {},
) {
  const configuredDatabase = options.dbPath ?? process.env.STUDIO_DB_PATH ?? defaultDatabase;
  const dbPath = configuredDatabase === ':memory:' ? configuredDatabase : resolve(configuredDatabase);
  const mediaRoot = options.mediaRoot ?? (dbPath === ':memory:' ? defaultMediaRoot : resolve(dirname(dbPath), 'media'));
  const roots = { catalog: catalogRoot, generated: mediaRoot };
  const store = new StudioStore(dbPath);
  const access = new StudioAccess(store);
  const studio = new Studio(store, options.fixtureDelay, mediaRoot);
  const library = new SourceLibrary(store);
  const assistant = new DeckAssistant(studio, mediaRoot, library);
  const app = Fastify({ logger: false, bodyLimit: 650000 });
  registerApiReference(app, access.enabled);
  app.addHook('onRequest', async req => {
    const route = req.routeOptions.url;
    if (route?.startsWith('/api/') && route !== classroomCodeRoute) access.authenticate(req);
  });
  app.addHook('preHandler', async req => {
    const route = req.routeOptions.url ?? '';
    const action = deckRouteAction(route, req.method);
    if (!action) return;
    const { id } = req.params as { id: string };
    const reads = req.method === 'GET' || req.method === 'HEAD';
    access.require(req, id, action);
    if (action === 'write' && !reads && !route.endsWith('/release') && !route.endsWith('/language-versions')) access.claimEditor(req,id);
  });
  registerLessonImages(app,studio,access,roots);
  registerPolls(app,studio);
  const organizationTemplates=registerOrganization(app,studio,access,mediaRoot);
  const coedit=registerCoedit(app,studio,access);
  registerLanguageVersions(app,studio,access,roots);
  app.register(sourceRoutes, {library,access});
  registerVideo(app, studio, roots, resolve(mediaRoot, '..', 'lectures'),access);
  app.register(async importer => {
    let active = 0;
    importer.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    importer.post<{Body:Buffer}>('/api/import/powerpoint-style',{bodyLimit:20_000_000},async req=>{
      if (!Buffer.isBuffer(req.body)) throw new ApiError(415,'Upload a binary PPTX.');
      if (active>=2) throw new ApiError(429,'Slide importer is busy.');
      active++;
      try {return await extractPowerPointStyle(req.body,convert);}
      finally {active--;}
    });
    importer.post<{ Body: Buffer }>('/api/import/slides', { bodyLimit: 20_000_000 }, async (req, reply) => {
      const { format, title, language, creationId, mode } = z.object({
        creationId:z.uuid().optional(),
        format: z.enum(['pdf', 'pptx', 'png', 'jpg', 'jpeg', 'webp']),
        mode: z.enum(['image', 'editable']).default('image'),
        title: z.string().trim().min(1).max(160), language: z.enum(['kk', 'ru', 'en']),
      }).parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw new ApiError(415, 'Upload a binary file.');
      if (active >= 2) throw new ApiError(429, 'Slide importer is busy. Try again shortly.');
      active++;
      try {
        return reply.code(201).send(await importPages(req.body, format, title, language, mediaRoot, store, access.principal(req), creationId, mode));
      } finally {
        active--;
      }
    });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  const subscribers = new Set<() => void>();
  app.addHook('preClose', async () => {
    assistant.abortAll();
    for (const disconnect of subscribers) disconnect();
  });
  app.addHook('onClose', () => studio.close());
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ModerationError)
      return reply.code(error.status).send({message:error.message,moderationConfirmation:error.confirmation});
    if (error instanceof ApiError)
      return reply
        .code(error.status)
        .send({ message: error.message, ...(error.deck && { deck: error.deck }) });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') });
    const status = (error as { statusCode?: number }).statusCode;
    return reply.code(status && status < 500 ? status : 500).send({
      message: status && status < 500 ? 'Invalid request.' : 'The request could not be completed.',
    });
  });
  type DeckRoute = { Params: { id: string } };
  app.get<{ Params: { file: string } }>('/api/media/:file', async (request, reply) => {
    const { file } = request.params;
    const notFound = () => reply.code(404).send({ message: 'Illustration not found.' });
    if (!generatedImageName.test(file)) return notFound();
    access.media(request, '/api/media/' + file);
    try {
      const bytes = await readFile(resolve(mediaRoot, file));
      return reply.header('X-Content-Type-Options', 'nosniff').type('image/png').send(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notFound();
      throw error;
    }
  });
  app.post('/api/usage/creation',async req=>{
    const {id,language,question}=z.object({id:z.uuid(),language:z.enum(['kk','ru','en']),question:z.enum(['level','duration','image','quiz']).optional()}).strict().parse(req.body);
    store.usage.started(id,language,access.principal(req),question);
    return {saved:true};
  });
  app.post<DeckRoute>('/api/decks/:id/presentation-start',async req=>{
    const {session}=z.object({session:z.uuid()}).strict().parse(req.body);
    const deck=studio.deck(req.params.id);
    if(!deck.slides.some(slide=>slide.status==='ready')) throw new ApiError(409,'A ready slide is required.');
    store.usage.deckEvent(deck,'present',session);
    return {saved:true};
  });
  app.get('/api/admin/usage',async req=>{
    if(!access.principal(req)?.admin) throw new ApiError(403,'System administrator access is required.');
    const {from,to,org,language}=z.object({from:z.iso.date(),to:z.iso.date(),org:z.string().min(1).max(160).optional(),language:z.enum(['en','ru','kk']).optional()}).parse(req.query);
    if(from>to) throw new ApiError(400,'Select a valid date range.');
    const asOf=Date.now();
    return {asOf:new Date(asOf).toISOString(),rows:store.usage.report(Date.parse(from),Date.parse(to)+86400000,org,language,asOf)};
  });
  app.get('/api/lesson-templates',async req=>{
    const {language,subject,grade,topic}=z.object({
      language:z.enum(['kk','ru','en']).default('kk'),subject:z.string().max(40).optional(),
      grade:z.coerce.number().int().min(1).max(11).optional(),topic:z.string().trim().max(500).optional(),
    }).parse(req.query);
    const user=access.principal(req);
    const organization=user && !subject && !grade ? organizationTemplates(user.org).map(template=>({...template,kind:'organization'})) : [];
    return [...organization,...matchingTemplates(subject,grade).map(id=>{
      const t=lessonTemplates[id];
      return {id,name:t.name[language],example:t.scenario[language],subject:t.subject,subjectName:templateSubjects[t.subject][language],
        grades:{min:t.min,max:t.max},theme:t.theme,plan:templatePlan(id,language,topic || t.topic[language],7)};
    })];
  });
  app.get('/api/capabilities', async req => ({ coedit, usageAdmin:access.principal(req)?.admin===true, organizationAdmin:access.principal(req)?.orgAdmin===true, alem: hasAlem(), cloudSourceRag:cloudSourceRagAvailable(), localAuthoring: Boolean(localAuthoringModel()), localAssistant:Boolean(process.env.STUDIO_ASSISTANT_OLLAMA_MODEL?.trim()), researchTopics: researchCapabilities(), accounts: access.enabled }));
  const visibleDecks = (req: import('fastify').FastifyRequest) => {
    const ids = access.visibleIds(req);
    return ids ? ids.map(id => studio.deck(id)) : studio.list();
  };
  app.get('/api/sources', async req => access.sourceList(visibleDecks(req)));
  app.get('/api/library/slide-sources',async req=>visibleDecks(req).filter(deck=>deck.slides.some(slide=>slide.status==='ready'))
    .map(deck=>({id:deck.id,title:deck.title,revision:deck.revision,local:Boolean(deck.source || deck.provider==='local'),
      slides:deck.slides.filter(slide=>slide.status==='ready').map(({id,title})=>({id,title}))})));
  app.get('/api/decks', async req => visibleDecks(req).map(deck => access.forViewer(req, deck)));
  app.get('/api/library/activity', async (req) => {
    const { timeZone } = z.object({ timeZone:z.string().min(1).max(80).default('UTC') }).parse(req.query ?? {});
    const first = new Date(Date.now() - 91 * 86400000);
    try {
      return store.libraryActivity(first.toISOString(), timeZone, access.visibleIds(req));
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400,'Invalid time zone.');
      throw error;
    }
  });
  app.post('/api/decks', {bodyLimit:14_000_000}, async (req, reply) => {
    const submitted = createInput.parse(req.body);
    const principal = access.principal(req);
    const input = submitted.sourceFileIds ? {...submitted, source:library.deckSource(submitted.sourceFileIds,submitted.sourceNotes,principal)} : submitted;
    const {ownImage, ...settings} = input.answers ?? {};
    if (ownImage && (settings.imageSource !== 'own' || input.template === 'blank'))
      throw new ApiError(400,'Select teacher-supplied images before uploading a cover image.');
    if (input.sourceDeckId) access.require(req, input.sourceDeckId, 'read');
    if (input.creationId) store.usage.started(input.creationId, input.language, principal);
    if (input.template!=='blank') {
      const source = input.source ?? (input.sourceDeckId ? studio.deck(input.sourceDeckId).source : undefined);
      const illustration = ownImage && {alt:ownImage.alt, digest:createHash('sha256').update(ownImage.data).digest('hex')};
      await checkCreation({topic:input.topic,source,settings,illustration,template:input.template,research:input.researchQuery},
        input.language,input.moderationConfirmation);
    }
    const ownIllustration = ownImage ? {
      ...await normalizeLessonImage(Buffer.from(ownImage.data,'base64'),mediaRoot,req.signal), alt:ownImage.alt,
      ...(!ownImage.alt && {decorative:true}),
    } : undefined;
    if (input.sourceDeckId) access.require(req, input.sourceDeckId, 'read', false);
    if (input.sourceFileIds) library.detailsFor(input.sourceFileIds,principal);
    return reply.code(201).send(access.forViewer(req, studio.create(input, principal, ownIllustration)));
  });
  if (access.enabled) {
    app.get<DeckRoute>('/api/decks/:id/access', async req =>
      store.db.prepare('SELECT subject, permission FROM deck_grants WHERE deck_id=? ORDER BY subject').all(req.params.id));
    app.put<DeckRoute>('/api/decks/:id/access', async req => {
      const grant = grantInput.parse(req.body);
      if (!store.db.prepare('SELECT 1 FROM deck_owners WHERE deck_id=?').get(req.params.id))
        throw new ApiError(409, 'Assign the legacy lesson to an owner before sharing.');
      store.db.prepare('INSERT INTO deck_grants VALUES (?,?,?) ON CONFLICT(deck_id,subject) DO UPDATE SET permission=excluded.permission')
        .run(req.params.id, grant.subject, grant.permission);
      return { saved: true };
    });
    app.delete<{ Params: {id:string;subject:string} }>('/api/decks/:id/access/:subject', async req => {
      store.transaction(() => {
        store.db.prepare('DELETE FROM deck_grants WHERE deck_id=? AND subject=?').run(req.params.id, req.params.subject);
        store.db.prepare('DELETE FROM edit_leases WHERE deck_id=? AND subject=? AND org=(SELECT org FROM deck_owners WHERE deck_id=?)').run(req.params.id,req.params.subject,req.params.id);
      });
      return { saved: true };
    });
    app.post<DeckRoute>('/api/decks/:id/edit-session', async () => ({ saved: true }));
    app.post<DeckRoute>('/api/decks/:id/edit-session/release', async req => {
      const user = access.principal(req)!;
      store.db.prepare('DELETE FROM edit_leases WHERE deck_id=? AND org=? AND subject=?').run(req.params.id,user.org,user.subject);
      return { saved: true };
    });
    app.get<DeckRoute>('/api/decks/:id/permission', async req => ({permission: access.permission(access.principal(req)!, req.params.id)}));
    app.post<DeckRoute>('/api/decks/:id/view-state', async req => {
      const user = access.principal(req)!;
      const permission = access.permission(user,req.params.id);
      const data = z.object({session:z.uuid(),slideId:z.string().max(160)}).parse(req.body);
      const slides=studio.deck(req.params.id).slides;
      if (!slides.some(slide=>slide.id===data.slideId)) throw new ApiError(404,'Slide not found.');
      if (permission === 'view' || permission === 'edit') {
        store.db.prepare(`INSERT INTO deck_views(deck_id,session,slide_id,completed,at) VALUES (?,?,?,?,?)
          ON CONFLICT(deck_id,session) DO UPDATE SET slide_id=excluded.slide_id,
          completed=max(deck_views.completed,excluded.completed),at=excluded.at`)
          .run(req.params.id,data.session,data.slideId,Number(slides.at(-1)?.id===data.slideId),new Date().toISOString());
      }
      return {saved:true};
    });
    app.get<DeckRoute>('/api/decks/:id/access/views', async req =>
      store.db.prepare(`SELECT count(*) AS opens,coalesce(sum(completed),0) AS completed, (SELECT slide_id FROM deck_views WHERE deck_id=? ORDER BY at DESC,rowid DESC LIMIT 1) AS lastSlide
        FROM deck_views WHERE deck_id=?`).get(req.params.id,req.params.id));
    app.get<DeckRoute>('/api/decks/:id/comments/unread', async req => {
      const user = access.principal(req)!;
      return store.db.prepare(`SELECT count(*) AS unread FROM deck_comments WHERE deck_id=? AND subject<>? AND id>
        COALESCE((SELECT last_id FROM deck_comment_reads WHERE deck_id=? AND org=? AND subject=?),0)`)
        .get(req.params.id,user.subject,req.params.id,user.org,user.subject);
    });
    app.post<DeckRoute>('/api/decks/:id/comments/read', async req => {
      const user = access.principal(req)!;
      const {id} = z.object({id:z.number().int().positive()}).parse(req.body);
      if (store.db.prepare('SELECT 1 FROM deck_comments WHERE deck_id=? AND id=?').get(req.params.id,id))
        store.db.prepare(`INSERT INTO deck_comment_reads VALUES (?,?,?,?) ON CONFLICT(deck_id,org,subject)
          DO UPDATE SET last_id=max(last_id,excluded.last_id)`).run(req.params.id,user.org,user.subject,id);
      return {saved:true};
    });
    app.get<DeckRoute>('/api/decks/:id/comments', async req =>
      store.db.prepare('SELECT id,subject,slide_id AS slideId,text,at FROM deck_comments WHERE deck_id=? ORDER BY id').all(req.params.id));
    app.post<DeckRoute>('/api/decks/:id/comments', async req => {
      const data = commentInput.parse(req.body);
      if (data.slideId && !studio.deck(req.params.id).slides.some(slide => slide.id === data.slideId)) throw new ApiError(404, 'Slide not found.');
      store.db.prepare('INSERT INTO deck_comments(deck_id,subject,slide_id,text,at) VALUES (?,?,?,?,?)')
        .run(req.params.id, access.principal(req)!.subject, data.slideId ?? null, data.text, new Date().toISOString());
      return { saved: true };
    });
  }
  app.get<DeckRoute>('/api/decks/:id', async (req) => access.forViewer(req, studio.deck(req.params.id)));
  registerExports(app, studio, roots, resolve(mediaRoot, '..', 'exports'));
  app.patch<DeckRoute>('/api/decks/:id', async (req, reply) => {
    const data = editInput.parse(req.body);
    if (data.op.kind==='copySlides' && data.op.sourceDeckId!==req.params.id) access.require(req,data.op.sourceDeckId,'read');
    if (data.op.kind === 'slide') {
      const {image,additionalImages}=data.op.changes;
      for (const {src,originalSrc} of [...(image ? [image] : []),...(additionalImages ?? [])]) {
        checkImagePath(req,access,src);
        if (originalSrc) checkImagePath(req,access,originalSrc);
      }
    }
    const { deck, revision } = studio.editWithReceipt(req.params.id, data.op, data.operationId, data.baseRevision);
    if (revision !== undefined) reply.header('X-Sabaq-Edit-Revision', String(revision));
    return deck;
  });
  app.post<DeckRoute>('/api/decks/:id/quality', async req => studio.requestQuality(req.params.id));
  app.post<DeckRoute>('/api/decks/:id/generate', async (req) => studio.generate(req.params.id));
  app.post<DeckRoute>('/api/decks/:id/cancel', async (req) => studio.cancel(req.params.id));
  app.post<DeckRoute>('/api/decks/:id/retry', async (req) =>
    studio.generate(req.params.id, retryInput.parse(req.body).slideId),
  );
  app.post<DeckRoute>('/api/decks/:id/outline/retry', async (req) => studio.retryOutline(req.params.id));
  app.register(async scope => registerAssistantRoutes(scope, assistant, access));
  app.get<DeckRoute>('/api/decks/:id/proposals', async (req) => studio.proposals(req.params.id));
  app.post<DeckRoute>('/api/decks/:id/proposals', async (req) => {
    const { slideId, instruction } = proposeInput.parse(req.body);
    return await studio.propose(req.params.id, slideId, instruction);
  });
  app.post<{ Params: { id: string; pid: string } }>('/api/decks/:id/proposals/:pid', async (req) =>
    studio.decide(req.params.id, req.params.pid, decideInput.parse(req.body).action),
  );
  app.get<DeckRoute>('/api/decks/:id/revisions', async (req) => studio.revisions(req.params.id));
  app.post<{ Params: { id: string; revision: string } }>(
    '/api/decks/:id/revisions/:revision/restore',
    async (req) => {
      const data = z.object({
        baseRevision: z.number().int().min(0).optional(),
        intent: z.enum(['undo', 'redo', 'restore']).optional(),
        operationId: z.uuid().optional(),
      }).parse(req.body ?? {});
      return studio.restore(
        req.params.id,
        z.coerce.number().int().min(0).parse(req.params.revision),
        data.baseRevision,data.intent,data.operationId,
      );
    },
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/decks/:id/events',
    async (req, reply) => {
      const id = req.params.id;
      studio.deck(id);
      let after = Math.max(
        z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(req.query.after ?? 0),
        z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(req.headers['last-event-id'] ?? 0),
      );
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.write(': connected\n\n');
      const flush = () => {
        try { access.require(req, id, 'read', false); } catch { disconnect(); return; }
        for (const e of store.events(id, after)) {
          reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
          after = e.seq;
        }
      };
      const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 15000);
      const disconnect = () => {
        clearInterval(heartbeat);
        studio.updates.off(id, flush);
        subscribers.delete(disconnect);
        if (!reply.raw.destroyed) reply.raw.end();
      };
      subscribers.add(disconnect);
      studio.updates.on(id, flush);
      reply.raw.once('close', disconnect);
      flush();
    },
  );
  const staticRoot = options.staticRoot ?? defaultStaticRoot;
  if (process.env.STUDIO_DEV !== '1' && existsSync(resolve(staticRoot, 'index.html'))) {
    app.register(fastifyStatic, { root: staticRoot });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/api/') &&
        req.headers.accept?.includes('text/html')
      )
        return reply.sendFile('index.html');
      return reply.code(404).send({ message: 'Not found.' });
    });
  }
  return app;
}
