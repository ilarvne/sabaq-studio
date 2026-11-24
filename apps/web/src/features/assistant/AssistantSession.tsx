import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type { AssistantCanvasScope, AssistantDecision, AssistantMessage, AssistantProposal, AssistantSnapshot as Snapshot } from '@sabaq/contracts/assistant';
import { narrationPrompts } from '@sabaq/lesson/narration';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { TooltipProvider } from '@/components/coss/tooltip';
import { request } from '@/lib/api';
import { useMediaCapabilities } from '@/lib/media';
import { assistantCopy, nextPrompts } from './assistant-copy';
import { isWebActivity } from './AssistantActivity';
import { assistantAttachmentCopy, attachmentSource, createAssistantAttachmentAdapter, maxAssistantAttachments } from './AssistantAttachments';
import { resolveSlideMentions } from './AssistantMentions';
import { isWebResearchMode, linkResearchCitations, researchCopy, type WebResearchMode } from './AssistantResearch';
import { AssistantVoiceProvider } from './AssistantVoice';

type SessionProps = {
  deck: Deck;
  slide: Slide;
  locale: Locale;
  enabled: boolean;
  children: ReactNode;
  beforeAssistant: () => Promise<boolean>;
  onAssistantDeck: (deck: Deck, appliedRevision?: number, restoredRevision?:number) => void;
};
type SessionState = {
  locale: Locale;
  snapshot: Snapshot;
  deck: Deck;
  slide: Slide;
  loading: boolean;
  running: boolean;
  error: string;
  retry: (() => void) | undefined;
  resend: (message: AssistantMessage) => void;
  rewriteSpeech: () => void;
  editCanvas: (prompt:string, scope:AssistantCanvasScope) => void;
  deciding: string;
  cloudSourceRag: boolean;
  assistantWebResearch: boolean;
  allowScans: boolean;
  canGenerateEdits: boolean;
  pendingProposals: AssistantProposal[];
  selectedProposal?: AssistantProposal;
  chooseProposal: (id: string) => void;
  reload: () => void;
  decide: (id: string, action: AssistantDecision) => void;
};
type TurnRequest = { text: string; slideId?: string; locale: Locale; clientId: string; sourceFileIds?:string[]; searchSourceLibrary?:boolean; useCloudSourceRag?:true; attachmentTurnId?:string; canvasScope?:AssistantCanvasScope; webResearch?:WebResearchMode };
type CanvasComposerContext = {slideId:string; scope:AssistantCanvasScope};
const Session = createContext<SessionState | null>(null);
export function useAssistantSession() {
  const session = useContext(Session);
  if (!session) throw new Error('Lesson assistant requires a session.');
  return session;
}
const proposalAcknowledgments = new Set([
  'I prepared these changes for your review.',
  'Я подготовил изменения. Проверьте их перед применением.',
  'Өзгерістерді дайындадым. Қолданар алдында қарап шығыңыз.',
]);
export function replyBody(message: AssistantMessage) {
  if (message.status === 'running') return message.streamingText ?? '';
  return message.proposal && proposalAcknowledgments.has(message.text.trim()) ? '' : message.text;
}

function convert(message: AssistantMessage): ThreadMessageLike {
  if (message.role === 'user') return { id: message.id, role: 'user', content: message.text };
  const status =
    message.status === 'running'
      ? ({ type: 'running' } as const)
      : message.status === 'cancelled' || message.status === 'error'
        ? ({ type: 'incomplete', reason: message.status } as const)
        : ({ type: 'complete', reason: 'stop' } as const);
  const reply = replyBody(message);
  const text = message.webSources?.length ? linkResearchCitations(reply, message.webSources) : reply;
  return {
    id: message.id,
    role: 'assistant',
    status,
    content: [
      ...(message.activity ?? []).filter(activity => isWebActivity(activity.kind)).map(activity => ({
        type: 'tool-call' as const,
        toolName: activity.kind,
        toolCallId: activity.id,
        args: {},
        ...(activity.status !== 'running' && {result: {status: activity.status}, isError: activity.status === 'error'}),
      })),
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...(message.proposal
        ? [
            {
              type: 'tool-call' as const,
              toolName: 'propose_changes',
              toolCallId: message.proposal.id,
              args: {},
              ...(message.proposal.status === 'pending' ? {} : { result: message.proposal.status }),
            },
          ]
        : []),
    ],
  };
}
async function readStream(response: Response, onSnapshot: (value: Snapshot) => void) {
  if (!response.body) throw Error('Missing stream');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let received = false;
  function line(value: string) {
    if (!value.trim()) return;
    const result: Snapshot = JSON.parse(value);
    if (!Array.isArray(result.messages)) throw Error('Invalid message list');
    received = true;
    onSnapshot(result);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      lines.forEach(line);
    }
    line(buffer);
    if (!received) throw Error('Empty stream');
  } finally {
    reader.releaseLock();
  }
}

export function AssistantSession({
  deck,
  slide,
  locale,
  enabled,
  beforeAssistant,
  onAssistantDeck,
  children,
}: SessionProps) {
  const path = '/api/decks/' + encodeURIComponent(deck.id) + '/assistant';
  const [snapshot, setSnapshot] = useState<Snapshot>({ messages: [] });
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [deciding, setDeciding] = useState('');
  const [error, setError] = useState('');
  const [failedRequest, setFailedRequest] = useState<TurnRequest>();
  const [cloudSourceRag, setCloudSourceRag] = useState(false);
  const [assistantWebResearch, setAssistantWebResearch] = useState(false);
  const [editProviders, setEditProviders] = useState({local: false, alem: false});
  const [chosenProposal, chooseProposal] = useState<string>();
  const pendingProposals = snapshot.messages.flatMap(message => message.proposal?.status === 'pending' ? [message.proposal] : []);
  const selectedProposal = pendingProposals.find(proposal => proposal.id === chosenProposal) ?? pendingProposals.at(-1);
  const task = useRef<{ id: string; abort: AbortController; posted: boolean } | undefined>(undefined);
  const epoch = useRef(0);
  const decision = useRef(false);
  const live = useRef(true);
  const t = assistantCopy[locale];
  const media = useMediaCapabilities();
  const attachmentAdapter = useMemo(()=>createAssistantAttachmentAdapter(locale, media.ocr),[locale, media.ocr]);
  useEffect(()=>{
    if (!enabled) return;
    const controller = new AbortController();
    void request<{cloudSourceRag?:boolean; localAssistant?:boolean; alem?:boolean; assistantWebResearch?:boolean}>('/capabilities',{signal:controller.signal})
      .then(value=>{
        setCloudSourceRag(value.cloudSourceRag===true);
        setAssistantWebResearch(value.assistantWebResearch===true);
        setEditProviders({local: value.localAssistant === true, alem: value.alem === true});
      }).catch(()=>undefined);
    return ()=>controller.abort();
  },[enabled]);
  const reload = useCallback(async () => {
    const current = epoch.current;
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw Error();
      const next: Snapshot = await res.json();
      if (live.current && current === epoch.current && !task.current && !decision.current) {
        setSnapshot(next);
        setLoaded(true);
        setError('');
      }
    } catch {
      if (live.current && current === epoch.current) setError(t.failed);
    }
  }, [path, t.failed]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      task.current?.abort.abort();
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [enabled, reload]);
  useEffect(() => {
    if (!snapshot.activeClientId || pending) return;
    const timer = window.setInterval(() => void reload(), 1000);
    return () => clearInterval(timer);
  }, [snapshot.activeClientId, pending, reload]);
  const running =
    pending || Boolean(snapshot.activeClientId) || snapshot.messages.some((m) => m.status === 'running');
  async function send(request: TurnRequest) {
    if (!request.text || task.current || decision.current || running) return;
    const current = { id: request.clientId, abort: new AbortController(), posted: false };
    task.current = current;
    epoch.current++;
    setError('');
    setFailedRequest(undefined);
    chooseProposal(undefined);
    setPending(true);
    let saveFailed = false;
    try {
      if (!(await beforeAssistant())) {
        saveFailed = true;
        throw Error();
      }
      if (current.abort.signal.aborted) return;
      current.posted = true;
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: current.abort.signal,
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (live.current && data?.messages) setSnapshot(data);
        throw Error();
      }
      await readStream(response, (next) => {
        if (live.current && task.current === current && !current.abort.signal.aborted) setSnapshot(next);
      });
    } catch {
      if (live.current && !current.abort.signal.aborted) {
        setError(saveFailed ? t.saveFirst : t.failed);
        setFailedRequest(request);
      }
    } finally {
      if (task.current === current) task.current = undefined;
      if (live.current) setPending(false);
    }
  }
  async function stop() {
    const id = task.current?.id || snapshot.activeClientId;
    if (!id) return;
    epoch.current++;
    const local = task.current;
    local?.abort.abort();
    if (local && !local.posted) return;
    try {
      const res = await fetch(path + '/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id }),
      });
      if (!res.ok) throw Error();
      const next: Snapshot = await res.json();
      if (live.current) setSnapshot(next);
    } catch {
      if (live.current) {
        setError(t.failed);
        void reload();
      }
    }
  }
  async function decide(id: string, action: AssistantDecision) {
    if (decision.current || task.current || running) return;
    decision.current = true;
    epoch.current++;
    setDeciding(id);
    setError('');
    try {
      if (action !== 'dismiss' && !(await beforeAssistant())) {
        setError(t.saveFirst);
        return;
      }
      const res = await fetch(path + '/proposals/' + encodeURIComponent(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const next: Snapshot = await res.json();
      if (!live.current) return;
      if (next.deck) onAssistantDeck(next.deck, res.ok && action === 'apply' ? next.appliedRevision : undefined, res.ok && action === 'restore' ? next.restoredRevision : undefined);
      if (Array.isArray(next.messages)) setSnapshot(next);
      if (!res.ok && res.status !== 409) throw Error();
      if (res.status === 409) setError(t.stale);
    } catch {
      if (live.current) setError(t.failed);
    } finally {
      decision.current = false;
      if (live.current) setDeciding('');
    }
  }
  const suggestions = useMemo(() => {
    const reply = snapshot.messages.at(-1);
    if (!reply || reply.role !== 'assistant' || reply.status !== 'complete' || !reply.text.trim() || reply.proposal ||
      (reply.slideId && reply.slideId !== slide.id) || slide.status !== 'ready') return [];
    const preceding = snapshot.messages.at(-2);
    if (preceding?.webResearch) return [];
    const previous = preceding?.text;
    const words = nextPrompts[locale];
    if (Object.values(nextPrompts).some(item=>reply.text.trimEnd().endsWith(item.noEvidence))) {
      return slide.notes?.trim() && previous !== words.notes.prompt ? [words.notes] : [];
    }
    const relevant = deck.source || reply.citations?.length ? [words.sources, words.example, words.explain] : [words.example, words.explain];
    return relevant.filter(item=>item.prompt !== previous && !(item === words.example && previous === assistantCopy[locale].examplePrompt)).slice(0,2);
  }, [snapshot.messages, deck.source, slide.id, slide.status, slide.notes, locale]);
  const runtime = useExternalStoreRuntime<AssistantMessage>({
    messages: snapshot.messages,
    suggestions,
    convertMessage: convert,
    isRunning: running,
    isLoading: enabled && !loaded && !error,
    isSendDisabled: !loaded || Boolean(deciding),
    adapters: {attachments:attachmentAdapter},
    onNew: async (message) => {
      const sourceFileIds = message.role==='user' ? [...new Set((message.attachments ?? []).flatMap(file=>{
        const source=attachmentSource(file);
        return source ? [source.id] : [];
      }))] : [];
      if (sourceFileIds.length>maxAssistantAttachments) {
        setError(assistantAttachmentCopy[locale].limit);
        return;
      }
      const text = message.content.flatMap(part=>part.type==='text' ? [part.text] : []).join('\n').trim()
        || (sourceFileIds.length ? assistantAttachmentCopy[locale].prompt : '');
      const target = resolveSlideMentions(text,deck,locale);
      if (target.error) { setError(target.error); return; }
      const all = !sourceFileIds.length && message.runConfig?.custom?.searchSourceLibrary===true;
      const scope = sourceFileIds.length ? {sourceFileIds} : all ? {searchSourceLibrary:true} : {};
      const useCloud = cloudSourceRag && message.runConfig?.custom?.useCloudSourceRag===true && (sourceFileIds.length>0 || all);
      const canvasContext=message.runConfig?.custom?.canvasContext as CanvasComposerContext|undefined;
      const canvasScope=canvasContext?.slideId===target.slideId ? canvasContext?.scope : undefined;
      const requestedMode = message.runConfig?.custom?.webResearch;
      const webResearch = isWebResearchMode(requestedMode) ? requestedMode : undefined;
      if (webResearch && (sourceFileIds.length || all || canvasContext || !assistantWebResearch)) {
        setError(researchCopy[locale][assistantWebResearch ? 'conflicting' : 'unavailable']);
        return;
      }
      const composer = runtime.thread.composer;
      const config = composer.getState().runConfig;
      if (config.custom?.useCloudSourceRag===true || config.custom?.canvasContext || config.custom?.webResearch)
        composer.setRunConfig({...config,custom:{...config.custom,useCloudSourceRag:false,canvasContext:undefined,webResearch:undefined}});
      await send({text:target.text,slideId:target.slideId ?? slide.id,locale,clientId:crypto.randomUUID(),...scope,
        ...(canvasScope && {canvasScope}),
        ...(webResearch && {webResearch}),
        ...(useCloud && {useCloudSourceRag:true})});
    },
    onCancel: stop,
  });
  return (
    <Session.Provider
      value={{
        locale,
        snapshot,
        deck,
        slide,
        loading: !loaded && !error,
        running,
        error,
        retry: failedRequest ? () => void send(failedRequest) : undefined,
        rewriteSpeech: () => void send({text:narrationPrompts[locale],slideId:slide.id,locale,clientId:crypto.randomUUID()}),
        editCanvas: (prompt,canvasScope) => void send({text:prompt,slideId:slide.id,locale,clientId:crypto.randomUUID(),canvasScope}),
        resend: message => void send({text:message.text,slideId:message.slideId,locale,clientId:crypto.randomUUID(),
          ...(message.canvasScope && {canvasScope:message.canvasScope}),
          ...(message.webResearch && {webResearch:message.webResearch}),
          ...((message.fileNames?.length || message.searchedSourceLibrary) && {attachmentTurnId:message.id.replace(/^user-/,'')})}),
        deciding,
        cloudSourceRag,
        assistantWebResearch,
        allowScans: media.ocr,
        canGenerateEdits: editProviders.local || (editProviders.alem && deck.provider === 'alem' && !deck.source && !snapshot.memory?.length),
        pendingProposals, selectedProposal, chooseProposal,
        decide,
        reload: () => void reload(),
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <AssistantVoiceProvider locale={locale} alem={media.transcription.includes(locale)}><TooltipProvider>{children}</TooltipProvider></AssistantVoiceProvider>
      </AssistantRuntimeProvider>
    </Session.Provider>
  );
}
