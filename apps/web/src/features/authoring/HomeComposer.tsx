import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessageNotSentError, ThreadPrimitive,
  useAui, useAuiEvent, useAuiState, useExternalStoreRuntime, type ThreadMessage,
} from '@assistant-ui/react';
import { ArrowUpIcon, CircleNotchIcon, FileTextIcon, MicrophoneIcon, PlusIcon, StopIcon } from '@phosphor-icons/react';
import type { CreateInput, Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { words } from '@/copy';
import { eligibleProviders, HomePromptSettings, selectedProvider, slideCountHint, validSlideCount, type PromptSettings } from './HomePromptSettings';
import { LessonBriefControls } from './LessonBriefControls';
import {
  AssistantComposerFiles, AssistantSourcePicker, assistantAttachmentCopy, attachmentSource, createAssistantAttachmentAdapter, maxAssistantAttachments,
} from '@/features/assistant/AssistantAttachments';
import { useOnDeviceDictation, voiceCopy } from '@/features/assistant/on-device-speech';
import { AlemDictation } from '@/features/assistant/AssistantVoice';
import { ApiError, runLimitMessage } from '@/lib/api';
import { useMediaCapabilities } from '@/lib/media';
import './home-composer.css';

const copy = {
  en: { prompt: 'Presentation brief', placeholder: 'What is the lesson about? Add a topic, notes, or a document…',
    attach: 'Attach source material', count: 'Slide count', slides: 'slides', language: 'Presentation language',
    generate: 'Generate', generating: 'Generating…', confirm: 'Create anyway', notes: 'Pasted notes', limit: 'Keep the combined notes and source documents within 100,000 characters.' },
  ru: { prompt: 'Задание для презентации', placeholder: 'О чём будет урок? Введите тему, вставьте конспект или добавьте документ…',
    attach: 'Прикрепить материалы', count: 'Количество слайдов', slides: 'слайдов', language: 'Язык презентации',
    generate: 'Создать', generating: 'Создаём…', confirm: 'Создать всё равно', notes: 'Текст конспекта', limit: 'Общий объём конспекта и материалов должен быть не более 100 000 символов.' },
  kk: { prompt: 'Презентация тапсырмасы', placeholder: 'Сабақтың тақырыбын жазыңыз, жазбаңызды енгізіңіз немесе құжат тіркеңіз…',
    attach: 'Материал тіркеу', count: 'Слайд саны', slides: 'слайд', language: 'Презентация тілі',
    generate: 'Жасау', generating: 'Жасалуда…', confirm: 'Сонда да жасау', notes: 'Сабақ жазбалары', limit: 'Жазбалар мен құжаттардың жалпы көлемін 100 000 таңбаға дейін қысқартыңыз.' },
};

const maxTopicLength = 500;
const maxSourceLength = 100_000;
type Answers = NonNullable<CreateInput['answers']>;
type Suggestion = {id: number; text: string};
const messages: readonly ThreadMessage[] = [];

type Props = {
  locale: Locale;
  alem: boolean;
  localAuthoring: boolean;
  suggestion?: Suggestion;
  researchTopics?: string[];
  onCreate(input: CreateInput): Promise<void>;
};

function ComposerControls({ locale, settings, answers, onSettings, onAnswers, suggestion, researchTopics, localAuthoring, alem, busy, error, confirm, onEdit, onError, onConfirm, alemSpeech, scanOcr }: {
  settings: PromptSettings;
  answers: Answers;
  onSettings(value: Partial<PromptSettings>): void;
  onAnswers(value: Answers): void;
  suggestion?: Suggestion;
  researchTopics: string[];
  localAuthoring: boolean;
  alem: boolean;
  locale: Locale;
  busy: boolean;
  error: string;
  confirm: boolean;
  onEdit(): void;
  onError(message: string): void;
  onConfirm(): void;
  alemSpeech: boolean;
  scanOcr: boolean;
}) {
  const t = copy[locale];
  const voice = voiceCopy[locale];
  const aui = useAui();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSuggestion = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!suggestion || lastSuggestion.current === suggestion.id) return;
    lastSuggestion.current = suggestion.id;
    aui.composer().setText(suggestion.text);
    inputRef.current?.focus({preventScroll: true});
    onEdit();
  }, [aui, suggestion, onEdit]);
  const language = settings.language ?? locale;
  const [recording, setRecording] = useState(false);
  const attachments = useAuiState(state => state.composer.attachments);
  const dictationAvailable = useAuiState(state => state.thread.capabilities.dictation);
  const speaking = useAuiState(state => state.composer.dictation?.status.type);
  const speechFailure = useAuiState(state => state.composer.lastDictationEnd?.error?.message);
  const notesLength = useAuiState(state => state.composer.text.trim().length > maxTopicLength ? state.composer.text.trim().length : 0);
  const tooLong = notesLength > maxSourceLength;
  const hasSource = attachments.length > 0 || notesLength > 0;
  const researching = !hasSource && researchTopics.includes(settings.researchQuery ?? '');
  const invalidCount = !validSlideCount(settings.count);
  const pending = attachments.some(file => file.status.type === 'running' || file.status.type === 'incomplete');
  const blocked = pending || tooLong || invalidCount || Boolean(speaking) || recording || attachments.length > maxAssistantAttachments;
  const feedback = error || (tooLong ? t.limit : invalidCount ? slideCountHint(locale) : speechFailure);
  useAuiEvent('composer.textChange', event => { if (event.origin === 'user') onEdit(); });
  useAuiEvent('composer.attachmentAdd', onEdit);
  useAuiEvent('composer.attachmentAddError', event => {
    if (!event.attachmentId) onError(assistantAttachmentCopy[locale].decode);
  });

  return <ThreadPrimitive.Root className="home-assistant">
    <ComposerPrimitive.Root aria-label={t.prompt} className="home-prompt" aria-busy={busy}
      onSubmit={event => { if (blocked) event.preventDefault(); }}>
      <ComposerPrimitive.AttachmentDropzone className="home-prompt-surface" disabled={busy || attachments.length >= maxAssistantAttachments}
        onDropCapture={event => {
          if (event.dataTransfer.files.length + attachments.length > maxAssistantAttachments) {
            event.preventDefault();
            onError(assistantAttachmentCopy[locale].limit);
          }
        }}>
        {attachments.length > 0 && <AssistantComposerFiles locale={locale}/>}
        {speaking && <div className="home-prompt-voice-status" role="status">
          {speaking === 'starting' ? voice.starting : voice.listening} <ComposerPrimitive.DictationTranscript/>
        </div>}
        {notesLength > 0 && <div className="home-prompt-notes"><FileTextIcon aria-hidden="true"/>{t.notes}</div>}
        <ComposerPrimitive.Input ref={inputRef} className="home-prompt-input" aria-label={t.prompt} placeholder={t.placeholder}
          maxRows={8} disabled={busy} enterKeyHint="send" submitMode={blocked ? 'none' : 'enter'}
          onPaste={event => {
            if (event.clipboardData.files.length + attachments.length > maxAssistantAttachments) {
              event.preventDefault();
              onError(assistantAttachmentCopy[locale].limit);
            }
          }}/>
        <div className="home-prompt-toolbar">
          <ComposerPrimitive.AddAttachment render={<Button variant="ghost" size="icon"/>} className="home-prompt-attach"
            multiple={false} disabled={busy || attachments.length >= maxAssistantAttachments}
            title={`${t.attach} · TXT, MD, PDF, DOCX${scanOcr ? ', PNG, JPG' : ''}`} aria-label={t.attach}>
            <PlusIcon aria-hidden="true"/>
          </ComposerPrimitive.AddAttachment>
          <AssistantSourcePicker locale={locale} disabled={busy}/>
        <LessonBriefControls locale={locale} answers={answers} onChange={onAnswers} disabled={busy}/>
          <span className="home-prompt-spacer" aria-hidden="true"/>
          <HomePromptSettings locale={locale} settings={settings} disabled={busy} onChange={onSettings} hasSource={hasSource}
            researchTopics={researchTopics} providers={researching ? ['fixture'] : eligibleProviders(localAuthoring, alem, hasSource)}/>
          {dictationAvailable && (speaking ?
            <ComposerPrimitive.StopDictation render={<Button variant="secondary" size="icon"/>} className="home-prompt-mic" title={voice.stopDictating} aria-label={voice.stopDictating}>
              <StopIcon weight="fill" aria-hidden="true"/>
            </ComposerPrimitive.StopDictation> :
            <ComposerPrimitive.Dictate render={<Button variant="ghost" size="icon"/>} className="home-prompt-mic" disabled={busy} title={voice.dictate} aria-label={voice.dictate}>
              <MicrophoneIcon aria-hidden="true"/>
            </ComposerPrimitive.Dictate>)}
          {!dictationAvailable && alemSpeech && <AlemDictation locale={locale} language={language} disabled={busy}
            className="home-prompt-mic home-cloud-dictation" onActive={setRecording} onTranscript={text => {
              const draft = aui.composer().getState().text;
              aui.composer().setText([draft.trimEnd(), text].filter(Boolean).join(' '));
              onEdit();
            }}/>}
          <ComposerPrimitive.Send render={<Button/>} className="home-prompt-send" disabled={busy || blocked} title={t.generate} aria-label={busy ? t.generating : t.generate}>
            {busy ? <CircleNotchIcon className="home-prompt-spinner" aria-hidden="true"/> : <ArrowUpIcon weight="bold" aria-hidden="true"/>}
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
      {feedback && <div className="home-prompt-error"><span role="alert">{feedback}</span>
        {confirm && <ComposerPrimitive.Send render={<Button variant="outline" size="sm"/>} disabled={busy || blocked} onClick={onConfirm}>{t.confirm}</ComposerPrimitive.Send>}
      </div>}
    </ComposerPrimitive.Root>
  </ThreadPrimitive.Root>;
}

export function HomeComposer({ locale, alem, localAuthoring, onCreate, suggestion, researchTopics = [] }: Props) {
  const [settings, setSettings] = useState<PromptSettings>(() => ({
    count: null, imageMode: 'auto', review: !matchMedia('(max-width: 720px)').matches,
  }));
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ token: string; signature: string }>();
  const explicitConfirmation = useRef(false);
  const lastRequest = useRef<{ id: string; signature: string } | undefined>(undefined);
  const submitting = useRef(false);
  const language = settings.language ?? locale;
  const media = useMediaCapabilities();
  const attachments = useMemo(() => createAssistantAttachmentAdapter(locale, media.ocr), [locale, media.ocr]);
  const dictation = useOnDeviceDictation(language);
  const clearError = () => { setError(''); setConfirmation(undefined); };
  const runtime = useExternalStoreRuntime({
    messages, adapters: {attachments, dictation}, isRunning: busy, isSendDisabled: busy,
    onNew: async message => {
      if (message.role !== 'user' || submitting.current) return;
      const attachments = message.attachments ?? [];
      const saved = attachments.map(attachmentSource).filter(file=>file!==undefined);
      if (attachments.length > maxAssistantAttachments || attachments.length!==saved.length) {
        setError(attachments.length > maxAssistantAttachments ? assistantAttachmentCopy[locale].limit : assistantAttachmentCopy[locale].decode);
        throw new MessageNotSentError();
      }
      const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim();
      const notes = text.length > maxTopicLength;
      const topic = (notes ? text.split(/\n|(?<=[.!?])\s/u)[0].slice(0, 160).trimEnd() : text)
        || saved[0]?.name.replace(/\.[^.]+$/, '') || words[locale].sourceLabel;
      const hasSource = saved.length > 0 || notes;
      const sourceLength = saved.reduce((total,file)=>total + file.characterCount, notes ? text.length : 0);
      if (sourceLength > maxSourceLength || !validSlideCount(settings.count)) {
        setError(!validSlideCount(settings.count) ? slideCountHint(locale) : copy[locale].limit);
        throw new MessageNotSentError();
      }
      const researchQuery = !hasSource && researchTopics.includes(settings.researchQuery ?? '') ? settings.researchQuery : undefined;
      const input: CreateInput = {
        topic, language, answers, imageMode: settings.imageMode, review: settings.review,
        provider: researchQuery ? 'fixture' : selectedProvider(settings.provider, eligibleProviders(localAuthoring, alem, hasSource)),
        ...(researchQuery && {researchQuery}),
        ...(settings.count !== null && {slideCount: Number(settings.count)}),
        ...(saved.length ? {sourceFileIds:[...new Set(saved.map(file=>file.id))], ...(notes && {sourceNotes:text})}
          : notes ? {source:{name:copy[locale].notes,text}} : {}),
      };
      // Reuse the request ID when a retry follows an uncertain network result.
      const signature = JSON.stringify(input);
      if (lastRequest.current?.signature !== signature) lastRequest.current = { id: crypto.randomUUID(), signature };
      const token = explicitConfirmation.current && confirmation?.signature === signature ? confirmation.token : undefined;
      explicitConfirmation.current = false;
      submitting.current = true;
      setBusy(true);
      clearError();
      try {
        await onCreate({...input, creationId: lastRequest.current.id, moderationConfirmation: token});
      } catch (failure) {
        setError(failure instanceof ApiError ? (failure.status === 429 ? runLimitMessage[locale] : failure.message) : words[locale].error);
        if (failure instanceof ApiError && failure.body.moderationConfirmation) {
          setConfirmation({ token: failure.body.moderationConfirmation, signature });
        }
        throw new MessageNotSentError();
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ComposerControls locale={locale} settings={settings} answers={answers} suggestion={suggestion} researchTopics={researchTopics} alem={alem} localAuthoring={localAuthoring} busy={busy} error={error} confirm={Boolean(confirmation)}
      alemSpeech={media.transcription.includes(language)} scanOcr={media.ocr}
      onError={setError} onEdit={clearError} onConfirm={() => { explicitConfirmation.current = true; }}
      onSettings={value => { clearError(); setSettings(current => ({...current, ...value})); }}
      onAnswers={value => { clearError(); setAnswers(value); }}/>
  </AssistantRuntimeProvider>;
}
