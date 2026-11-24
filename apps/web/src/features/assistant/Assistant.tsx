import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type TextMessagePartProps,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpRightIcon,
  ArrowUpIcon,
  BookmarkSimpleIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  GlobeSimpleIcon,
  CheckIcon,
  CopyIcon,
  LightbulbIcon,
  MagnifyingGlassIcon,
  PencilLineIcon,
  StudentIcon,
  StopIcon,
  TextOutdentIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { AssistantSnapshot as Snapshot } from '@sabaq/contracts/assistant';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/coss/button';
import { Checkbox } from '@/components/coss/checkbox';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';
import { Textarea } from '@/components/coss/textarea';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/coss/tooltip';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { GenerationLoader } from '@/components/assistant-ui/elements/loading-state';
import { StreamingText } from '@/components/assistant-ui/elements/streaming-text';
import { TypingIndicator } from '@/components/assistant-ui/elements/typing-indicator';
import { ThreadFollowupSuggestions } from '@/components/assistant-ui/elements/follow-up-suggestions.aui';
import { cn } from '@/lib/utils';
import { AssistantComposerFiles, AssistantSourcePicker, attachmentSource, maxAssistantAttachments } from './AssistantAttachments';
import { AssistantDictation, AssistantReadAloud } from './AssistantVoice';
import { sourceCopy } from '@/features/sources/source-copy';
import { sourceFilePath } from '@/features/sources/source-api';
import { AssistantMentions } from './AssistantMentions';
import { AssistantProposalCard, PendingProposalBar } from './AssistantProposal';
import { AssistantToolStatus, AssistantWorking, assistantToolLabel, isWebActivity, responseReadyLabel, workingLabel } from './AssistantActivity';
import { AssistantResearchMenu, AssistantWebSources, exportWebResearch, isWebResearchMode, researchCopy, type WebResearchMode } from './AssistantResearch';
import { assistantCopy, nextPrompts } from './assistant-copy';
import { replyBody, useAssistantSession } from './AssistantSession';
import './assistant.css';

function ProposalCard() {
  const { snapshot, deck, locale, decide, deciding, running } = useAssistantSession();
  const id = useAuiState((state) => state.message.id);
  const proposal = snapshot.messages.find(message=>message.id===id)?.proposal;
  return proposal ? <AssistantProposalCard proposal={proposal} deck={deck} locale={locale}
    busy={Boolean(deciding) || running} onDecision={action=>decide(proposal.id,action)}/> : null;
}

function ReplyText({text, status}: TextMessagePartProps) {
  const segments = useMemo(() => [{text}], [text]);
  return <div className="as-reply-text">
    {status.type === 'running'
      ? <StreamingText className="as-stream-text" segments={segments} count={text.split(' ').length} streaming/>
      : <div className="as-markdown"><MarkdownTextPrimitive
          smooth={false}
          defer
          skipHtml
          remarkPlugins={[remarkMath]}
          rehypePlugins={[[rehypeKatex,{trust:false,maxExpand:100}]]}
          urlTransform={(url, key) => key === 'href' && /^(https?:\/\/|mailto:)/i.test(url) ? url : ''}
          components={{
            img: ({ alt }) => alt ? <span>{alt}</span> : null,
            a: ({ children, href }) => href
              ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span>{children}</span>,
          }}
        /></div>}
  </div>;
}
function ToolActivity({toolCallId}: ToolCallMessagePartProps) {
  const {snapshot, locale} = useAssistantSession();
  const id = useAuiState(state => state.message.id);
  const activity = snapshot.messages.find(message => message.id === id)?.activity?.find(item => item.id === toolCallId);
  return activity ? <AssistantToolStatus activity={activity} locale={locale}/> : null;
}
const parts = { Text: ReplyText, tools: { by_name: { propose_changes: ProposalCard, web_search: ToolActivity, web_research: ToolActivity, write_web_answer: ToolActivity } } };
function MessageHint({label,children}: {label:string;children:ReactElement}) {
  return <Tooltip><TooltipTrigger render={children}/><TooltipPopup>{label}</TooltipPopup></Tooltip>;
}

function ChatMessage() {
  const { snapshot, locale, deck, running, deciding, resend, assistantWebResearch } = useAssistantSession();
  const aui = useAui();
  const id = useAuiState((s) => s.message.id);
  const copied = useAuiState((s) => s.message.isCopied);
  const index = snapshot.messages.findIndex(message=>message.id===id);
  const item = snapshot.messages[index];
  if (!item) return null;
  const t = assistantCopy[locale],
    user = item.role === 'user';
  const position = item.slideId ? deck.slides.findIndex((s) => s.id === item.slideId) : -1;
  const active = item.status === 'running';
  const text = user ? item.text : replyBody(item);
  const tools = item.activity?.filter(activity => isWebActivity(activity.kind)) ?? [];
  const previous = snapshot.messages[index-1];
  const canResend = previous?.role==='user'
    && (!previous.slideId || deck.slides.some(slide=>slide.id===previous.slideId));
  return (
    <MessagePrimitive.Root role="article" aria-label={user ? t.you : t.name}
      className={cn('as-turn',user ? 'as-user' : 'as-assistant')} data-status={item.status}>
      {user && position >= 0 && <span className="sr-only">{t.slide} {position + 1}</span>}
      {(!active || text || tools.length > 0) && <div className={cn("as-message-body",user && "as-user-bubble")}>
        {user && item.webResearch && <span className="as-sent-research">
          <GlobeSimpleIcon aria-hidden/>{researchCopy[locale][item.webResearch]}
        </span>}
        {user ? <MessagePrimitive.Parts /> : <MessagePrimitive.Parts components={parts} />}
        {user && Boolean(item.fileNames?.length) && <ul className="as-sent-files">
          {item.fileNames!.map((name,index)=><li key={index}><FileTextIcon aria-hidden="true"/>{name}</li>)}
        </ul>}
        {item.status === 'cancelled' && !item.text && <p className="as-status">{t.stopped}</p>}
        {item.status === 'error' && !item.text && <p className="as-status">{t.error}</p>}
      </div>}
      {active && !text && !tools.some(activity => activity.status === 'running') && <AssistantWorking locale={locale}/>}
      <div className="as-message-details">
        {item.webSources && <AssistantWebSources locale={locale} sources={item.webSources}/>}
        {item.citations && item.citations.length > 0 && <details className="as-sources">
          <summary>{t.sources} ({item.citations.length})</summary>
          <ol>{item.citations.map(source=><li key={source.id}>
            {source.sourceFileId ? <a href={'/api'+sourceFilePath(source.sourceFileId)+'/download'}>{source.label}</a>
              : source.url && /^https?:\/\//i.test(source.url)
              ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
              : <span>{source.label}</span>}
            <blockquote>{source.excerpt}</blockquote>
            <small>{t.range} {source.start+1}–{source.end}</small>
          </li>)}</ol>
        </details>}
      </div>
      {!active && (user || text || canResend) && <ActionBarPrimitive.Root className="as-message-actions" hideWhenRunning={false}>
        {user ? <Button variant="ghost" size="icon-xs" type="button" disabled={running || Boolean(item.fileNames?.length || item.searchedSourceLibrary)}
          title={t.edit} aria-label={t.edit} onClick={(event) => {
            const composer = aui.composer();
            const config = composer.getState().runConfig;
            const privateScope = composer.getState().attachments.length || config.custom?.searchSourceLibrary || config.custom?.canvasContext;
            composer.setRunConfig({...config,custom:{...config.custom,webResearch:assistantWebResearch && !privateScope ? item.webResearch : undefined}});
            composer.setText(item.text);
            event.currentTarget.closest('.lesson-assistant')?.querySelector('textarea')?.focus({preventScroll:true});
          }}><PencilLineIcon /></Button> : <>
          {text && <MessageHint label={copied?t.copied:t.copy}><ActionBarPrimitive.Copy render={<Button variant="ghost" size="icon-xs" />} aria-label={copied?t.copied:t.copy}>
            {copied ? <CheckIcon/> : <CopyIcon/>}
          </ActionBarPrimitive.Copy></MessageHint>}
          {text && <MessageHint label={t.export}><ActionBarPrimitive.ExportMarkdown render={<Button variant="ghost" size="icon-xs" />}
            filename="sabaq-reply.md" aria-label={t.export}
            onExport={item.webSources?.length ? markdown => exportWebResearch(markdown, item.webSources!, locale) : undefined}>
            <DownloadSimpleIcon/></ActionBarPrimitive.ExportMarkdown></MessageHint>}
          {text && item.status==='complete' && <AssistantReadAloud text={text} locale={locale} disabled={running}/>}
          {canResend && <MessageHint label={t.askAgain}><Button type="button" variant="ghost" size="icon-xs" disabled={running || Boolean(deciding)}
            onClick={()=>resend(previous)} aria-label={t.askAgain}><ArrowClockwiseIcon/></Button></MessageHint>}
        </>}
      </ActionBarPrimitive.Root>}
    </MessagePrimitive.Root>
  );
}
const messageComponents = { UserMessage: ChatMessage, AssistantMessage: ChatMessage };

function LessonMemory() {
  const {deck, locale, snapshot} = useAssistantSession();
  const t = assistantCopy[locale];
  const path = '/api/decks/' + encodeURIComponent(deck.id) + '/assistant/memory';
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NonNullable<Snapshot['memory']>>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const memoryVersion = useRef(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const version = memoryVersion.current;
    setLoaded(false);
    setFailed(false);
    setNotice('');
    void fetch(path, {cache:'no-store', signal:controller.signal})
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!controller.signal.aborted) {
          if (memoryVersion.current === version) setEntries(data.memory);
          setLoaded(true);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [open, path, attempt]);

  async function save(id?: string) {
    if (!loaded || submitting.current || (!id && !draft.trim())) return;
    submitting.current = true;
    setBusy(true);
    setFailed(false);
    setNotice('');
    try {
      const response = await fetch(id ? path + '/' + encodeURIComponent(id) : path, id
        ? {method:'DELETE'}
        : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:draft.trim()})});
      if (!response.ok) throw Error();
      const data = await response.json();
      memoryVersion.current++;
      setEntries(data.memory);
      setNotice(id ? t.removedMemory : t.savedMemory);
      if (!id) setDraft('');
      field.current?.focus();
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return <Dialog open={open} onOpenChange={value => {
    if (value && snapshot.memory) setEntries(snapshot.memory);
    setOpen(value);
  }}>
    <DialogTrigger render={<Button variant="ghost" size="icon-sm" />} className="as-memory-trigger" aria-label={t.memory} title={t.memory}>
      <BookmarkSimpleIcon aria-hidden />
    </DialogTrigger>
    <DialogPopup className="as-memory-dialog" closeProps={{'aria-label':t.close}}>
      <DialogHeader><DialogTitle>{t.memory}</DialogTitle><DialogDescription>{t.memoryHelp}</DialogDescription></DialogHeader>
      <DialogPanel>
        <div className="sr-only" role="status">{notice}</div>
        {failed && <div className="as-memory-error" role="alert"><WarningCircleIcon />{t.memoryError}
          {!loaded && <Button size="sm" variant="ghost" onClick={()=>setAttempt(attempt+1)}>{t.retry}</Button>}
        </div>}
        {!loaded && !failed ? <p role="status">{t.loadingMemory}</p> : entries.length > 0
          ? <ul className="as-memory-list">{entries.map(entry=><li key={entry.id}>
              <span>{entry.text}</span>
              <Button size="icon-sm" variant="ghost" disabled={!loaded || busy} onClick={()=>void save(entry.id)}
                aria-label={t.removeMemory + ' · ' + entry.text} title={t.removeMemory}><TrashIcon /></Button>
            </li>)}</ul>
          : loaded && <p className="as-memory-empty">{t.memoryEmpty}</p>}
        {loaded && <form className="as-memory-form" onSubmit={event=>{event.preventDefault(); void save();}}>
          {entries.length >= 12 ? <p>{t.memoryLimit}</p> : <>
            <label htmlFor="assistant-memory-instruction">{t.memoryField}</label>
            <Textarea id="assistant-memory-instruction" ref={field} maxLength={400} rows={2}
              placeholder={t.memoryHint} value={draft} onChange={event=>setDraft(event.target.value)} />
            <div><small>{draft.length} / 400</small><Button size="sm" disabled={busy || !draft.trim()} type="submit">{t.addMemory}</Button></div>
          </>}
        </form>}
      </DialogPanel>
    </DialogPopup>
  </Dialog>;
}

function ConversationLoading({label}:{label:string}) {
  const [tick,setTick] = useState(0);
  useEffect(()=>{
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    const update = () => {
      window.clearInterval(timer);
      if (!reduced.matches) timer = window.setInterval(()=>setTick(previous=>previous+3),360);
    };
    update();
    reduced.addEventListener('change',update);
    return () => {window.clearInterval(timer);reduced.removeEventListener('change',update);};
  },[]);
  return <GenerationLoader className="as-history-loader" label={label} tick={tick} variant="rounded" aria-hidden="true"/>;
}

export function AssistantPanel() {
  const { locale, deck, slide, snapshot, loading, running, deciding, error, retry, reload, cloudSourceRag, assistantWebResearch, allowScans,
    pendingProposals, selectedProposal, chooseProposal, decide } = useAssistantSession();
  const composer = useRef<HTMLTextAreaElement>(null);
  const aui = useAui();
  const attached = useAuiState(state=>state.composer.attachments.length);
  const hasSaved = useAuiState(state=>state.composer.attachments.some(file=>attachmentSource(file)));
  const searchAll = useAuiState(state=>state.composer.runConfig.custom?.searchSourceLibrary===true);
  const sendSourceExcerpts = useAuiState(state=>state.composer.runConfig.custom?.useCloudSourceRag===true);
  const canvasContext = useAuiState(state=>Boolean(state.composer.runConfig.custom?.canvasContext));
  const webMode = useAuiState(state => {
    const value = state.composer.runConfig.custom?.webResearch;
    return isWebResearchMode(value) ? value : undefined;
  });
  const setWebMode = useCallback((value?:WebResearchMode) => {
    const current = aui.composer();
    const config = current.getState().runConfig;
    current.setRunConfig({...config,custom:{...config.custom,webResearch:value}});
  }, [aui]);
  const sourceScope = hasSaved || searchAll;
  const setRequestScope = useCallback((flag: 'searchSourceLibrary'|'useCloudSourceRag', value: boolean) => {
    const composer = aui.composer();
    const config = composer.getState().runConfig;
    composer.setRunConfig({...config,custom:{...config.custom,[flag]:value}});
  },[aui]);
  useEffect(()=>{ if (!sourceScope && sendSourceExcerpts) setRequestScope('useCloudSourceRag',false); },[sourceScope,sendSourceExcerpts,setRequestScope]);
  const t = assistantCopy[locale];
  const library = sourceCopy[locale];
  const number = deck.slides.findIndex(item=>item.id===slide.id)+1;
  const frequentActions = [
    { label: t.shorten, prompt: t.shortenPrompt, Icon: TextOutdentIcon },
    { label: t.simpler, prompt: t.simplerPrompt, Icon: StudentIcon },
    { label: t.example, prompt: t.examplePrompt, Icon: LightbulbIcon },
  ];
  const busy = loading || running || Boolean(deciding);
  const promptLabel = webMode ? researchCopy[locale][webMode === 'research' ? 'researchPlaceholder' : 'searchPlaceholder'] : t.placeholder;
  const latestResponse = snapshot.messages.findLast(item=>item.role==='assistant');
  const activeMessage = latestResponse?.status==='running' ? latestResponse : undefined;
  const activeTool = activeMessage?.activity?.findLast(item => item.status === 'running' && isWebActivity(item.kind));
  const hasConversation = snapshot.messages.length > 0 || running;
  const announcement = loading ? t.loading : activeTool ? assistantToolLabel(activeTool, locale) : activeMessage?.streamingText
    ? ({en:'Writing…',kk:'Жазып жатыр…',ru:'Пишу…'}[locale]) : running ? workingLabel(locale)
    : latestResponse?.status==='complete' ? responseReadyLabel(locale)
    : latestResponse?.status==='cancelled' ? t.stopped
    : latestResponse?.status==='error' ? t.error : '';
  return (
    <ThreadPrimitive.Root className="lesson-assistant" aria-label={t.name}>
      <div className="as-context">
        <div className="as-context-thumbnail" aria-hidden="true" inert><SlideCanvas slide={slide} deck={deck} /></div>
        <div className="as-context-name" aria-live="polite" aria-atomic="true">
          <span>{t.selected} · {number} / {deck.slides.length}</span>
          <strong lang={deck.language} title={slide.title}>{slide.title}</strong>
        </div>
        <LessonMemory/>
      </div>
      <div className="sr-only" role="status" aria-atomic="true">{announcement}</div>
      <div className="as-thread-frame">
        <ThreadPrimitive.Viewport className="as-viewport" role="log" aria-live="off"
          aria-label={t.transcript} aria-busy={loading} tabIndex={0} autoScroll={hasConversation}
          scrollToBottomOnInitialize={hasConversation} scrollToBottomOnThreadSwitch={hasConversation}>
          {loading ? (
            <ConversationLoading label={t.loading}/>
          ) : !error && !hasConversation && (
            <div className="as-empty">
              <h3>{t.empty}</h3>
              <p>{t.intro}</p>
              {!webMode && slide.status==='ready' && <div className="as-suggestions" role="group" aria-label={t.actions}>
                {frequentActions.map(({ label, prompt, Icon }) => (
                  <ThreadPrimitive.Suggestion render={<Button size="sm" variant="ghost" />} key={prompt} prompt={prompt} send
                    disabled={busy} onClick={(event) => { if (event.detail === 0) composer.current?.focus({preventScroll:true}); }}>
                    <Icon aria-hidden />
                    <span>{label}</span><ArrowUpRightIcon aria-hidden />
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>}
            </div>
          )}
          <ThreadPrimitive.Messages components={messageComponents} />
          {!webMode && !busy && !error && <ThreadFollowupSuggestions aria-label={nextPrompts[locale].group}/>}
          {running && !activeMessage && <div className="as-waiting" aria-hidden="true"><TypingIndicator variant="bare"/></div>}
        </ThreadPrimitive.Viewport>
        {hasConversation && <ThreadPrimitive.ScrollToBottom behavior="auto" render={<Button size="sm" variant="outline" />}
          className="as-jump" title={t.latest} aria-label={t.latest}><ArrowDownIcon/>{t.latest}</ThreadPrimitive.ScrollToBottom>}
      </div>
      {error && (
        <div className="as-error" role="alert">
          <WarningCircleIcon size={16} />
          <span>{error}</span>
          {retry ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={retry}>{t.retry}</Button>
          ) : (
            <Button variant="ghost" size="icon-sm" onClick={reload} title={t.retry} aria-label={t.retry}>
              <ArrowClockwiseIcon size={16} />
            </Button>
          )}
        </div>
      )}
      {selectedProposal && <PendingProposalBar proposals={pendingProposals} selected={selectedProposal}
        locale={locale} revision={deck.revision} choose={chooseProposal} decide={decide} busy={busy}/>}
      <ComposerPrimitive.TriggerPopoverRoot>
      <ComposerPrimitive.Root className="as-composer">
        {!webMode && !busy && <AssistantMentions deck={deck} locale={locale}/>}
        <ComposerPrimitive.AttachmentDropzone className="as-composer-dropzone" disabled={Boolean(webMode) || busy || attached>=maxAssistantAttachments}
          onDrop={event=>{
            if (event.dataTransfer.files.length>maxAssistantAttachments-attached) event.preventDefault();
          }}>
          {attached>0 && <AssistantComposerFiles locale={locale}/>}
          {searchAll && !attached && <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-muted-foreground">
            <MagnifyingGlassIcon aria-hidden/>{library.searchingAll}
            <Button size="icon-xs" variant="ghost" aria-label={library.clearSearchAll} title={library.clearSearchAll}
              disabled={busy} onClick={()=>setRequestScope('searchSourceLibrary',false)}><XIcon aria-hidden/></Button>
          </div>}
          {cloudSourceRag && sourceScope && <label className="flex items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
            <Checkbox checked={sendSourceExcerpts} onCheckedChange={checked=>setRequestScope('useCloudSourceRag',checked)} disabled={busy}/>{library.sendExcerpts}
          </label>}
          <ComposerPrimitive.Input ref={composer} render={<Textarea unstyled />} rows={2} maxLength={6000}
            autoFocus={false} addAttachmentOnPaste={!webMode && !busy && attached<maxAssistantAttachments}
            placeholder={promptLabel} aria-label={promptLabel} />
        </ComposerPrimitive.AttachmentDropzone>
        <div className="as-composer-tools">
          <div className="as-composer-actions">
            <AssistantSourcePicker locale={locale} allowScans={allowScans} disabled={Boolean(webMode) || busy}
              onSearchAll={()=>setRequestScope('searchSourceLibrary',true)}/>
            <AssistantDictation locale={locale} disabled={busy} onTranscript={text=>{
              const draft=aui.composer().getState().text;
              aui.composer().setText([draft.trimEnd(),text].filter(Boolean).join(' ').slice(0,6000));
              composer.current?.focus();
            }}/>
            <AssistantResearchMenu locale={locale} mode={webMode} available={assistantWebResearch}
              conflicting={Boolean(attached || searchAll || canvasContext)} disabled={busy} onModeChange={setWebMode}/>
          </div>
          {running ? (
            <ComposerPrimitive.Cancel render={<Button size="icon-sm" variant="secondary" />} className="as-composer-send"
              aria-label={t.stop} title={t.stop}><StopIcon weight="fill" /></ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send render={<Button size="icon-sm" />} className="as-composer-send"
              aria-label={t.send} title={t.send}><ArrowUpIcon weight="bold" /></ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
      </ComposerPrimitive.TriggerPopoverRoot>
    </ThreadPrimitive.Root>
  );
}
