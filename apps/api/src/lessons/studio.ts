import { ApiError } from '../errors';
import { applyLessonEdit, LessonEditError, type AssistantOperation, type LessonEdit } from '@sabaq/lesson/editing';
import { catalogRoot, defaultMediaRoot } from '../runtime-paths';
import { LessonQualityQueue, type reviewSlides } from './quality';
import { isTemplate, lessonTemplates } from '@sabaq/lesson/lesson-templates';
import { presentationTitle } from '@sabaq/lesson/outline-edits';
import { recommendLessonTheme } from '@sabaq/lesson/themes';
import { generateLocal, localAuthoringModel } from '../authoring/local-generation';
import { groundedSlide } from '../authoring/grounded-slide';
import { ModerationError, requireSuitable } from '../authoring/moderation';
import { randomUUID } from 'node:crypto';
import { RunStartedEventSchema, RunFinishedEventSchema, RunErrorEventSchema } from '@ag-ui/core/schemas';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { CreateInput, Deck, EditOp, OutlineItem, Proposal, Revision, Slide, SlideImage, Theme } from '@sabaq/lesson/types';
import { minGeneratedSlides } from '@sabaq/lesson/types';
import { generateOutline, hasAlem } from '../authoring/alem';
import { composeLessonSlide } from '../authoring/compose';
import { applyImageMode, requestedImageMode } from '../authoring/image-mode';
import { blankSlide, excerpts, fixtureOutline, fixtureProposal, fixtureSlide } from '../authoring/lessons';
import { plannedLessonMinutes, slideCountFor } from '../authoring/slide-count';
import { completeBrief, completeAssessment, configuredSpeechProfile } from '../authoring/lesson-brief';
import { StudioStore } from '../persistence/storage';
import { runGenerationStep } from '../authoring/generation-retry';
import { researchCapabilities, researchDocument, researchOutline, researchSlide, retrievePublicSources } from '../authoring/research';

type Run = {
  id: string;
  deckId: string;
  active: boolean;
  stage: 'outline' | 'slides';
  review: boolean;
  count: number;
  researchSlideCount?: number;
  target?: string;
  answers?: CreateInput['answers'];
  outlinePlan?: { items: OutlineItem[]; theme?: Theme };
};
type StoredProposal = Proposal & { deckId: string };
type EditReceipt = { op: EditOp; revision?: number };
type RestoreIntent = 'undo' | 'redo' | 'restore';
type RestoreReceipt = { signature: string; revision: number };
const now = () => new Date().toISOString();
function getSlide(deck: Deck, id: string) {
  const slide = deck.slides.find((s) => s.id === id);
  if (!slide) throw new ApiError(404, 'Slide not found.', deck);
  return slide;
}
export class Studio {
  readonly updates = new EventEmitter();
  private readonly qualityQueue: LessonQualityQueue;
  private controllers = new Map<string, AbortController>();
  private workers = new Set<Promise<void>>();
  private translations = new Map<string,number>();
  constructor(
    readonly store: StudioStore,
    private delay = 480,
    private mediaRoot = defaultMediaRoot,
    measureQuality?: Parameters<typeof reviewSlides>[4],
  ) {
    this.qualityQueue = new LessonQualityQueue(id => this.deck(id), (snapshot, result) => this.finishQuality(snapshot, result),
      { catalog: catalogRoot, generated: mediaRoot }, measureQuality);

    this.updates.setMaxListeners(0);
    if (!store.all('decks').length)
      store.transaction(() => {
        for (const lang of ['en', 'ru', 'kk'] as const)
          store.saveRevision({ ...makeFixtureDeck(lang), outlineStatus: 'complete' }, 'Initial lesson');
      });
    for (const deck of store.all<Deck>('decks')) {
      if (deck.qualityReview?.state === 'pending') this.qualityQueue.enqueue(deck.id);
      if (deck.outlineStatus) continue;
      deck.outlineStatus = this.recoveredOutlineStatus(deck);
      store.put('decks', deck.id, deck);
    }
    // An abruptly lost worker leaves its run active and its finished slides committed.
    for (const run of store.all<Run>('runs').filter(r=>r.active)) this.launch(run);
  }
  // A saved outline without a running worker can be complete or eligible to resume.
  private recoveredOutlineStatus(deck: Deck): 'complete' | 'failed' {
    if (deck.phase !== 'outline' || deck.outlineStatus === 'complete') return 'complete';
    if (deck.outlineStatus) return 'failed';
    const runIds = new Set(
      this.store
        .all<Run>('runs')
        .filter((r) => r.deckId === deck.id && r.stage === 'outline')
        .map((r) => r.id),
    );
    const last = this.store
      .events(deck.id, 0)
      .findLast((e) => e.kind === 'run' && e.revision <= deck.revision && runIds.has(String(e.runId)));
    return last?.status === 'completed' ? 'complete' : 'failed';
  }
  list() {
    return this.store.all<Deck>('decks');
  }
  deck(id: string) {
    const d = this.store.get<Deck>('decks', id);
    if (!d) throw new ApiError(404, 'Lesson not found.');
    return d;
  }
  private active(id: string) {
    return this.store.all<Run>('runs').find((r) => r.deckId === id && r.active);
  }
  private event(deck: Deck, kind: string, data: Record<string, unknown> = {}) {
    this.store.appendEvent(deck.id, kind, deck.revision, data);
    queueMicrotask(() => this.updates.emit(deck.id));
  }
  private save(deck: Deck, reason: string, kind: string, data: Record<string, unknown> = {}) {
    deck.revision++;
    deck.updatedAt = now();
    this.store.saveRevision(deck, reason);
    if (reason==='Teacher edit' || reason==='Assistant edits applied' || reason==='Assistant proposal applied')
      this.store.usage.deckEvent(deck,'edit','once');
    if ((reason==='Assistant edits applied' || reason==='Assistant proposal applied') && typeof data.proposalId==='string') {
      const ref=(reason==='Assistant edits applied' ? 'chat-' : 'rewrite-')+data.proposalId;
      this.store.usage.deckEvent(deck,'apply',ref,ref);
    }
    this.event(deck, kind, data);
    return deck;
  }

  requestQuality(id: string) {
    const deck = this.deck(id);
    if (!deck.slides.length || deck.slides.some(slide => slide.status !== 'ready')) throw new ApiError(409, 'Wait until the slides are ready.');
    if (deck.qualityReview?.state !== 'pending') {
      deck.qualityReview = { state: 'pending', key: randomUUID(), repair: {} };
      this.store.transaction(() => { this.store.put('decks', id, deck); this.event(deck, 'slide'); });
    }
    this.qualityQueue.enqueue(id);
    return deck.qualityReview;
  }

  private finishQuality(snapshot: Deck, result: Awaited<ReturnType<typeof reviewSlides>>) {
    this.store.transaction(() => {
      const deck = this.deck(snapshot.id);
      if (snapshot.qualityReview?.state !== 'pending' || deck.qualityReview?.state !== 'pending' ||
          snapshot.qualityReview.key !== deck.qualityReview.key) return;
      const reports: typeof result.reports = {};
      let repaired = false;
      if (deck.theme === snapshot.theme) for (const inspected of result.slides) {
        const current = deck.slides.find(slide => slide.id === inspected.id);
        if (!current || current.version !== inspected.version) continue;
        if (JSON.stringify([current.title, current.layout, current.image?.alt, current.additionalImages?.map(image=>image.alt), current.chart?.alt]) !==
            JSON.stringify([inspected.title, inspected.layout, inspected.image?.alt, inspected.additionalImages?.map(image=>image.alt), inspected.chart?.alt])) {
          current.title = inspected.title; current.layout = inspected.layout;
          if (current.image && inspected.image) current.image.alt = inspected.image.alt;
          if (inspected.additionalImages) current.additionalImages = inspected.additionalImages;
          if (current.chart && inspected.chart) current.chart.alt = inspected.chart.alt;
          current.version++;
          repaired = true;
        }
        reports[current.id] = { ...result.reports[current.id], version: current.version };
      }
      deck.qualityReview = { state: result.state, theme: snapshot.theme, slides: reports };
      if (repaired) this.save(deck, 'Generated slide quality repairs', 'slide');
      else { this.store.put('decks', deck.id, deck); this.event(deck, 'slide'); }
    });
  }

  create(input: CreateInput, owner?: {org:string;subject:string}, ownIllustration?:SlideImage) {
    const hash=input.creationId && this.store.usage.fingerprint({...input,moderationConfirmation:undefined});
    if(input.creationId) {
      const previous=this.store.usage.previous(input.creationId,owner);
      if(previous) {
        if(previous.hash!==hash) throw new ApiError(409,'This creation request already produced another lesson.');
        return this.deck(previous.deck);
      }
    }
    if (input.sourceDeckId) {
      const sourceDeck = this.deck(input.sourceDeckId);
      if (input.source || !sourceDeck.source || sourceDeck.research) throw new ApiError(400, 'Select one saved source.');
      input = { ...input, source: sourceDeck.source };
    }
    if (input.researchQuery && (input.source || input.provider !== 'fixture' || input.template === 'blank' || !researchCapabilities().includes(input.researchQuery)))
      throw new ApiError(400, 'Select an enabled public search topic for a research lesson.');
    if (input.provider === 'local' && !localAuthoringModel()) throw new ApiError(503, 'Local authoring is unavailable.');
    if (input.provider === 'alem' && input.source)
      throw new ApiError(400, 'Source documents use the local fixture provider.');
    if (input.provider === 'alem' && !hasAlem())
      throw new ApiError(503, 'Alem is not configured on this server.');
    const {ownImage: _ownImage, ...answers} = input.answers ?? {};
    const themeRecommendation = input.template === 'blank' || input.powerPointStyle ? undefined :
      recommendLessonTheme(input.topic, isTemplate(input.template) ? lessonTemplates[input.template].theme : undefined);
    const d: Deck = {
      id: randomUUID(),
      topic: input.topic,
      title: input.topic,
      brand: this.store.organizationBrand(owner?.org),
      powerPointStyle:input.powerPointStyle,
      plannedMinutes:plannedLessonMinutes(input),
      imageMode: requestedImageMode(input.imageMode, input.answers),
      imageStyle:input.imageStyle,
      imageSource:answers.imageSource,
      speechProfile:configuredSpeechProfile(input.language,owner),
      ...(ownIllustration && {ownIllustration}),
      language: input.language,
      theme: themeRecommendation?.theme ?? 'notebook',
      ...(themeRecommendation && { themeRecommendation }),
      provider: input.provider,
      revision: 0,
      phase: 'outline',
      outlineStatus: 'generating',
      slides: [],
      outline: [],
      source: input.source,
      ...(input.researchQuery && { research: { query: input.researchQuery } }),
      template: input.template,
      updatedAt: now(),
    };
    const saveNewDeck = (reason: string) => {
      this.store.saveRevision(d,reason);
      if (owner) this.store.db.prepare('INSERT INTO deck_owners(deck_id,org,subject) VALUES(?,?,?)')
        .run(d.id,owner.org,owner.subject);
      this.store.usage.attach(d,owner,input.creationId,hash);
      for(const question of ['level','duration','image','quiz'] as const)
        if(answers[question] || question==='image' && answers.imageSource) this.store.usage.deckEvent(d,'answer',question);
      if (ownIllustration) this.store.db.prepare('INSERT OR IGNORE INTO lesson_image_assets(deck_id,src) VALUES(?,?)').run(d.id,ownIllustration.src);
    };
    const count = slideCountFor(input);
    if (input.template === 'blank') {
      const slideLabel = {en:'Slide', ru:'Слайд', kk:'Слайд'}[input.language];
      const templateLayout=input.powerPointStyle?.layouts[0];
      d.outline = Array.from({length:count ?? 1}, (_, index) => ({
        id:randomUUID(), title:index === 0 ? input.topic : `${slideLabel} ${index + 1}`, summary:'',
        layout:templateLayout?.layout ?? 'body',
      }));
      d.slides = d.outline.map(item => ({...blankSlide(item), status:'ready', powerPointLayoutId:templateLayout?.id}));
      d.phase = 'editing';
      d.outlineStatus = 'complete';
      this.store.transaction(() => saveNewDeck('Blank lesson'));
      return d;
    }
    const run: Run = {
      id: randomUUID(),
      deckId: d.id,
      active: true,
      stage: 'outline',
      review: input.review,
      count: count ?? 0,
      ...(input.researchQuery && count !== undefined && { researchSlideCount:count }),
      answers: input.answers && answers,
    };
    this.store.transaction(() => {
      saveNewDeck('Created');
      this.register(d, run);
    });
    this.launch(run);
    return d;
  }

  private checkCapacity(owner?: {org:string;subject:string}) {
    const key = JSON.stringify([owner?.org ?? null,owner?.subject ?? null]);
    const active = this.store.db.prepare(`SELECT count(*) AS count FROM runs r
      LEFT JOIN deck_owners owner ON owner.deck_id=json_extract(r.data,'$.deckId')
      WHERE json_extract(r.data,'$.active')=1 AND owner.org IS ? AND owner.subject IS ?`).get(owner?.org ?? null,owner?.subject ?? null)!;
    if (Number(active.count) + (this.translations.get(key) ?? 0) >= 2)
      throw new ApiError(429,'Two lessons are already generating. Wait for one to finish or cancel it.');
    return key;
  }
  reserveTranslation(owner?: {org:string;subject:string}) {
    const key = this.checkCapacity(owner);
    this.translations.set(key,(this.translations.get(key) ?? 0)+1);
    return ()=>{
      const rest = (this.translations.get(key) ?? 1)-1;
      if (rest) this.translations.set(key,rest); else this.translations.delete(key);
    };
  }
  private register(deck: Deck, run: Run) {
    const owner = this.store.db.prepare('SELECT org,subject FROM deck_owners WHERE deck_id=?').get(deck.id) as {org:string;subject:string} | undefined;
    this.checkCapacity(owner);
    this.store.put('runs', run.id, run);
    this.event(deck, 'run', {
      runId: run.id,
      ag: RunStartedEventSchema.parse({ type: 'RUN_STARTED', threadId: deck.id, runId: run.id }),
    });
  }
  private launch(run: Run) {
    const c = new AbortController();
    this.controllers.set(run.id, c);
    const worker = this.work(run, c.signal)
      .catch((error) => {
        if (this.store.get<Run>('runs', run.id)?.active)
          this.endRun(run, 'failed', error instanceof ModerationError ? error.message : 'The generation step failed. Please retry.', error instanceof ModerationError);
      })
      .finally(() => {
        this.controllers.delete(run.id);
        this.workers.delete(worker);
      });
    this.workers.add(worker);
  }
  private current(run: Run) {
    return !!this.store.get<Run>('runs', run.id)?.active;
  }
  private async work(run: Run, signal: AbortSignal) {
    let d = this.deck(run.deckId);
    if (run.stage === 'outline') {
      if (d.research && !d.research.sources) {
        const query = d.research.query;
        const sources = await runGenerationStep(()=>retrievePublicSources(query,signal),signal);
        if (!this.current(run)) return;
        d = this.deck(run.deckId);
        d.research = { query: d.research!.query, sources };
        d.source = researchDocument(d.language, sources);
        this.store.transaction(() => this.save(d, 'Public sources retrieved', 'outline', { runId: run.id }));
      }
      let outline: OutlineItem[];
      let savedPlan = run.outlinePlan;
      if (!savedPlan && d.provider !== 'fixture' && d.outline.length < run.count) {
        const plan = await runGenerationStep(()=>generateOutline(
          d.topic,
          d.language,
          run.count,
          signal,
          run.answers,
          d.template,
          d.provider === 'local' ? generateLocal : undefined,
          d.provider === 'local' && d.source ? excerpts(d.source,d.language) : undefined,
        ),signal);
        const pending = this.store.get<Run>('runs', run.id);
        if (!pending?.active) return;
        savedPlan = {
          theme: isTemplate(d.template) ? lessonTemplates[d.template].theme : plan.theme,
          items: completeBrief(d, plan.items.map((item,i) => ({
            ...item, id:randomUUID(), title:isTemplate(d.template) && i === 0 ? d.topic : item.title,
          })), run.answers),
        };
        await requireSuitable(savedPlan,d.language,'output',signal);
        if (!this.current(run)) return;
        this.store.put('runs', run.id, { ...pending, outlinePlan: savedPlan });
      }
      if (savedPlan) outline = savedPlan.items;
      else {
        const fallback = d.research?.sources ? researchOutline(d, d.research.sources, run.researchSlideCount) : fixtureOutline(d, run.count);
        outline = completeBrief(d,fallback,run.answers);
        await requireSuitable(outline,d.language,'output',signal);
      }
      for (const item of outline.slice(d.outline.length)) {
        await sleep(this.delay / 3, undefined, { signal });
        if (!this.current(run)) return;
        d = this.deck(run.deckId);
        if (!d.outline.length && d.title === d.topic) d.title = presentationTitle(d.topic,d.language,outline);
        const automaticTheme = d.theme === (d.themeRecommendation?.theme ?? 'notebook');
        if (!d.outline.length && automaticTheme && !d.powerPointStyle) {
          const recommendation = recommendLessonTheme(d.topic,
            isTemplate(d.template) ? lessonTemplates[d.template].theme : undefined, savedPlan?.theme);
          d.theme = recommendation.theme;
          d.themeRecommendation = recommendation;
        }
        d.outline.push(item);
        this.store.transaction(() => this.save(d, 'Outline item ready', 'outline', { runId: run.id }));
      }
      const nextRun = this.store.transaction(() => {
        const review = this.store.get<Run>('runs', run.id)?.review ?? run.review;
        const completed = this.recordRunResult(run, 'completed');
        return review ? undefined : this.queueSlides(completed, undefined, true);
      });
      if (nextRun) this.launch(nextRun);
      return;
    }
    const ids = d.slides
      .filter((s) => s.status !== 'ready' && (!run.target || s.id === run.target))
      .map((s) => s.id);
    const generatedVersions: Record<string, number> = {};
    let failed = 0;
    let refusal:string|undefined;
    for (const id of ids) {
      if (!this.current(run)) return;
      d = this.deck(run.deckId);
      const slide = d.slides.find((s) => s.id === id);
      if (!slide || slide.status === 'ready') continue;
      const index = d.outline.findIndex((item) => item.id === id),
        item = d.outline[index];
      if (!item) continue;
      const baseVersion = slide.version;
      slide.status = 'generating';
      delete slide.moderationNotice;
      this.store.transaction(() =>
        this.save(d, 'Generating slide', 'slide', { slideId: id, runId: run.id }),
      );
      let result: Partial<Slide>;
      try {
        await sleep(this.delay, undefined, { signal });
        result =
          d.provider === 'local' && d.source
            ? await runGenerationStep(()=>groundedSlide(this.store,d,item,index,run.answers,signal),signal)
            : d.provider !== 'fixture'
            ? await runGenerationStep(()=>composeLessonSlide(d, item, index, {
                signal, preferences: run.answers, mediaRoot: this.mediaRoot,
              }),signal)
            : d.research ? researchSlide(d, item) : fixtureSlide(d, item, index, run.answers);
        result = completeAssessment(d,item,result,run.answers);
        result = await applyImageMode(d, item, index, result, requestedImageMode(d.imageMode, run.answers), this.mediaRoot, signal);
        await requireSuitable(result,d.language,'output',signal);
      } catch (error) {
        if (!this.current(run) || signal.aborted) return;
        const fresh = this.deck(run.deckId);
        const target = fresh.slides.find(s=>s.id === id);
        if (target?.version === baseVersion && target.status === 'generating') {
          target.status = 'failed';
          failed++;
          if (error instanceof ModerationError) { refusal=error.message; target.moderationNotice=error.message; }
          this.store.transaction(()=>this.save(fresh,'Slide generation failed','slide',{slideId:id,runId:run.id,
            ...(error instanceof ModerationError && {message:error.message})}));
        }
        continue;
      }
      if (!this.current(run)) return;
      const fresh = this.deck(run.deckId),
        target = fresh.slides.find((s) => s.id === id);
      if (!target || target.version !== baseVersion || target.status !== 'generating') continue;
      Object.assign(target, result, { status: 'ready', version: target.version + 1 });
      if (fresh.powerPointStyle && !target.diagram && !(target.image && (fresh.imageMode === 'image-led' || fresh.imageMode === 'illustrated'))) {
        const layouts=fresh.powerPointStyle.layouts;
        const preferred=index===0 ? 'centered' : target.image || target.table || target.chart ? 'split' : 'stacked';
        const templateLayout=layouts.find(layout=>layout.layout===preferred) ?? layouts[0];
        target.layout=templateLayout.layout;
        target.powerPointLayoutId=templateLayout.id;
      }
      generatedVersions[id] = target.version;
      this.store.transaction(() =>
        this.save(fresh, 'Slide ready', 'slide', { slideId: id, runId: run.id }),
      );
    }
    if (this.current(run)) {
      const completed = this.endRun(run, failed ? 'failed' : 'completed', failed ? refusal ?? 'Retry the slides marked as failed.' : undefined, false, generatedVersions);
      if (completed.qualityReview?.state === 'pending') this.qualityQueue.enqueue(completed.id);
    }
  }

  private endRun(run: Run, status: 'completed' | 'failed' | 'cancelled', message?: string, moderated=false, generated?: Record<string, number>) {
    return this.store.transaction(() => this.recordRunResult(run, status, message, moderated, generated));
  }

  private recordRunResult(run: Run, status: 'completed' | 'failed' | 'cancelled', message?: string, moderated=false, generated?: Record<string, number>) {
    const d = this.deck(run.deckId);
    this.store.put('runs', run.id, { ...(this.store.get<Run>('runs', run.id) ?? run), active: false });
    if (moderated && run.stage==='outline') d.outlineModerationNotice=message;
    if (run.stage === 'outline') d.outlineStatus = status === 'completed' ? 'complete' : 'failed';
    if (run.stage === 'slides') {
      const affected = d.slides.filter((s) => (!run.target || s.id === run.target) && (s.status === 'pending' || s.status === 'generating'));
      for (const s of affected) {
        if (status === 'cancelled') s.status = 'cancelled';
        if (status === 'failed') s.status = 'failed';
      }
      d.phase = 'editing';
      if (status === 'completed' && generated && d.slides.length && d.slides.every(slide => slide.status === 'ready')) {
        this.store.usage.deckEvent(d,'ready','once');
        d.qualityReview = { state: 'pending', key: randomUUID(), repair: generated };
      }
    }
    return this.save(d, message ?? status, 'run', {
      runId: run.id,
      status,
      ...(message && { message }),
      ag:
        status === 'failed'
          ? RunErrorEventSchema.parse({ type: 'RUN_ERROR', message: message ?? 'Generation failed' })
          : RunFinishedEventSchema.parse({
              type: 'RUN_FINISHED',
              threadId: d.id,
              runId: run.id,
              outcome: { type: status === 'cancelled' ? 'cancelled' : 'success' },
            }),
    });
  }
  cancel(id: string) {
    const run = this.active(id);
    if (!run) return this.deck(id);
    const d = this.endRun(run, 'cancelled');
    this.controllers.get(run.id)?.abort();
    return d;
  }
  retryOutline(id: string) {
    const d = this.deck(id);
    if (this.active(id) || d.phase !== 'outline' || d.outlineStatus !== 'failed')
      throw new ApiError(409, 'Outline cannot be retried in this state.', d);
    const previous = this.store.all<Run>('runs').find((r) => r.deckId === id && r.stage === 'outline');
    if (!previous) throw new ApiError(409, 'No outline run to retry.', d);
    const run = { ...previous, id: randomUUID(), active: true };
    d.outlineStatus = 'generating';
    delete d.outlineModerationNotice;
    this.store.transaction(() => {
      this.save(d, 'Retry outline', 'outline');
      this.register(d, run);
    });
    this.launch(run);
    return d;
  }
  generate(id: string, target?: string) {
    const d = this.deck(id);
    const busy = this.active(id);
    if (busy) {
      if (target) throw new ApiError(409, 'A generation run is already active.', d);
      if (busy.stage === 'outline') this.store.put('runs', busy.id, { ...busy, review: false });
      return d;
    }
    const run = this.store.transaction(() => this.queueSlides(d, target));
    if (run) this.launch(run);
    return d;
  }

  private queueSlides(d: Deck, target?: string, automatic = false) {
    if (!d.outline.length) throw new ApiError(409, 'The outline is not ready.', d);
    if (d.phase === 'outline' && !d.slides.length && d.template !== 'blank' && d.outline.length < minGeneratedSlides) {
      throw new ApiError(400, 'Add at least 3 slides to the lesson outline before generating.', d);
    }
    if (target) {
      const slide = getSlide(d, target);
      if (slide.status === 'ready') return;
    }
    if (!d.slides.length) d.slides = d.outline.map(blankSlide);
    if (d.slides.every((s) => s.status === 'ready')) return;
    d.phase = 'generating';
    d.outlineStatus = 'complete';
    const run: Run = {
      id: randomUUID(),
      deckId: d.id,
      active: true,
      stage: 'slides',
      review: false,
      count: d.outline.length,
      target,
      answers: this.store.all<Run>('runs').find((r) => r.deckId === d.id && r.stage === 'outline')?.answers,
    };
    if (!automatic && !target) this.store.usage.deckEvent(d, 'approve', 'once');
    this.save(d, 'Generation started', 'run');
    this.register(d, run);
    return run;
  }
  edit(id: string, op: EditOp, operationId?: string, baseRevision?: number) {
    return this.editWithReceipt(id, op, operationId, baseRevision).deck;
  }
  // The room update and its ordinary deck revision share the caller's SQLite transaction.
  saveSharedText(deck:Deck, slideId:string, baseVersion:number, changes:Partial<Pick<Slide,'title'|'body'|'notes'>>) {
    this.applyOperation(deck,{kind:'slide',slideId,baseVersion,changes});
    this.save(deck,'Teacher edit','slide',{slideId});
  }
  editWithReceipt(id: string, op: EditOp, operationId?: string, baseRevision?: number) {
    return this.store.transaction(() => {
      const d = this.deck(id);
      if (operationId) {
        const saved = this.store.operation<EditOp | EditReceipt>(id, operationId);
        if (saved) {
          const previous = 'op' in saved ? saved : { op: saved };
          if (JSON.stringify(previous.op) !== JSON.stringify(op))
            throw new ApiError(409, 'Operation id already used.', d);
          return { deck: d, revision: previous.revision };
        }
      }
      if (baseRevision !== undefined && baseRevision !== d.revision && op.kind !== 'slide')
        throw new ApiError(409, 'Lesson revision changed.', d);
      this.applyOperation(d, op);
      this.save(
        d,
        'Teacher edit',
        op.kind === 'outline' ? 'outline' : 'slide',
        op.kind === 'slide' ? { slideId: op.slideId } : {},
      );
      const revision = d.phase === 'editing' ? d.revision : undefined;
      if (operationId) this.store.recordOperation(id, operationId, { op, revision });
      return { deck: d, revision };
    });
  }
  private applyOperation(deck: Deck, op: LessonEdit) {
    try {
      applyLessonEdit(deck, op, {
        outlineRunActive: op.kind === 'outline' && Boolean(this.active(deck.id)),
        copySource:op.kind==='copySlides' && op.sourceDeckId!==deck.id ? this.deck(op.sourceDeckId) : undefined,
        newId: randomUUID,
      });
    } catch (error) {
      if (!(error instanceof LessonEditError)) throw error;
      const status = { 'not-found': 404, conflict: 409, invalid: 400 }[error.code];
      throw new ApiError(status, error.message, status === 400 ? undefined : deck);
    }
  }

  previewAssistantBatch(original: Deck, operations: AssistantOperation[]) {
    const draft = structuredClone(original);
    for (const op of operations) {
      if (op.kind === 'slide') {
        const slide = getSlide(draft, op.slideId);
        this.applyOperation(draft, { ...op, baseVersion: slide.version });
        for (const key of op.clear ?? []) delete slide[key];
      } else this.applyOperation(draft, op);
    }
    return draft;
  }

  // The assistant records its decision and this revision in the same SQLite transaction.
  commitAssistantBatch(original: Deck, operations: AssistantOperation[], proposalId: string) {
    const draft = this.previewAssistantBatch(original, operations);
    return this.save(draft, 'Assistant edits applied', 'proposal', { proposalId });
  }

  // The caller keeps the proposal decision and the restored revision in one transaction.
  restoreAssistantBatch(id: string, previousRevision: number, appliedRevision: number) {
    return this.restoreSnapshot(id, previousRevision, appliedRevision, 'undo');
  }

  proposals(id: string) {
    this.deck(id);
    return this.store
      .all<StoredProposal>('proposals')
      .filter((p) => p.deckId === id && p.status === 'pending');
  }
  async propose(id: string, sid: string, instruction: string) {
    const d = this.deck(id),
      before = getSlide(d, sid);
    if (before.status !== 'ready') throw new ApiError(409, 'The slide is not ready.', d);
    await requireSuitable(instruction,d.language,'instruction');
    let after = fixtureProposal(before, d.language, instruction);
    if (d.provider === 'alem' && !d.source) {
      const { reviseSlide } = await import('../authoring/alem');
      const changes = await reviseSlide(d.language, before, instruction);
      after = { ...structuredClone(before), ...changes };
      delete after.richText;
      delete after.bodyRuns;
    }
    await requireSuitable(after,d.language,'output');
    const p: StoredProposal = {
      id: randomUUID(),
      slideId: sid,
      baseVersion: before.version,
      before,
      after,
      status: 'pending',
      deckId: id,
    };
    this.store.transaction(() => {
      this.store.put('proposals', p.id, p);
      this.store.usage.deckEvent(d,'proposal','rewrite-'+p.id,'rewrite-'+p.id);
      this.event(this.deck(id), 'proposal', { slideId: sid, proposalId: p.id });
    });
    return p;
  }
  decide(id: string, pid: string, action: 'apply' | 'dismiss') {
    return this.store.transaction(() => {
      const d = this.deck(id),
        p = this.store.get<StoredProposal>('proposals', pid);
      if (!p || p.deckId !== id) throw new ApiError(404, 'Proposal not found.');
      const next = action === 'apply' ? 'applied' : 'dismissed';
      if (p.status === next) return d;
      if (p.status !== 'pending') throw new ApiError(409, 'Proposal already decided.', d);
      if (action === 'apply') {
        const s = getSlide(d, p.slideId);
        if (s.version !== p.baseVersion || s.status !== 'ready')
          throw new ApiError(409, 'The slide changed since the proposal was created.', d);
        d.slides[d.slides.indexOf(s)] = { ...p.after, version: s.version + 1 };
        this.save(d, 'Assistant proposal applied', 'proposal', { slideId: s.id, proposalId: p.id });
      } else this.event(d, 'proposal', { slideId: p.slideId, proposalId: p.id });
      this.store.put('proposals', pid, { ...p, status: next });
      return d;
    });
  }
  revisions(id: string): Revision[] {
    this.deck(id);
    return this.store.db
      .prepare('SELECT data,reason FROM revisions WHERE deck_id=? ORDER BY revision DESC')
      .all(id)
      .map((row) => {
        const d = JSON.parse(String(row.data)) as Deck;
        return { revision: d.revision, at: d.updatedAt, reason: String(row.reason), deck: d };
      });
  }
  restore(id: string, rev: number, baseRevision?: number, intent: RestoreIntent = 'restore', operationId?: string) {
    if (intent === 'restore') return this.restoreSnapshot(id, rev, baseRevision, intent, operationId);
    return this.store.transaction(() => this.restoreSnapshot(id, rev, baseRevision, intent, operationId));
  }
  private restoreSnapshot(id: string, rev: number, baseRevision: number | undefined, intent: RestoreIntent, operationId?: string) {
    const d = this.deck(id);
    const operationKey = operationId && 'restore:' + operationId;
    const signature = JSON.stringify([rev, baseRevision, intent]);
    const readSnapshot = (revision: number) => {
      const row = this.store.db
        .prepare('SELECT data FROM revisions WHERE deck_id=? AND revision=?')
        .get(id, revision);
      if (!row) throw new ApiError(404, 'Revision not found.');
      return JSON.parse(String(row.data)) as Deck;
    };
    const previous = operationKey ? this.store.operation<RestoreReceipt>(id, operationKey) : undefined;
    if (previous) {
      if (previous.signature !== signature) throw new ApiError(409, 'Operation id already used.', d);
      return readSnapshot(previous.revision);
    }
    if (baseRevision !== undefined && baseRevision !== d.revision)
      throw new ApiError(409, 'Lesson revision changed.', d);
    const restored = readSnapshot(rev);
    const active = this.active(id);
    if (intent !== 'restore' && (baseRevision === undefined || active || d.phase !== 'editing' || restored.phase !== 'editing' || rev >= baseRevision))
      throw new ApiError(409, 'Lesson history is unavailable for this revision.', d);
    if (active) this.cancel(id);
    restored.outlineStatus = this.recoveredOutlineStatus(restored);
    restored.revision = this.deck(id).revision;
    for (const s of restored.slides) {
      s.version = Math.max(s.version + 1, restored.revision + 1);
      if (s.status === 'generating' || s.status === 'pending') s.status = 'cancelled';
    }
    delete restored.qualityReview;
    restored.phase = restored.slides.length ? 'editing' : 'outline';
    const persist = () => {
      this.save(restored,'Restored revision '+rev,'slide');
      this.store.usage.restored(restored,rev,intent);
      if (operationKey) this.store.recordOperation(id, operationKey, { signature, revision: restored.revision });
      return restored;
    };
    return intent === 'restore' ? this.store.transaction(persist) : persist();
  }
  async close() {
    await this.qualityQueue.close();
    for (const [id,controller] of this.controllers) {
      const run = this.store.get<Run>('runs',id);
      if (run?.active) this.endRun(run,'failed','Generation interrupted by server shutdown. Retry unfinished work.');
      controller.abort();
    }
    await Promise.allSettled([...this.workers]);
    this.store.db.close();
  }
}
