import { narrationPrompts } from '@sabaq/lesson/narration';
import { numericTableValues } from '@sabaq/lesson/chart-data';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  defaultDirectiveFormatter,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpRightIcon,
  ArrowUpIcon,
  BookmarkSimpleIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  FileTextIcon,
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
import type { AssistantDecision, AssistantMessage, AssistantProposal, AssistantSnapshot as Snapshot } from '@sabaq/contracts/assistant';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Menu } from '@base-ui/react/menu';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { Checkbox } from '@/components/coss/checkbox';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';
import { Textarea } from '@/components/coss/textarea';
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '@/components/coss/tooltip';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { GenerationLoader } from '@/components/assistant-ui/elements/loading-state';
import { StreamingText } from '@/components/assistant-ui/elements/streaming-text';
import { TypingIndicator } from '@/components/assistant-ui/elements/typing-indicator';
import { ThreadFollowupSuggestions } from '@/components/assistant-ui/elements/follow-up-suggestions.aui';
import { cn } from '@/lib/utils';
import { request } from '@/lib/api';
import { AssistantAttachButton, AssistantComposerFiles, AssistantSourcePicker, assistantAttachmentCopy, attachmentSource, createAssistantAttachmentAdapter, maxAssistantAttachments } from './AssistantAttachments';
import { AssistantDictation, AssistantReadAloud, AssistantVoiceProvider } from './AssistantVoice';
import { useMediaCapabilities } from '@/lib/media';
import { sourceCopy } from '@/features/sources/source-copy';
import { sourceFilePath } from '@/features/sources/source-api';
import { AssistantMentions, resolveSlideMentions } from './AssistantMentions';
import { AssistantProposalCard, PendingProposalBar } from './AssistantProposal';
import { AssistantWorking, responseReadyLabel, workingLabel } from './AssistantActivity';
import './assistant.css';

const strings = {
  en: {
    name: 'Lesson assistant',
    sources:'Sources', range:'Characters',
    you: 'You',
    empty: 'What would you like to change?',
    intro: 'Review suggested edits before applying them.',
    shorten: 'Shorten this slide',
    simpler: 'Simplify for grade 7', example: 'Add an example',
    simplerPrompt: 'Simplify the selected slide for grade 7. Use familiar words and keep the main idea and the slide language.',
    examplePrompt: 'Add one concrete example to the selected slide to explain its main idea. Keep the slide language.',
    actions: 'Assistant actions for this slide',
    slide: 'Slide',
    shortenPrompt: 'Shorten the text on this slide.',
    placeholder: 'Ask about this slide…',
    send: 'Send message',
    stop: 'Stop response',
    copy: 'Copy response', copied: 'Response copied', export: 'Export Markdown', askAgain: 'Ask again',
    edit: 'Edit and send again',
    loading: 'Loading conversation…',
    stopped: 'Response stopped',
    error: 'The assistant could not finish this turn.',
    failed: 'Could not reach the lesson assistant.',
    retry: 'Retry',
    saveFirst: 'Resolve the pending slide edits, then try again.',
    transcript: 'Lesson conversation', latest: 'Jump to latest',
    selected: 'Selected slide',
    memory: 'Lesson memory', memoryHelp: 'Saved instructions apply to future replies in this lesson.',
    memoryEmpty: 'No saved instructions.', memoryField: 'Instruction', memoryHint: 'Use examples from everyday life.',
    loadingMemory: 'Loading instructions…', savedMemory: 'Instruction saved.', removedMemory: 'Instruction removed.',
    addMemory: 'Save instruction', removeMemory: 'Remove instruction', memoryError: 'Could not update lesson memory.',
    memoryLimit: 'All 12 instructions are in use. Remove one to add another.', close: 'Close',
    stale: 'The lesson changed. Request a new proposal.',
  },
  ru: {
    name: 'Помощник урока',
    sources:'Источники', range:'Символы',
    you: 'Вы',
    empty: 'Что изменить на слайде?',
    intro: 'Проверьте предложенные правки перед применением.',
    shorten: 'Сократить этот слайд',
    simpler: 'Упростить для 7 класса', example: 'Добавить пример',
    simplerPrompt: 'Упрости текст выбранного слайда для 7 класса. Сохрани главную мысль и язык слайда.',
    examplePrompt: 'Добавь на выбранный слайд один конкретный пример, который пояснит главную мысль. Сохрани язык слайда.',
    actions: 'Действия помощника для этого слайда',
    slide: 'Слайд',
    shortenPrompt: 'Сократи текст на этом слайде.',
    placeholder: 'Спросите об этом слайде…',
    send: 'Отправить сообщение',
    stop: 'Остановить ответ',
    copy: 'Скопировать ответ', copied: 'Ответ скопирован', export: 'Скачать Markdown', askAgain: 'Спросить снова',
    edit: 'Изменить и отправить снова',
    loading: 'Загружаем переписку…',
    stopped: 'Ответ остановлен',
    error: 'Не удалось завершить ответ.',
    failed: 'Не удалось связаться с помощником.',
    retry: 'Повторить',
    saveFirst: 'Сначала разрешите конфликт правок, затем повторите запрос.',
    transcript: 'Переписка об уроке', latest: 'К последнему сообщению',
    selected: 'Выбранный слайд',
    memory: 'Память урока', memoryHelp: 'Помощник учитывает эти инструкции в следующих ответах по уроку.',
    memoryEmpty: 'Сохранённых инструкций пока нет.', memoryField: 'Инструкция', memoryHint: 'Приводи примеры из повседневной жизни.',
    loadingMemory: 'Загружаем инструкции…', savedMemory: 'Инструкция сохранена.', removedMemory: 'Инструкция удалена.',
    addMemory: 'Сохранить инструкцию', removeMemory: 'Удалить инструкцию', memoryError: 'Не удалось обновить память урока.',
    memoryLimit: 'Сохранены все 12 инструкций. Удалите одну, чтобы добавить новую.', close: 'Закрыть',
    stale: 'Урок изменился. Запросите новое предложение.',
  },
  kk: {
    name: 'Сабақ көмекшісі',
    sources:'Дереккөздер', range:'Таңбалар',
    you: 'Сіз',
    empty: 'Слайдта нені өзгертеміз?',
    intro: 'Ұсынылған түзетулерді қолданар алдында қарап шығыңыз.',
    shorten: 'Слайд мәтінін қысқарту',
    simpler: '7-сыныпқа жеңілдету', example: 'Мысал қосу',
    simplerPrompt: 'Таңдалған слайдтың мәтінін 7-сыныпқа лайықтап жеңілдет. Негізгі ойы мен слайдтың тілін сақта.',
    examplePrompt: 'Таңдалған слайдқа негізгі ойды түсіндіретін бір нақты мысал қос. Слайдтың тілін сақта.',
    actions: 'Осы слайдқа арналған көмекші әрекеттері',
    slide: 'Слайд',
    shortenPrompt: 'Осы слайдтың мәтінін қысқарт.',
    placeholder: 'Осы слайд туралы сұраңыз…',
    send: 'Хабар жіберу',
    stop: 'Жауапты тоқтату',
    copy: 'Жауапты көшіру', copied: 'Жауап көшірілді', export: 'Markdown жүктеп алу', askAgain: 'Қайта сұрау',
    edit: 'Өзгертіп, қайта жіберу',
    loading: 'Хабарлар жүктелуде…',
    stopped: 'Жауап тоқтатылды',
    error: 'Жауапты аяқтау мүмкін болмады.',
    failed: 'Көмекшімен байланысу мүмкін болмады.',
    retry: 'Қайталау',
    saveFirst: 'Алдымен слайдтағы түзетулер қайшылығын шешіп, қайта көріңіз.',
    transcript: 'Сабақ туралы әңгіме', latest: 'Соңғы хабарға өту',
    selected: 'Таңдалған слайд',
    memory: 'Сабақ жады', memoryHelp: 'Көмекші осы сабақта жауап бергенде сақталған нұсқауларды ескереді.',
    memoryEmpty: 'Сақталған нұсқау жоқ.', memoryField: 'Нұсқау', memoryHint: 'Күнделікті өмірден мысал келтір.',
    loadingMemory: 'Нұсқаулар жүктелуде…', savedMemory: 'Нұсқау сақталды.', removedMemory: 'Нұсқау жойылды.',
    addMemory: 'Нұсқауды сақтау', removeMemory: 'Нұсқауды жою', memoryError: 'Сабақ жадын жаңарту мүмкін болмады.',
    memoryLimit: '12 нұсқау сақталды. Жаңасын қосу үшін біреуін жойыңыз.', close: 'Жабу',
    stale: 'Сабақ өзгерді. Жаңа ұсыныс сұраңыз.',
  },
};
const nextPrompts = {
  en: {
    group:'Follow-up suggestions', noEvidence:'Try a more specific term or add the source material.',
    notes:{title:'Show slide notes',prompt:'Show the speaker notes for this slide.'},
    example: {title:'Give an example', prompt:'Give a concrete classroom example of the idea in your last reply.'},
    explain: {title:'Explain more simply', prompt:'Explain your last answer in simpler words for the students.'},
    sources: {title:'Find the source', prompt:'Find the passage in the lesson materials that supports this explanation.'},
  },
  ru: {
    group:'Следующие вопросы', noEvidence:'Уточните запрос или добавьте исходный материал.',
    notes:{title:'Показать заметки',prompt:'Покажи заметки докладчика для этого слайда.'},
    example: {title:'Привести пример', prompt:'Приведи конкретный пример для класса, который поясняет идею из последнего ответа.'},
    explain: {title:'Объяснить проще', prompt:'Объясни свой последний ответ более простыми словами для учеников.'},
    sources: {title:'Найти источник', prompt:'Найди в материалах урока фрагмент, на котором основано это объяснение.'},
  },
  kk: {
    group:'Келесі сұрақтар', noEvidence:'Сұрауды нақтылаңыз немесе дереккөзді қосыңыз.',
    notes:{title:'Жазбаларды көрсету',prompt:'Осы слайдтың баяндамашы жазбаларын көрсет.'},
    example: {title:'Мысал келтіру', prompt:'Соңғы жауабыңдағы ойды түсіндіретін сыныпқа арналған нақты мысал келтір.'},
    explain: {title:'Жеңілірек түсіндіру', prompt:'Соңғы жауабыңды оқушыларға түсінікті қарапайым сөздермен түсіндір.'},
    sources: {title:'Дереккөзді табу', prompt:'Сабақ материалдарынан осы түсіндірмені растайтын үзіндіні тап.'},
  },
};
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
  editCanvas: (prompt:string) => void;
  deciding: string;
  cloudSourceRag: boolean;
  canGenerateEdits: boolean;
  pendingProposals: AssistantProposal[];
  selectedProposal?: AssistantProposal;
  chooseProposal: (id: string) => void;
  reload: () => void;
  decide: (id: string, action: AssistantDecision) => void;
};
type TurnRequest = { text: string; slideId?: string; locale: Locale; clientId: string; sourceFileIds?:string[]; searchSourceLibrary?:boolean; useCloudSourceRag?:true; attachmentTurnId?:string };
const Session = createContext<SessionState | null>(null);
function useSession() {
  const session = useContext(Session);
  if (!session) throw new Error('Lesson assistant requires a session.');
  return session;
}
export function useCanvasProposal() {
  const {selectedProposal, slide, deck} = useSession();
  if (!selectedProposal || (selectedProposal.baseRevision !== undefined && selectedProposal.baseRevision !== deck.revision)) return;
  const change = selectedProposal.changes?.find(item => item.slideId === slide.id);
  if (change?.after || selectedProposal.themes) return {id: selectedProposal.id, slide: change?.after ?? slide,
    theme: selectedProposal.themes?.after ?? deck.theme};
}
const proposalAcknowledgments = new Set([
  'I prepared these changes for your review.',
  'Я подготовил изменения. Проверьте их перед применением.',
  'Өзгерістерді дайындадым. Қолданар алдында қарап шығыңыз.',
]);
function replyBody(message: AssistantMessage) {
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
  const text = replyBody(message);
  return {
    id: message.id,
    role: 'assistant',
    status,
    content: [
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
  const [editProviders, setEditProviders] = useState({local: false, alem: false});
  const [chosenProposal, chooseProposal] = useState<string>();
  const pendingProposals = snapshot.messages.flatMap(message => message.proposal?.status === 'pending' ? [message.proposal] : []);
  const selectedProposal = pendingProposals.find(proposal => proposal.id === chosenProposal) ?? pendingProposals.at(-1);
  const task = useRef<{ id: string; abort: AbortController; posted: boolean } | undefined>(undefined);
  const epoch = useRef(0);
  const decision = useRef(false);
  const live = useRef(true);
  const t = strings[locale];
  const media = useMediaCapabilities();
  const attachmentAdapter = useMemo(()=>createAssistantAttachmentAdapter(locale, media.ocr),[locale, media.ocr]);
  useEffect(()=>{
    if (!enabled) return;
    const controller = new AbortController();
    void request<{cloudSourceRag?:boolean; localAssistant?:boolean; alem?:boolean}>('/capabilities',{signal:controller.signal})
      .then(value=>{
        setCloudSourceRag(value.cloudSourceRag===true);
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
    const previous = snapshot.messages.at(-2)?.text;
    const words = nextPrompts[locale];
    if (Object.values(nextPrompts).some(item=>reply.text.trimEnd().endsWith(item.noEvidence))) {
      return slide.notes?.trim() && previous !== words.notes.prompt ? [words.notes] : [];
    }
    const relevant = deck.source || reply.citations?.length ? [words.sources, words.example, words.explain] : [words.example, words.explain];
    return relevant.filter(item=>item.prompt !== previous && !(item === words.example && previous === strings[locale].examplePrompt)).slice(0,2);
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
      const composer = runtime.thread.composer;
      const config = composer.getState().runConfig;
      if (config.custom?.useCloudSourceRag===true) composer.setRunConfig({...config,custom:{...config.custom,useCloudSourceRag:false}});
      await send({text:target.text,slideId:target.slideId ?? slide.id,locale,clientId:crypto.randomUUID(),...scope,
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
        editCanvas: prompt => void send({text:prompt,slideId:slide.id,locale,clientId:crypto.randomUUID()}),
        resend: message => void send({text:message.text,slideId:message.slideId,locale,clientId:crypto.randomUUID(),
          ...((message.fileNames?.length || message.searchedSourceLibrary) && {attachmentTurnId:message.id.replace(/^user-/,'')})}),
        deciding,
        cloudSourceRag,
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

export function RewriteSpeechButton({label,disabled,openReview}:{label:string;disabled:boolean;openReview:()=>void}) {
  const {rewriteSpeech,running,deciding}=useSession();
  return <Button size="sm" variant="outline" disabled={disabled || running || Boolean(deciding)}
    onClick={()=>{openReview();rewriteSpeech();}}>{label}</Button>;
}

export const canvasCopy = {
  en:{label:'Edit with AI',shorten:'Shorten',simplify:'Simplify',shortTitle:'Shorten only the title of the selected slide.',
    simpleTitle:'Simplify only the title of the selected slide for grade 7.'},
  ru:{label:'Изменить с ИИ',shorten:'Короче',simplify:'Проще',shortTitle:'Сократи только заголовок выбранного слайда.',
    simpleTitle:'Упрости только заголовок выбранного слайда для 7 класса.'},
  kk:{label:'ЖИ көмегімен өзгерту',shorten:'Қысқарту',simplify:'Жеңілдету',shortTitle:'Таңдалған слайдтың тақырыбын ғана қысқарт.',
    simpleTitle:'Таңдалған слайдтың тақырыбын ғана 7-сыныпқа лайықтап жеңілдет.'},
};

type CanvasTarget = 'title' | 'body' | 'slide';
const canvasActions = {
  en: {example:'Add an example', chart:'Convert to chart', translate:'Translate', custom:'Custom request',
    fields:{title:'the title',body:'the body text',slide:'the slide'}, offline:'Requires a configured assistant model.',
    simplerBody:'Simplify only the body text of the selected slide for grade 7. Keep the slide language and the other fields unchanged.',
    numeric:'Requires a table with a label column and numeric values.', chartPrompt:'Convert the numeric data on the selected slide into a chart.',
    examplePrompt:(field:string)=>`Add one concrete example to ${field} of the selected slide. Keep the original language and all other fields unchanged.`,
    translatePrompt:(field:string,language:string)=>`Translate ${field} into ${language} on the selected slide. Preserve the meaning and formatting. Leave any other fields and slides unchanged.`},
  ru: {example:'Добавить пример',chart:'Преобразовать в диаграмму',translate:'Перевести',custom:'Свой запрос',
    fields:{title:'заголовок',body:'основной текст',slide:'весь слайд'},offline:'Для этого действия нужна настроенная модель помощника.',
    simplerBody:'Упрости только основной текст выбранного слайда для 7 класса. Сохрани язык слайда и остальные поля.',
    numeric:'Нужна таблица с подписями в первом столбце и числами в остальных.',chartPrompt:'Преобразуй числовые данные выбранного слайда в диаграмму.',
    examplePrompt:(field:string)=>`Дополни примером выбранный элемент: ${field}. Сохрани исходный язык и остальные поля слайда.`,
    translatePrompt:(field:string,language:string)=>`Переведи выбранный элемент (${field}) выбранного слайда. Целевой язык: ${language}. Сохрани смысл, оформление и остальные элементы.`},
  kk: {example:'Мысал қосу',chart:'Диаграммаға айналдыру',translate:'Аудару',custom:'Өз сұрауым',
    fields:{title:'тақырып',body:'негізгі мәтін',slide:'бүкіл слайд'},offline:'Бұл әрекетке бапталған көмекші моделі қажет.',
    simplerBody:'Таңдалған слайдтың негізгі мәтінін ғана 7-сыныпқа лайықтап жеңілдет. Слайдтың тілін және қалған өрістерін сақта.',
    numeric:'Бірінші бағанында атаулар, қалған бағандарында сандар бар кесте қажет.',chartPrompt:'Таңдалған слайдтағы сандық деректерді диаграммаға айналдыр.',
    examplePrompt:(field:string)=>`Таңдалған слайдтың осы бөлігіне (${field}) бір нақты мысал қос. Бастапқы тілді және басқа өрістерді сақта.`,
    translatePrompt:(field:string,language:string)=>`Таңдалған слайдтың осы бөлігін аудар: ${field}. Аударма тілі: ${language}. Мағынасын, пішімін және қалған элементтерді сақта.`},
};
const targets: Record<Locale, string> = {kk:'Қазақша',ru:'Русский',en:'English'};

function CanvasCommands({field,openReview}: {field:CanvasTarget;openReview:()=>void}) {
  const {locale,deck,slide,running,deciding,editCanvas,canGenerateEdits} = useSession();
  const aui=useAui();
  const labels=canvasCopy[locale], actions=canvasActions[locale], text=strings[locale];
  const busy=running || Boolean(deciding) || slide.status!=='ready';
  const table=slide.table;
  const canChart=Boolean(numericTableValues(table));
  const itemClass='as-canvas-action';
  function request(prompt:string) { openReview(); editCanvas(prompt); }
  function custom() {
    openReview();
    const composer=aui.composer(), index=deck.slides.findIndex(item=>item.id===slide.id)+1;
    const mention=defaultDirectiveFormatter.serialize({type:'slide',id:slide.id,label:`${locale==='en'?'Slide':'Слайд'} ${index}`});
    composer.setText(`${mention} · ${actions.fields[field]} — ${composer.getState().text}`);
    requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.lesson-assistant .as-composer textarea')?.focus());
  }
  return <>
    <Menu.Item className={itemClass} disabled={busy || (field==='title' && !canGenerateEdits)} onClick={()=>request(field==='title' ? labels.shortTitle : text.shortenPrompt)}>
      {labels.shorten}
    </Menu.Item>
    <Menu.Item className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}
      onClick={()=>request(field==='title' ? labels.simpleTitle : field==='body' ? actions.simplerBody : text.simplerPrompt)}>{labels.simplify}</Menu.Item>
    <Menu.Item className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}
      onClick={()=>request(field==='slide' ? text.examplePrompt : actions.examplePrompt(actions.fields[field]))}>{actions.example}</Menu.Item>
    <Menu.Item className={itemClass} disabled={busy || !canChart} title={!canChart ? actions.numeric : undefined}
      onClick={()=>request(actions.chartPrompt)}>{actions.chart}</Menu.Item>
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}>
        {actions.translate}<CaretRightIcon aria-hidden size={13}/>
      </Menu.SubmenuTrigger>
      <Menu.Portal><Menu.Positioner className="as-canvas-positioner" sideOffset={3}>
        <Menu.Popup className="as-canvas-actions" aria-label={actions.translate}>
          {(Object.entries(targets) as [Locale,string][]).map(([language,name])=><Menu.Item key={language} className={itemClass}
            lang={language} onClick={()=>request(actions.translatePrompt(actions.fields[field],new Intl.DisplayNames([locale],{type:'language'}).of(language) ?? name))}>
            {name}
          </Menu.Item>)}
        </Menu.Popup>
      </Menu.Positioner></Menu.Portal>
    </Menu.SubmenuRoot>
    <Menu.Separator className="as-canvas-divider"/>
    <Menu.Item className={itemClass} disabled={busy} onClick={custom}>{actions.custom}</Menu.Item>
  </>;
}

export function CanvasAssistantMenu({trigger,field,openReview}: {trigger:ReactElement;field:'title'|'body';openReview:()=>void}) {
  const {locale}=useSession();
  return <ContextMenu.Root><ContextMenu.Trigger render={trigger}/>
    <ContextMenu.Portal><ContextMenu.Positioner className="as-canvas-positioner">
      <ContextMenu.Popup className="as-canvas-actions" aria-label={canvasCopy[locale].label}>
        <CanvasCommands field={field} openReview={openReview}/>
      </ContextMenu.Popup>
    </ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
}

export function CanvasAssistantDropdown({trigger,openReview}: {trigger:ReactElement;openReview:()=>void}) {
  const {locale}=useSession();
  return <Menu.Root><Menu.Trigger render={trigger}/>
    <Menu.Portal><Menu.Positioner className="as-canvas-positioner" align="end" sideOffset={5}>
      <Menu.Popup className="as-canvas-actions" aria-label={canvasCopy[locale].label}>
        <CanvasCommands field="slide" openReview={openReview}/>
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

function ProposalCard() {
  const { snapshot, deck, locale, decide, deciding, running } = useSession();
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
const parts = { Text: ReplyText, tools: { by_name: { propose_changes: ProposalCard } } };
function MessageHint({label,children}: {label:string;children:ReactElement}) {
  return <Tooltip><TooltipTrigger render={children}/><TooltipPopup>{label}</TooltipPopup></Tooltip>;
}

function ChatMessage() {
  const { snapshot, locale, deck, running, deciding, resend } = useSession();
  const aui = useAui();
  const id = useAuiState((s) => s.message.id);
  const copied = useAuiState((s) => s.message.isCopied);
  const index = snapshot.messages.findIndex(message=>message.id===id);
  const item = snapshot.messages[index];
  if (!item) return null;
  const t = strings[locale],
    user = item.role === 'user';
  const position = item.slideId ? deck.slides.findIndex((s) => s.id === item.slideId) : -1;
  const active = item.status === 'running';
  const text = user ? item.text : replyBody(item);
  const previous = snapshot.messages[index-1];
  const canResend = previous?.role==='user'
    && (!previous.slideId || deck.slides.some(slide=>slide.id===previous.slideId));
  return (
    <MessagePrimitive.Root role="article" aria-label={user ? t.you : t.name}
      className={cn('as-turn',user ? 'as-user' : 'as-assistant')} data-status={item.status}>
      {user && position >= 0 && <span className="sr-only">{t.slide} {position + 1}</span>}
      {active && !text && <AssistantWorking locale={locale}/>}
      {(!active || text) && <div className={cn("as-message-body",user && "as-user-bubble")}>
        {user ? <MessagePrimitive.Parts /> : <MessagePrimitive.Parts components={parts} />}
        {user && Boolean(item.fileNames?.length) && <ul className="as-sent-files">
          {item.fileNames!.map((name,index)=><li key={index}><FileTextIcon aria-hidden="true"/>{name}</li>)}
        </ul>}
        {item.status === 'cancelled' && !item.text && <p className="as-status">{t.stopped}</p>}
        {item.status === 'error' && !item.text && <p className="as-status">{t.error}</p>}
      </div>}
      <div className="as-message-details">
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
            aui.thread().composer().setText(item.text);
            event.currentTarget.closest('.lesson-assistant')?.querySelector('textarea')?.focus({preventScroll:true});
          }}><PencilLineIcon /></Button> : <>
          {text && <MessageHint label={copied?t.copied:t.copy}><ActionBarPrimitive.Copy render={<Button variant="ghost" size="icon-xs" />} aria-label={copied?t.copied:t.copy}>
            {copied ? <CheckIcon/> : <CopyIcon/>}
          </ActionBarPrimitive.Copy></MessageHint>}
          {text && <MessageHint label={t.export}><ActionBarPrimitive.ExportMarkdown render={<Button variant="ghost" size="icon-xs" />}
            filename="sabaq-reply.md" aria-label={t.export}><DownloadSimpleIcon/></ActionBarPrimitive.ExportMarkdown></MessageHint>}
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
  const {deck, locale, snapshot} = useSession();
  const t = strings[locale];
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
  const { locale, deck, slide, snapshot, loading, running, deciding, error, retry, reload, cloudSourceRag,
    pendingProposals, selectedProposal, chooseProposal, decide } = useSession();
  const composer = useRef<HTMLTextAreaElement>(null);
  const aui = useAui();
  const attached = useAuiState(state=>state.composer.attachments.length);
  const hasSaved = useAuiState(state=>state.composer.attachments.some(file=>attachmentSource(file)));
  const searchAll = useAuiState(state=>state.composer.runConfig.custom?.searchSourceLibrary===true);
  const sendSourceExcerpts = useAuiState(state=>state.composer.runConfig.custom?.useCloudSourceRag===true);
  const sourceScope = hasSaved || searchAll;
  const setRequestScope = useCallback((flag: 'searchSourceLibrary'|'useCloudSourceRag', value: boolean) => {
    const composer = aui.composer();
    const config = composer.getState().runConfig;
    composer.setRunConfig({...config,custom:{...config.custom,[flag]:value}});
  },[aui]);
  useEffect(()=>{ if (!sourceScope && sendSourceExcerpts) setRequestScope('useCloudSourceRag',false); },[sourceScope,sendSourceExcerpts,setRequestScope]);
  const t = strings[locale];
  const library = sourceCopy[locale];
  const number = deck.slides.findIndex(item=>item.id===slide.id)+1;
  const frequentActions = [
    { label: t.shorten, prompt: t.shortenPrompt, Icon: TextOutdentIcon },
    { label: t.simpler, prompt: t.simplerPrompt, Icon: StudentIcon },
    { label: t.example, prompt: t.examplePrompt, Icon: LightbulbIcon },
  ];
  const busy = loading || running || Boolean(deciding);
  const latestResponse = snapshot.messages.findLast(item=>item.role==='assistant');
  const activeMessage = latestResponse?.status==='running' ? latestResponse : undefined;
  const announcement = loading ? t.loading : activeMessage?.streamingText
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
          aria-label={t.transcript} aria-busy={loading} tabIndex={0}>
          {loading ? (
            <ConversationLoading label={t.loading}/>
          ) : !error && !snapshot.messages.length && !running && (
            <div className="as-empty">
              <h3>{t.empty}</h3>
              <p>{t.intro}</p>
              {slide.status==='ready' && <div className="as-suggestions" role="group" aria-label={t.actions}>
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
          {!busy && !error && <ThreadFollowupSuggestions aria-label={nextPrompts[locale].group}/>}
          {running && !activeMessage && <div className="as-waiting" aria-hidden="true"><TypingIndicator variant="bare"/></div>}
        </ThreadPrimitive.Viewport>
        <ThreadPrimitive.ScrollToBottom behavior="auto" render={<Button size="sm" variant="outline" />}
          className="as-jump" title={t.latest} aria-label={t.latest}><ArrowDownIcon/>{t.latest}</ThreadPrimitive.ScrollToBottom>
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
        {!busy && <AssistantMentions deck={deck} locale={locale}/>}
        <ComposerPrimitive.AttachmentDropzone className="as-composer-dropzone" disabled={busy || attached>=maxAssistantAttachments}
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
            autoFocus={false} addAttachmentOnPaste={!busy && attached<maxAssistantAttachments} placeholder={t.placeholder} aria-label={t.placeholder} />
        </ComposerPrimitive.AttachmentDropzone>
        <div className="as-composer-tools">
          <div className="as-composer-actions">
            <AssistantAttachButton locale={locale} disabled={busy || attached>=maxAssistantAttachments}/>
            <AssistantSourcePicker locale={locale} disabled={busy} onSearchAll={()=>setRequestScope('searchSourceLibrary',true)}/>
            <AssistantDictation locale={locale} disabled={busy} onTranscript={text=>{
              const draft=aui.composer().getState().text;
              aui.composer().setText([draft.trimEnd(),text].filter(Boolean).join(' ').slice(0,6000));
              composer.current?.focus();
            }}/>
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
