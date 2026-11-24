import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { narrationPrompts, narrationSource, spokenNotesDraft } from '@sabaq/lesson/narration';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import { ModerationError, requireSuitable } from '../authoring/moderation';
import { z } from 'zod';
import type { AssistantActivity, AssistantAttachment, AssistantDecision, AssistantMessage, AssistantProposal, AssistantSnapshot, AssistantWebSource } from '@sabaq/contracts/assistant';
import type { LessonCitation } from '@sabaq/contracts/retrieval';
import { deckThemes, type Deck, type Locale } from '@sabaq/lesson/types';
import type { SourceFileDetail } from '@sabaq/contracts/source-files';
import { themePresets } from '@sabaq/lesson/themes';
import { hasAlem } from '../authoring/alem';
import { researchDocument } from '../authoring/research';
import { runLessonAgent, type AgentAnswer } from '@sabaq/agent/decisions';
import { AssistantToolError, findCanvasObject, prepareAssistantTool } from '@sabaq/agent/tools';
import { askAlem, askOllama, rewriteLectureNotes, rewriteSlideBody } from './assistant-agent';
import { assistantCopy, chartFromSlideTable, imageRemovalRequest, isSimpleShortening, localAssistant, mentionedSlideNumber, moveSlideImageBesideText, namedThemeRequest, removeSlideImage, shorteningProposal, shortenSlide } from '@sabaq/agent/local-commands';
import { AssistantMemory } from './assistant-memory';
import { findLocalModel, loopbackService } from './local-model';
import { lessonPassages, readLessonOutline, readLessonSlide } from './lesson-passages';
import { searchLesson } from './lesson-retrieval';
import { jevAssessment } from './jev';
import { localAuthoringModel } from '../authoring/local-generation';
import type { AssistantOperation } from '@sabaq/lesson/editing';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';
import type { Principal } from '../access/access';
import { hasImageProvider, illustrationCatalog, resolveSlideIllustration } from '../media/visuals';
import { SourceLibrary } from '../media/source-library';
import { scopeCanvasEdits, type ScopedAction } from './canvas-edits';
import { assistantWebResearchAvailable, searchAssistantWeb, webResearchFallback, WebResearchError, writeWebAnswer } from './web-research';

const identifier = z.string().min(1).max(160);
export const assistantInput = z.object({
  clientId:identifier, text:z.string().trim().min(1).max(6000),
  slideId:identifier.optional(), locale:z.enum(['en','ru','kk']),
  canvasScope:z.discriminatedUnion('field', [
    z.strictObject({field:z.enum(['slide','title','body']),selection:z.strictObject({
      start:z.number().int().nonnegative().max(10000),end:z.number().int().min(1).max(10000),text:z.string().min(1).max(10000),
    }).optional()}),
    z.strictObject({field:z.literal('object'),objectId:identifier,version:z.number().int().nonnegative(),theme:z.enum(deckThemes)}),
  ]).optional(),
  attachments:z.array(z.object({
    name:z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/u),
    text:z.string().trim().min(1).max(12000),
  })).min(1).max(2).optional(),
  attachmentTurnId:identifier.optional(),
  sourceFileIds:z.array(z.uuid()).min(1).max(2).optional(),
  searchSourceLibrary:z.literal(true).optional(),
  useCloudSourceRag:z.literal(true).optional(),
  webResearch:z.enum(['search','research']).optional(),
});
export const assistantCancelInput = assistantInput.pick({clientId:true});
type Input = z.infer<typeof assistantInput>;
type Turn = {
  input:Input;
  user:AssistantMessage;
  assistant:AssistantMessage;
  localOnly?:boolean;
  attachmentOriginId?:string;
  sourceFileIds?:string[];
  requestDigest?:string;
  privateTo?:Pick<Principal,'org'|'subject'>;
  plan?:{ baseRevision:number; operations:AssistantOperation[]; appliedRevision?:number; restoredRevision?:number };
};

type Sources = { selected?: SourceFileDetail[]; legacy?: AssistantAttachment[] };
const inputDigest = (input: Input) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const cloudSourceRagAvailable = () => process.env.STUDIO_CLOUD_SOURCE_RAG === '1' && hasAlem();
const canReadTurn = (turn: Turn, principal?: Principal) => !turn.privateTo ||
  turn.privateTo.org===principal?.org && turn.privateTo.subject===principal?.subject;

function selectAttachmentPassages(documents: LessonCitation[][], query: string, limit: number) {
  const terms = new Set((query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(term => term.length > 2 || /^\p{N}+$/u.test(term)));
  const score = (hit: LessonCitation) => {
    const words = new Set(hit.excerpt.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu));
    let matches = 0;
    for (const term of terms) if (words.has(term)) matches++;
    return matches;
  };
  const ranked = documents.map(chunks => chunks.map(hit => ({hit, score:score(hit)})).sort((a,b) => b.score-a.score));
  // Keep a source from each attachment before filling the remaining slots with relevant passages.
  const representatives = ranked.flatMap(items => items.slice(0,1)).sort((a,b) => b.score-a.score);
  const additional = ranked.flatMap(items => items.slice(1)).sort((a,b) => b.score-a.score);
  return [...representatives, ...additional].slice(0,limit).map(({hit}) => hit);
}

function describeLesson(deck: Deck, slideId: string | undefined, targetSlideId: string | undefined) {
  const active = deck.slides.findIndex(slide=>slide.id===slideId);
  const target = deck.slides.find(slide=>slide.id===(targetSlideId ?? slideId));
  return {
    title:deck.title, topic:deck.topic, language:deck.language, theme:deck.theme, phase:deck.phase, revision:deck.revision,
    activeSlideId:slideId, targetSlideId,
    ...(active>=0 && {activeSlide:{id:slideId,number:active+1,title:deck.slides[active].title,version:deck.slides[active].version}}),
    ...(target && {selectedContent:{id:target.id,body:target.body.slice(0,4000),notes:target.notes.slice(0,1600),
      answer:target.answer,table:target.table,chart:target.chart,design:target.design,illustrationAlt:target.image?.alt}}),
    slides:deck.slides.map((slide,index) => ({
      id:slide.id,number:index+1,status:slide.status,title:slide.title,layout:slide.layout,
    })),
  };
}

function slideChanges(original: Deck, draft: Deck, selectedId?: string): NonNullable<AssistantProposal['changes']> {
  const after = new Map(draft.slides.map(slide=>[slide.id,slide]));
  const changes: NonNullable<AssistantProposal['changes']> = [];
  for (const slide of original.slides) {
    const next = after.get(slide.id);
    after.delete(slide.id);
    if (!next || JSON.stringify(slide)!==JSON.stringify(next))
      changes.push({slideId:slide.id,before:slide,after:next});
  }
  for (const slide of after.values()) changes.push({slideId:slide.id,after:slide});
  if (original.theme!==draft.theme && changes.length<4) {
    const representative = original.slides.find(slide=>slide.id===selectedId && slide.status==='ready')
      ?? original.slides.find(slide=>slide.status==='ready');
    if (representative && !changes.some(change=>change.slideId===representative.id)) {
      const next = draft.slides.find(slide=>slide.id===representative.id);
      if (next) changes.push({slideId:representative.id,before:representative,after:next});
    }
  }
  return changes;
}

// Bound the number of full transcript frames, and keep words and graphemes intact.
function* replyPrefixes(reply: string) {
  const frameSize = Math.max(14, Math.ceil(reply.length / 16));
  let end = 0;
  let lastFrame = 0;
  for (const match of reply.matchAll(/\S+\s*|\s+/gu)) {
    end += match[0].length;
    if (end - lastFrame >= frameSize && end < reply.length) {
      yield reply.slice(0, end);
      lastFrame = end;
    }
  }
}

export class DeckAssistant {
  private running = new Map<string, { clientId: string; controller: AbortController; turn: Turn }>();
  readonly memory: AssistantMemory;

  constructor(private studio: Studio, private mediaRoot: string, private sources = new SourceLibrary(studio.store)) {
    this.memory = new AssistantMemory(studio);
  }

  private history(deckId: string, principal?: Principal) {
    return this.studio.store.assistantTurns<Turn>(deckId).filter(turn=>canReadTurn(turn,principal)).map((turn) => {
      if (turn.assistant.status === 'running') {
        const job = this.running.get(deckId);
        if (job?.clientId !== turn.input.clientId) return this.stopTurn(deckId, turn);
        if (job.turn.assistant.streamingText) turn.assistant.streamingText = job.turn.assistant.streamingText;
      }
      return turn;
    });
  }

  get(deckId: string, principal?: Principal): AssistantSnapshot {
    this.studio.deck(deckId);
    const active = this.running.get(deckId);
    return {
      messages:this.history(deckId,principal).flatMap(({user,assistant})=>[user,assistant]),
      activeClientId:active && canReadTurn(active.turn,principal) ? active.clientId : undefined,
      ...this.memory.list(deckId),
    };
  }

  private save(deckId: string, turn: Turn) {
    this.studio.store.saveAssistantTurn(deckId, turn.input.clientId, turn);
  }

  private stopTurn(deckId: string, turn: Turn) {
    this.settleActivity(turn,'cancelled');
    const text = turn.assistant.streamingText || (turn.assistant.status === 'cancelled' ? turn.assistant.text : assistantCopy[turn.input.locale].stopped);
    delete turn.assistant.streamingText;
    turn.assistant = {...turn.assistant, text, status:'cancelled'};
    this.save(deckId,turn);
    return turn;
  }

  private settleActivity(turn:Turn, status:'cancelled'|'error') {
    for (const activity of turn.assistant.activity ?? []) {
      if (activity.status === 'running') activity.status = status;
    }
  }

  open(deckId: string, input: Input, principal?: Principal) {
    const deck = this.studio.deck(deckId);
    const saved = this.studio.store.assistantTurn<Turn>(deckId, input.clientId);
    if (saved) {
      if (!canReadTurn(saved,principal)) throw new ApiError(404,'Message not found.');
      const matches = saved.requestDigest ? saved.requestDigest===inputDigest(input) : JSON.stringify(saved.input)===JSON.stringify(input);
      if (!matches) throw new ApiError(409,'Message already used.');
      return { events:[this.get(deckId,principal)], disconnect:()=>undefined };
    }
    if (this.running.has(deckId)) throw new ApiError(409,'A response is already running.');
    const {attachments,attachmentTurnId,sourceFileIds,searchSourceLibrary,canvasScope,webResearch} = input;
    if (webResearch && (attachments || attachmentTurnId || sourceFileIds || searchSourceLibrary || canvasScope || input.useCloudSourceRag))
      throw new ApiError(400,'Send a public web query separately from files or selected canvas content.');
    if (webResearch && !assistantWebResearchAvailable())
      throw new ApiError(503,'Web research is unavailable.');
    if ([attachments,attachmentTurnId,sourceFileIds,searchSourceLibrary].filter(Boolean).length>1)
      throw new ApiError(400,'Choose one source option for this message.');
    const current = input.slideId && deck.slides.find(({id})=>id===input.slideId);
    if (input.slideId && !current) throw new ApiError(404,'Slide not found.');
    if (canvasScope && (!current || current.status!=='ready')) throw new ApiError(409,'Select a ready slide.');
    if (canvasScope?.field==='object') {
      if (!current || current.version!==canvasScope.version || canvasScope.theme!==deck.theme || !findCanvasObject(deck,current,canvasScope.objectId))
        throw new ApiError(409,'The selected object changed. Select it again.');
    } else if (canvasScope?.selection) {
      const {field,selection:{start,end,text}}=canvasScope;
      if (!current || field==='slide' || end<=start || current[field].slice(start,end)!==text)
        throw new ApiError(409,'The selected text changed. Select it again.');
    }
    let ids = sourceFileIds;
    let all = searchSourceLibrary;
    let legacy: AssistantAttachment[] | undefined;
    let attachmentOriginId: string | undefined;
    if (attachmentTurnId) {
      const prior = this.studio.store.assistantTurn<Turn>(deckId,attachmentTurnId);
      if (!prior || !canReadTurn(prior,principal)) throw new ApiError(404,'Attachments were not found in this lesson.');
      const origin = prior.attachmentOriginId ? this.studio.store.assistantTurn<Turn>(deckId,prior.attachmentOriginId) : prior;
      if (!origin || !canReadTurn(origin,principal)) throw new ApiError(404,'Attachments were not found in this lesson.');
      ids = origin.sourceFileIds ?? origin.input.sourceFileIds;
      all = origin.input.searchSourceLibrary;
      legacy = origin.input.attachments;
      if (!ids && !all && !legacy) throw new ApiError(404,'Attachments were not found in this lesson.');
      attachmentOriginId = origin.input.clientId;
    }
    if (input.useCloudSourceRag) {
      if (!attachments && !ids && !all && !legacy) throw new ApiError(400,'Choose source files before sharing excerpts with Alem.');
      if (!cloudSourceRagAvailable()) throw new ApiError(503,'Cloud answers for source files are unavailable.');
    }
    const savedLegacy = attachments && this.sources.saveLegacyAttachments(attachments,principal).map(file=>file.id);
    const selection = ids ?? savedLegacy;
    const selected = selection && this.sources.detailsFor(selection,principal);
    const number = mentionedSlideNumber(input.text);
    const slideId = canvasScope || number === undefined ? (current ? current.id : undefined) : deck.slides[number-1]?.id;
    const controller = new AbortController();
    const fileNames = (attachments ?? selected ?? legacy)?.map(file => file.name);
    const hadPreferences = this.memory.list(deckId).memory.length > 0;
    const privateTo = principal && (selected || all || legacy) && {org:principal.org, subject:principal.subject};
    const {attachments:_discard,...storedInput} = input;
    const turn: Turn = {
      input:storedInput,
      user:{id:'user-'+input.clientId,role:'user',text:input.text,slideId,...(canvasScope && {canvasScope}),...(webResearch && {webResearch}),
        ...(fileNames && {fileNames}),...(all && {searchedSourceLibrary:true})},
      assistant:{id:'assistant-'+input.clientId,role:'assistant',text:assistantCopy[input.locale].loading,slideId,status:'running'},
      // Interrupted and unmoderated turns are private until their routing decision is complete.
      localOnly:true,
      ...(attachmentOriginId && {attachmentOriginId}),
      ...(savedLegacy && {sourceFileIds:savedLegacy,requestDigest:inputDigest(input)}),
      ...(privateTo && {privateTo}),
    };
    const earlier = this.history(deckId,principal);
    this.save(deckId,turn);
    this.running.set(deckId,{clientId:input.clientId,controller,turn});
    const sources = selected || all || legacy ? {selected,legacy} : undefined;
    return { events:this.run(deck,turn,earlier,controller.signal,hadPreferences,sources,principal), disconnect:()=>controller.abort() };
  }

  cancel(deckId: string, clientId: string, principal?: Principal) {
    this.studio.deck(deckId);
    const job = this.running.get(deckId);
    if (job?.clientId === clientId) {
      if (!canReadTurn(job.turn,principal)) throw new ApiError(404,'Message not found.');
      job.controller.abort();
      this.running.delete(deckId);
      if (job.turn.assistant.status === 'running') this.stopTurn(deckId,job.turn);
    }
    return this.get(deckId,principal);
  }

  abortAll() {
    for (const job of this.running.values()) job.controller.abort();
  }

  private async *run(deck: Deck, turn: Turn, history: Turn[], signal: AbortSignal, hadPreferences:boolean, sources?: Sources, principal?: Principal) {
    const {text,locale,clientId,canvasScope,webResearch} = turn.input;
    const ui = assistantCopy[locale];
    const slideId = turn.user.slideId;
    const focus = deck.slides.find(({id})=>id===slideId);
    const selectedObject = focus && canvasScope?.field==='object' ? findCanvasObject(deck,focus,canvasScope.objectId) : undefined;
    const activeSlideId = turn.input.slideId;
    const research = deck.research?.sources;
    const publicSource = research?.length ? researchDocument(deck.language,research) : undefined;
    const privateSource = deck.source && (deck.source.name!==publicSource?.name || deck.source.text!==publicSource?.text);
    const useAlem = deck.provider==='alem' && !privateSource && hasAlem();
    const allowGeneratedImages = useAlem && hasImageProvider();
    const snapshot = () => this.get(deck.id,principal);
    const begin = (kind:AssistantActivity['kind'], target?:string) => {
      signal.throwIfAborted();
      const activity = turn.assistant.activity ??= [];
      const step:AssistantActivity = {id:String(activity.length+1),kind,status:'running',slideId:target};
      activity.push(step);
      this.save(deck.id,turn);
      return step;
    };
    const finish = (step:AssistantActivity, status:'complete'|'error'='complete', details?:Pick<AssistantActivity,'count'|'mode'>) => {
      signal.throwIfAborted();
      Object.assign(step,{status},details);
      this.save(deck.id,turn);
    };
    try {
      yield snapshot();
      signal.throwIfAborted();
      await requireSuitable(text,locale,'instruction',signal);
      const theme = sources || canvasScope ? undefined : namedThemeRequest(text);
      const slideScope = !canvasScope || canvasScope.field==='slide';
      const imageRemoval = slideScope && !sources && imageRemovalRequest(text);
      const localModel = process.env.STUDIO_ASSISTANT_OLLAMA_MODEL?.trim();
      const localOrigin = loopbackService(process.env.STUDIO_OLLAMA_URL || 'http://127.0.0.1:11434');
      const speech = !sources && !canvasScope && Object.values(narrationPrompts).includes(text.trim());
      const short = !sources && (slideScope || canvasScope.field==='body' && !canvasScope.selection) && isSimpleShortening(text);
      const chart = short || sources || (canvasScope && canvasScope.field!=='slide') ? undefined : chartFromSlideTable(focus,text,locale,deck.language);
      const scopedNumber = canvasScope ? mentionedSlideNumber(text) : undefined;
      const sideTarget = scopedNumber === undefined || deck.slides[scopedNumber-1]?.id === slideId ? focus : undefined;
      const sideEdit = !webResearch && !sources && (!canvasScope || canvasScope.field === 'slide')
        ? moveSlideImageBesideText(sideTarget,text,locale,deck.language) : undefined;
      const hasPreferences = hadPreferences || this.memory.list(deck.id).memory.length>0;
      const privateContext = Boolean(webResearch || speech || sources || privateSource || hasPreferences || !useAlem);
      const cloudSources = Boolean(sources && turn.input.useCloudSourceRag);
      const wantsLocal = privateContext && !cloudSources;
      turn.localOnly = privateContext;
      const context = cloudSources ? [] : history.filter(previous=>(!previous.privateTo || turn.privateTo) && (wantsLocal || previous.localOnly===false)).slice(-8);
      const localConnection = async (model=localModel) => {
        if (!wantsLocal || !localOrigin || !model) return;
        const tag = await findLocalModel(localOrigin,model,signal);
        if (tag) return {origin:localOrigin,model:tag.name};
      };
      const localCommand = wantsLocal && !sources && !canvasScope && !short && !chart ? localAssistant(deck,focus,text,locale) : undefined;
      let result: AgentAnswer;
      let webSources: AssistantWebSource[] | undefined;
      if (webResearch) {
        const activity = begin(webResearch === 'research' ? 'web_research' : 'web_search');
        yield snapshot();
        const found = await searchAssistantWeb(text,webResearch,locale,signal);
        webSources = found.sources;
        finish(activity,'complete',{count:webSources.length});
        let reply = found.notice;
        if (webSources.some(source=>source.excerpt)) {
          reply = webResearchFallback[locale];
          if (hasAlem()) {
            const drafting = begin('write_web_answer');
            yield snapshot();
            let answer: string | undefined;
            try {
              answer = await writeWebAnswer(text,webResearch,locale,webSources,signal);
            } catch { signal.throwIfAborted(); }
            if (answer) reply = answer;
            finish(drafting,answer ? 'complete' : 'error');
          }
        }
        await requireSuitable({text:reply,sources:webSources},locale,'output',signal);
        result = {reply,actions:[]};
        yield snapshot();
      } else if (theme) {
        result = {reply:ui.prepared,actions:[{tool:'edit_deck',theme}]};
      } else if (speech) {
        const inspection=begin('read_slide',slideId);
        const original=focus?.status==='ready' ? narrationSource(focus) : '';
        finish(inspection,'complete',{count:original ? 1 : 0});
        yield snapshot();
        let notes=original ? spokenNotesDraft(original,deck.language) : '';
        if (original) {
          try {
            const connection=await localConnection(localModel || localAuthoringModel());
            if(connection) notes=await rewriteLectureNotes(original,deck.language,connection,signal) ?? notes;
          } catch { signal.throwIfAborted(); }
        }
        result=focus && notes && notes!==focus.notes ? {
          reply:ui.prepared,actions:[{tool:'edit_slide',slideId:focus.id,changes:{notes}}],
        } : {reply:ui.empty,actions:[]};
      } else if (short) {
        const inspection = begin('inspect_slide',slideId);
        finish(inspection,'complete',{count:focus ? 1 : 0});
        if (focus?.status === 'ready' && focus.body.trim()) {
          const shortening = begin('shorten_text',focus.id);
          yield snapshot();
          signal.throwIfAborted();
          result = shortenSlide(focus,locale,deck.language);
          try {
            if (!result.actions.length) {
              const connection = wantsLocal ? await localConnection(localModel || localAuthoringModel()) : 'alem';
              if (connection) {
                let preferences: string[] | undefined;
                if (wantsLocal && hasPreferences) {
                  const recall = begin('recall_preferences');
                  yield snapshot();
                  preferences = await this.memory.recall(deck.id,text,signal);
                  finish(recall,'complete',{count:preferences.length});
                }
                const body = await rewriteSlideBody({body:focus.body.trim(),language:deck.language,preferences},connection,signal);
                if (body) result = shorteningProposal(focus,body,locale);
              }
            }
            finish(shortening);
          } catch {
            signal.throwIfAborted();
            this.settleActivity(turn,'error');
            finish(shortening,'error');
          }
        } else result = shortenSlide(focus,locale,deck.language);
      } else if (imageRemoval) {
        const explicitTarget = imageRemoval.slideNumber!==undefined && deck.slides[imageRemoval.slideNumber-1]?.id;
        const insideScope = !canvasScope || canvasScope.field==='slide' &&
          (imageRemoval.slideNumber===undefined || explicitTarget===slideId);
        const target = insideScope ? focus : undefined;
        finish(begin('inspect_slide',target?.id),'complete',{count:target ? 1 : 0});
        result = removeSlideImage(target,imageRemoval.index,locale);
      } else if (sideEdit) {
        finish(begin('inspect_slide',sideTarget?.id),'complete',{count:sideTarget ? 1 : 0});
        result = sideEdit;
      } else if (chart) {
        finish(begin('inspect_slide',slideId),'complete',{count:1});
        result = chart;
      } else if (localCommand && localCommand.reply!==ui.help) {
        result = localCommand;
        if (!localCommand.actions.length && focus?.notes && localCommand.reply===focus.notes) {
          const read = begin('read_slide',focus.id);
          result.citations = readLessonSlide(deck,focus.id).filter(hit=>hit.field==='notes');
          finish(read,'complete',{count:result.citations.length});
        }
      } else if (!sources && /^(?:help|what can you do|помощь|что ты умеешь|көмек|не істей аласың)[?!.]*$/iu.test(text)) {
        result = {reply:ui.help,actions:[]};
      } else {
        // Ordinary private requests stay on loopback. A source opt-in sends only looked-up excerpts.
        this.save(deck.id,turn);
        const connection = await localConnection(sources ? localModel || localAuthoringModel() : undefined);
        const local = connection && askOllama(connection);
        const model = wantsLocal ? local : askAlem;
        let preferences: string[] | undefined;
        if (local) {
          const recall = hasPreferences ? begin('recall_preferences') : undefined;
          if (recall) yield snapshot();
          preferences = await this.memory.recall(deck.id,text,signal);
          if (recall) finish(recall,'complete',{count:preferences.length});
        }
        const request = cloudSources ? {
          message:text, locale,
          lesson:{language:deck.language,activeSlideId,targetSlideId:slideId},
          canGenerateIllustrations:false,
        } : {
          message:text, locale, lesson:describeLesson(deck,activeSlideId,slideId),
          ...(canvasScope && {canvasScope:{...canvasScope,slideId,...(selectedObject && {object:selectedObject})}}),
          context:context.map(({user,assistant})=>({question:user.text.slice(0,600),slideId:user.slideId,
            reply:assistant.status==='complete' ? assistant.text.slice(0,600) : '',proposalState:assistant.proposal?.status})),
          themes:Object.entries(themePresets).map(([id,preset])=>({id,name:preset.name[locale],use:preset.use})),
          illustrations:illustrationCatalog, canGenerateIllustrations:allowGeneratedImages && !wantsLocal,
          ...(local && {preferences}),
        };
        const refersToSlide = Boolean(canvasScope) || mentionedSlideNumber(text)!==undefined || /(?:this|current|selected) slide|(?:этом|этот|текущем|выбранном) слайд|(?:осы|бұл|ағымдағы) слайд/iu.test(text);
        const attachmentPassages = sources?.legacy?.map((source,index) => lessonPassages({
          ...deck, id:`${deck.id}:${clientId}:attachment:${index}`, source, research:undefined, slides:[],
        }).map(hit => ({...hit, field:'attachment.text'})));
        const ids = sources?.selected?.map(file=>file.id);
        const sourceText = cloudSources ? '' : sources ? [deck.source?.text,...(sources.selected ?? sources.legacy ?? []).map(file=>file.text)]
          .filter(Boolean).join('\n\n') : deck.source?.text;
        const agent = runLessonAgent({
          locale,query:text,request,signal,model,
          assessSupport:jevAssessment(privateContext),
          requireInitialEvidence:cloudSources,
          sourceText,
          focusedSlide:!sources && refersToSlide ? slideId : undefined,
          search:async (query,activeSignal,limit) => {
            if (!sources) return searchLesson(this.studio.store,deck,query,activeSignal,limit,{allowAlem:!wantsLocal});
            activeSignal.throwIfAborted();
            const budget = Math.max(1,limit-1);
            const hits = attachmentPassages ? selectAttachmentPassages(attachmentPassages,query,budget)
              : this.sources.search(query,budget,principal,ids);
            if (cloudSources || hits.length>=limit) return {mode:'lexical',hits};
            const lesson = await searchLesson(this.studio.store,deck,query,activeSignal,limit-hits.length);
            return {mode:lesson.mode,hits:[...hits,...lesson.hits]};
          },
          readSlide:(id,fields) => cloudSources ? [] : readLessonSlide(deck,id,fields),
          readOutline:(start,count) => cloudSources ? [] : readLessonOutline(deck,start,count),
        });
        try {
          let activity: AssistantActivity | undefined;
          let step = await agent.next();
          while (!step.done) {
            signal.throwIfAborted();
            const event = step.value;
            if (event.status === 'running') activity = begin(event.kind,event.slideId);
            else if (activity) {
              if (event.read) (turn.assistant.reads ??= []).push(event.read);
              finish(activity,event.status,event.read && {count:event.read.count,mode:event.read.mode});
              activity = undefined;
            }
            yield snapshot();
            step = await agent.next();
          }
          result = step.value;
        } finally { await agent.return({reply:'',actions:[]}); }
      }
      signal.throwIfAborted();

      const scoped:ScopedAction[] = canvasScope && focus ? scopeCanvasEdits(result.actions,focus,canvasScope) :
        result.actions.map(action=>({action}));
      const firstAction = scoped[0]?.action;
      const target = firstAction && scoped.length===1 && 'slideId' in firstAction
        ? deck.slides.find(slide=>slide.id===firstAction.slideId)?.id : undefined;
      const validation = firstAction ? begin('validate_edit',target) : undefined;
      if (validation) yield snapshot();
      if (!webResearch)
        await requireSuitable({reply:result.reply,actions:scoped.map(({action})=>action),citations:result.citations?.map(hit=>hit.excerpt)},locale,'output',signal);
      if (validation) finish(validation);
      const operations: AssistantOperation[] = [];
      const actions = [];
      let draft = deck;
      if (scoped.length) {
        turn.assistant.text = ui.checking;
        const preparation = begin('prepare_edit',target);
        yield snapshot();
        const supplied = [...context.filter(previous=>previous.user.slideId===slideId).map(({user})=>user.text),text,
          ...(result.citations ?? []).filter(hit=>hit.kind==='source').map(hit=>hit.excerpt)].join('\n');
        // Build one proposal on a copy. No validated tool can write a deck from here.
        for (const {action,formatting} of scoped) {
          signal.throwIfAborted();
          const tool = prepareAssistantTool(action,{
            deck:draft, locale, supplied, signal, allowGeneratedImages:allowGeneratedImages && !privateContext,
            resolveIllustration:(request,activeSignal) => resolveSlideIllustration(request,{
              language:draft.language,topic:draft.topic,signal:activeSignal,mediaRoot:this.mediaRoot,...lessonImageGuidance(draft),
            }),
          });
          try {
            let stage = await tool.next();
            while (!stage.done) {
              const step = begin(stage.value.kind,stage.value.slideId);
              yield snapshot();
              signal.throwIfAborted();
              stage = await tool.next();
              finish(step);
            }
            const prepared = stage.value;
            if (!prepared) continue;
            if (formatting && prepared.operation.kind==='slide')
              Object.assign(prepared.operation.changes,formatting);
            operations.push(prepared.operation);
            actions.push(prepared.preview);
            draft = this.studio.previewAssistantBatch(draft,[prepared.operation]);
          } finally { await tool.return(undefined); }
        }
        finish(preparation,'complete',{count:operations.length});
      }
      signal.throwIfAborted();
      const editHadNoEffect = result.actions.length && !actions.length;
      const replyText = editHadNoEffect && (!sideEdit || result.reply === ui.prepared) ? ui.empty : result.reply;
      if (!webResearch && (!actions.length || replyText !== ui.prepared)) {
        // Providers return structured answers. Release only the reply that passed output and tool validation.
        const current = snapshot();
        const previous = current.messages.filter(message => message.id !== turn.assistant.id);
        for (const prefix of replyPrefixes(replyText)) {
          signal.throwIfAborted();
          turn.assistant.streamingText = prefix;
          yield {...current,messages:[...previous,{...turn.assistant}]};
          await delay(24, undefined, {signal});
        }
      }
      signal.throwIfAborted();
      delete turn.assistant.streamingText;
      const originalOrder = deck.slides.map(slide => slide.id);
      const finalOrder = draft.slides.map(slide => slide.id);
      const rearranged = originalOrder.length !== finalOrder.length || originalOrder.some((id,index) => finalOrder[index] !== id);
      turn.assistant = {...turn.assistant,
        text:replyText,
        status:'complete',
        ...(result.citations?.length && {citations:result.citations}),
        ...(webSources?.length && {webSources}),
        ...(actions.length && {proposal:{id:clientId,status:'pending',baseRevision:deck.revision,actions,changes:slideChanges(deck,draft,slideId),
          ...(rearranged && {order:{before:deck.slides.map(slide=>slide.title),after:draft.slides.map(slide=>slide.title)}}),
          ...(deck.theme!==draft.theme && {themes:{before:deck.theme,after:draft.theme}})}}),
      };
      if (operations.length) turn.plan = {baseRevision:deck.revision,operations};
      this.studio.store.transaction(()=>{
        this.save(deck.id,turn);
        if(turn.plan) this.studio.store.usage.deckEvent(deck,'proposal','chat-'+clientId,'chat-'+clientId);
      });
    } catch (error) {
      if (signal.aborted) this.stopTurn(deck.id,turn);
      else {
        this.settleActivity(turn,'error');
        turn.assistant = {...turn.assistant, text:error instanceof ModerationError || error instanceof WebResearchError || (error instanceof ApiError || error instanceof AssistantToolError) && error.status===422 ? error.message : ui.error,status:'error'};
        this.save(deck.id,turn);
      }
    } finally {
      if (turn.assistant.status === 'running') this.stopTurn(deck.id,turn);
      if (this.running.get(deck.id)?.clientId === clientId) this.running.delete(deck.id);
    }
    yield snapshot();
  }

  decide(deckId: string, proposalId: string, decision: AssistantDecision, principal?: Principal) {
    const result = this.studio.store.transaction(() => {
      let deck = this.studio.deck(deckId);
      const turn = this.studio.store.assistantTurn<Turn>(deckId,proposalId);
      const proposal = turn?.assistant.proposal;
      if (!turn?.plan || !canReadTurn(turn,principal) || proposal?.id !== proposalId) throw new ApiError(404,'Proposal not found.');
      if (decision === 'restore') {
        if (proposal.status === 'restored')
          return {conflict:false,deck,restoredRevision:turn.plan.restoredRevision};
        if (proposal.status !== 'applied' || turn.plan.appliedRevision !== deck.revision)
          return {conflict:true,deck};
        deck = this.studio.restoreAssistantBatch(deckId,turn.plan.baseRevision,deck.revision);
        proposal.status = 'restored';
        turn.plan.restoredRevision = deck.revision;
        this.save(deckId,turn);
        return {conflict:false,deck,restoredRevision:deck.revision};
      }
      const next = decision === 'apply' ? 'applied' : 'dismissed';
      if (proposal.status !== 'pending')
        return {conflict:proposal.status !== next,deck,appliedRevision:turn.plan.appliedRevision};
      const conflict = decision === 'apply' && turn.plan.baseRevision !== deck.revision;
      if (decision === 'apply' && !conflict) {
        deck = this.studio.commitAssistantBatch(deck,turn.plan.operations,proposalId);
        turn.plan.appliedRevision = proposal.appliedRevision = deck.revision;
      }
      proposal.status = conflict ? 'stale' : next;
      this.save(deckId,turn);
      return {conflict,deck,appliedRevision:turn.plan.appliedRevision};
    });
    const {conflict,deck,appliedRevision,restoredRevision} = result;
    return {conflict,snapshot:{...this.get(deckId,principal),deck,...(!conflict && appliedRevision !== undefined && {appliedRevision}),...(!conflict && restoredRevision !== undefined && {restoredRevision})}};
  }
}
