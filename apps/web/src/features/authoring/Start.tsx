import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  UsersThreeIcon,
  GraduationCapIcon,
  ImageIcon,
  TextTIcon,
  QuestionIcon,
  MinusCircleIcon,
  TimerIcon,
  ImagesSquareIcon,
  ListChecksIcon,
  BookOpenIcon,
  BooksIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  EyeIcon,
  FileTextIcon,
  HardDrivesIcon,
  PlusIcon,
  PresentationChartIcon,
  SlidersHorizontalIcon,
  NotePencilIcon,
  CpuIcon,
  StackIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { maxLessonSlides, minGeneratedSlides, type CreateInput, type Locale, type PowerPointStyle, type Provider, type Slide } from '@sabaq/lesson/types';
import { formatTimeUnit } from '@sabaq/lesson/speech-time';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { isTemplate, lessonTemplates, matchingTemplates, templatePlan, templateSubjects, type TemplateId } from '@sabaq/lesson/lesson-templates';
import { OptionSelect } from '@/components/OptionSelect';
import { LanguageFlag } from '@/components/LanguageFlag';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Button } from '@/components/coss/button';
import { Checkbox } from '@/components/coss/checkbox';
import { Input } from '@/components/coss/input';
import { Label } from '@/components/coss/label';
import { Radio, RadioGroup } from '@/components/coss/radio-group';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import { Textarea } from '@/components/coss/textarea';
import { languages, words } from '@/copy';
import { ApiError, request, runLimitMessage } from '@/lib/api';
import { useMediaCapabilities } from '@/lib/media';
import type { SourceFile } from '@sabaq/contracts/source-files';
import { SourceFilePicker } from '@/features/sources/SourceFilePicker';
import { sourceCopy } from '@/features/sources/source-copy';
import { sourceFileAccept, sourceFilePath, uploadSourceFile } from '@/features/sources/source-api';
import { OrganizationTemplates } from '@/features/organization/Organization';
import { CatalogCover } from './CatalogCover';
import { setupCopy } from './setup-copy';
import './start.css';

export type Template = TemplateId;
export type StartMode = 'topic' | 'file' | 'source' | 'pptx';
type Answers = NonNullable<CreateInput['answers']>;
const questions = ['level', 'duration', 'image', 'quiz'] as const;
const languageOptions = Object.entries(languages).map(([id, label]) => ({ value: id as Locale, label }));
const copy = {
  en: {
    research: 'Research with public sources', publicQuery: 'Public search query', savedSource: 'Saved source',
    settings: 'Lesson settings',
    brief: 'Lesson brief',
    sample: 'Sample slides',
    previous: 'Previous slide',
    next: 'Next slide',
    current: 'Selected template',
    edit: 'Edit brief',
    missingTopic: 'Enter a lesson topic.',
    templateFilter: 'Filter templates',
  },
  ru: {
    research: 'Исследовать открытые источники', publicQuery: 'Публичный поисковый запрос', savedSource: 'Сохранённый источник',
    settings: 'Параметры урока',
    brief: 'Основа урока',
    sample: 'Примеры слайдов',
    previous: 'Предыдущий слайд',
    next: 'Следующий слайд',
    current: 'Выбранный шаблон',
    edit: 'Изменить основу урока',
    missingTopic: 'Введите тему урока.',
    templateFilter: 'Фильтр шаблонов',
  },
  kk: {
    research: 'Ашық дереккөздерді зерттеу', publicQuery: 'Жалпыға ашық іздеу сұрауы', savedSource: 'Сақталған дереккөз',
    settings: 'Сабақ параметрлері',
    brief: 'Сабақ негізі',
    sample: 'Слайд үлгілері',
    previous: 'Алдыңғы слайд',
    next: 'Келесі слайд',
    current: 'Таңдалған үлгі',
    edit: 'Сабақ негізін өзгерту',
    missingTopic: 'Сабақ тақырыбын енгізіңіз.',
    templateFilter: 'Үлгілер сүзгісі',
  },
};

const catalogWords = {
  en:{use:'Use',subject:'Subject',grade:'Grade',allGrades:'All grades',allSubjects:'All subjects',topic:'Preview with your lesson topic',empty:'No templates match your search and filters.',clear:'Clear filters'},
  ru:{use:'Использовать',subject:'Предмет',grade:'Класс',allGrades:'Все классы',allSubjects:'Все предметы',topic:'Предпросмотр на теме вашего урока',empty:'По этому запросу и фильтрам шаблонов нет.',clear:'Сбросить фильтры'},
  kk:{use:'Қолдану',subject:'Пән',grade:'Сынып',allGrades:'Барлық сыныптар',allSubjects:'Барлық пәндер',topic:'Өз сабағыңыздың тақырыбымен көру',empty:'Сұрау мен сүзгілерге сәйкес үлгі табылмады.',clear:'Сүзгілерді тазалау'},
};

function sampleDeck(locale:Locale,id:Template,customTopic:string) {
  const preset=lessonTemplates[id];
  const topic=customTopic.trim() || preset.topic[locale];
  const plan=templatePlan(id,locale,topic,7);
  const example=plan[2];
  const slides:Slide[]=[plan[0],{title:words[locale].outline,summary:[topic,...plan.slice(1,-1).map(item=>item.title)].join(' · ')},
    {title:example.title,summary:customTopic.trim() ? example.summary : preset.scenario[locale]}].map((stage,index)=>({
    id:'sample-'+id+'-'+index,status:'ready',layout:index===0?'cover':'body',title:stage.title,body:stage.summary,notes:'',
    version:1,lessonPart:'lesson',
  }));
  return {language:locale,theme:preset.theme,slides};
}

export function Templates({locale,onChoose,organization=false}:{organization?:boolean;locale:Locale;onChoose:(id:Template,topic:string)=>void}) {
  const t=words[locale],s=copy[locale],labels=catalogWords[locale], ui=setupCopy[locale];
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('all');
  const [grade,setGrade]=useState('all');
  const [topic,setTopic]=useState(()=>readDraft(locale).topic);
  const [preview,setPreview]=useState<Template>();
  const previewTrigger=useRef<HTMLButtonElement>(null);
  const [index,setIndex]=useState(0);
  const query = search.trim().toLocaleLowerCase(locale);
  const visible=matchingTemplates(filter==='all'?undefined:filter,grade==='all'?undefined:Number(grade)).filter(id => {
    const preset = lessonTemplates[id];
    return !query || [preset.name[locale], preset.topic[locale], templateSubjects[preset.subject][locale]].some(text => text.toLocaleLowerCase(locale).includes(query));
  });
  const active=preview && sampleDeck(locale,preview,topic);
  const subjects=[{value:'all',label:labels.allSubjects},...Object.entries(templateSubjects).map(([value,name])=>({value,label:name[locale]}))];
  const grades=[{value:'all',label:labels.allGrades},...Array.from({length:11},(_,i)=>({value:String(i+1),label:String(i+1)}))];
  function choose(id:Template) {
    onChoose(id,topic.trim() || lessonTemplates[id].topic[locale]);
  }
  return (
    <div className="creation-page templates-page">
      <header className="creation-heading catalog-heading">
        <div><h1>{t.templates}</h1><p>{t.templateIntro}</p></div>
      </header>
      {organization && <OrganizationTemplates locale={locale}/>}
      <div className="template-filters" role="group" aria-label={s.templateFilter}>
        <label className="catalog-search-label"><span className="catalog-search-caption">{ui.search}</span>
          <span className="template-search"><MagnifyingGlassIcon aria-hidden/>
            <input type="search" placeholder={ui.placeholder} value={search} onChange={event=>setSearch(event.target.value)}/>
          </span>
        </label>
        <label>{labels.subject}<OptionSelect label={labels.subject} value={filter} options={subjects} onChange={setFilter}/></label>
        <label>{labels.grade}<OptionSelect label={labels.grade} value={grade} options={grades} onChange={setGrade}/></label>
        <label className="catalog-topic-label">{labels.topic}
          <span className="catalog-topic-input"><PencilSimpleIcon aria-hidden/><Input placeholder={ui.topicExample} maxLength={500} value={topic} onChange={event=>setTopic(event.target.value)}/></span>
        </label>
      </div>
      <p className="catalog-results" role="status">{ui.results(visible.length)}</p>
      {!visible.length && <div className="template-empty"><MagnifyingGlassIcon aria-hidden/><p>{labels.empty}</p>
        <Button variant="outline" onClick={()=>{setFilter('all');setGrade('all');setSearch('');}}>{labels.clear}</Button></div>}
      <div className="template-shelf">
        {visible.map(id => {
          const meta=lessonTemplates[id];
          return <article key={id} className="template-sheet">
            <button type="button" className="template-preview-trigger"
              onClick={event=>{previewTrigger.current=event.currentTarget;setPreview(id);setIndex(0);}}>
              <CatalogCover id={id} locale={locale} topic={topic}/>
              <span className="catalog-preview-label"><EyeIcon aria-hidden/>{t.preview}</span>
              <span className="sr-only"> · {meta.name[locale]}</span>
            </button>
            <div className="template-sheet-copy">
              <h2>{meta.name[locale]}</h2>
              <span className="template-category">{templateSubjects[meta.subject][locale]} · {labels.grade} {meta.min}–{meta.max}</span>
              <Button type="button" className="template-choose" variant="outline" size="icon-sm" aria-label={t.chooseTemplate+' · '+meta.name[locale]} title={t.chooseTemplate} onClick={() => choose(id)}>
                <span>{labels.use}</span><ArrowRightIcon aria-hidden/>
              </Button>
            </div>
          </article>;
        })}
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
      >
        {preview && active && (
          <DialogPopup className="template-dialog" bottomStickOnMobile={false} finalFocus={previewTrigger}
            closeProps={{'aria-label':t.close, title:t.close}} onKeyDown={event=>{
              const direction = event.key==='ArrowRight' ? 1 : event.key==='ArrowLeft' ? -1 : 0;
              if (direction) {
                event.preventDefault();
                setIndex(current=>Math.max(0, Math.min(active.slides.length-1, current+direction)));
              }
            }}>
            <DialogHeader className="template-dialog-head">
              <DialogTitle>{lessonTemplates[preview].name[locale]}</DialogTitle>
              <DialogDescription>{lessonTemplates[preview].scenario[locale]}</DialogDescription>
            </DialogHeader>
            <div className="template-dialog-stage">
              <SlideCanvas deck={active} slide={active.slides[index]} />
            </div>
            <div className="template-dialog-nav">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={s.previous}
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <CaretLeftIcon />
              </Button>
              <div className="template-preview-thumbs" role="group" aria-label={s.sample}>
                {active.slides.map((slide, position)=><div className="template-preview-thumb" key={slide.id}>
                  <span aria-hidden="true" inert><SlideCanvas deck={active} slide={slide}/></span>
                  <button type="button" aria-label={(position+1)+' / '+active.slides.length+' · '+slide.title}
                    aria-pressed={index===position} onClick={()=>setIndex(position)}/>
                </div>)}
              </div>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={s.next}
                disabled={index === active.slides.length - 1}
                onClick={() => setIndex(index + 1)}
              >
                <CaretRightIcon />
              </Button>
            </div>
            <footer>
              <span role="status">{s.sample} · {index + 1} / {active.slides.length}</span>
              <Button onClick={() => choose(preview)}>
                {t.chooseTemplate}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </footer>
          </DialogPopup>
        )}
      </Dialog>
    </div>
  );
}

type Draft = {
  creationId:string;
  topic: string;
  mode: StartMode;
  language: Locale;
  provider?: Provider;
  source: string;
  fileName: string;
  sampleSource: boolean;
  sourceDeckId?: string;
  sourceFiles?: SourceFile[];
  uploadedSource?: SourceFile;
  researchQuery?: string;
  review: boolean;
  step: number;
  answers: Answers;
  customAnswers?: Partial<Record<typeof questions[number],boolean>>;
  slideCount?: string;
  powerPointStyle?: PowerPointStyle;
  template?: Template;
};
const draftKey = 'sabaq:creation-draft:v1';
function imageBytes(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

function readDraft(locale: Locale, template?: Template): Draft {
  const initial: Draft = {
    creationId:crypto.randomUUID(),
    topic: '',
    mode: 'topic',
    language: locale,
    source: '',
    fileName: '',
    sampleSource: false,
    review: !matchMedia('(max-width: 720px)').matches,
    step: -1,
    answers: {},
  };
  let draft = initial;
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (raw) {
      const saved = JSON.parse(raw) as Draft;
      if (
        saved &&
        typeof saved.topic === 'string' &&
        ['kk', 'ru', 'en'].includes(saved.language) &&
        ['topic', 'file', 'pptx', 'source'].includes(saved.mode) &&
        Number.isInteger(saved.step) &&
        saved.step >= -1 &&
        saved.step < questions.length
      ) {
        draft = {
          ...initial,
          ...saved,
          creationId:typeof saved.creationId==="string" ? saved.creationId : initial.creationId,
          template: isTemplate(saved.template) ? saved.template : undefined,
        };
      }
    }
  } catch {
    /* The draft still works in memory when tab storage is unavailable. */
  }
  if (template && template !== draft.template) {
    const previous = draft.template;
    const wasTemplateTitle =
      previous && [...Object.values(lessonTemplates[previous].topic),...Object.values(lessonTemplates[previous].name)].includes(draft.topic);
    return {
      ...draft,
      template,
      step: -1,
      topic: !draft.topic.trim() || wasTemplateTitle ? lessonTemplates[template].topic[locale] : draft.topic,
    };
  }
  return draft;
}

export function Start({
  locale,
  initialMode,
  template,
  catalogTopic,
  alem,
  localAuthoring,
  researchTopics,
  onCreate,
  onBack,
  onTemplates,
  onImport,
}: {
  locale: Locale;
  template?: Template;
  initialMode?: StartMode;
  catalogTopic?: string;
  alem: boolean;
  localAuthoring: boolean;
  researchTopics: string[];
  onCreate: (input: CreateInput) => Promise<void>;
  onBack: () => void;
  onTemplates: () => void;
  onImport: (file: File, title: string, language: Locale, creationId: string, editable: boolean) => Promise<void>;
}) {
  const t = words[locale],
    s = copy[locale], ui = setupCopy[locale];
  const { ocr } = useMediaCapabilities();
  const [draft,setDraft]=useState(()=>{
    const saved=readDraft(locale,template);
    if (initialMode) return {...saved, mode:initialMode, step:-1};
    return template && catalogTopic!==undefined ? {...saved,template,topic:catalogTopic,mode:'topic' as const,step:0,researchQuery:undefined} : saved;
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [warning,setWarning] = useState<{token:string;blank:boolean}>();
  const [showSettings, setShowSettings] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const powerPointStyle = draft.powerPointStyle;
  const setPowerPointStyle = (style:PowerPointStyle|undefined) => setDraft(current => ({...current, powerPointStyle:style}));
  const [readingStyle,setReadingStyle]=useState(false);
  const styleRequest=useRef<AbortController | undefined>(undefined);
  useEffect(()=>()=>styleRequest.current?.abort(),[]);
  const templateWords={
    en:{label:'Use a PowerPoint design (.pptx)',remove:'Remove design',loading:'Reading template…',error:'Could not read the theme and slide master. Choose a PPTX up to 20 MB.'},
    ru:{label:'Оформление из файла PowerPoint (.pptx)',remove:'Убрать оформление',loading:'Чтение шаблона…',error:'Не удалось прочитать тему и образец слайдов. Выберите PPTX до 20 МБ.'},
    kk:{label:'PowerPoint дизайнын қолдану (.pptx)',remove:'Дизайнды алып тастау',loading:'Үлгі оқылуда…',error:'Тақырып пен слайд үлгісі оқылмады. 20 МБ-қа дейінгі PPTX файлын таңдаңыз.'},
  }[locale];
  async function readStyle(file?:File) {
    if (!file) return;
    styleRequest.current?.abort();setPowerPointStyle(undefined);setError('');
    if (file.size>20_000_000) {setReadingStyle(false);setError(templateWords.error);return;}
    const controller=new AbortController();styleRequest.current=controller;setReadingStyle(true);
    try {
      const response=await fetch('/api/import/powerpoint-style',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/octet-stream'},body:file});
      if (!response.ok) throw Error();
      const style:PowerPointStyle=await response.json();
      if (!controller.signal.aborted) setPowerPointStyle(style);
    } catch {if(!controller.signal.aborted)setError(templateWords.error);}
    finally {if(!controller.signal.aborted)setReadingStyle(false);}
  }
  const [importFile, setImportFile] = useState<File>();
  const [ownImage, setOwnImage] = useState<File>();
  const [ownImageAlt, setOwnImageAlt] = useState('');
  const [editablePptx, setEditablePptx] = useState(false);
  const selectedPptx = /\.pptx$/i.test(importFile?.name ?? '');
  const finishLock = useRef(false),
    fileRequest = useRef(0),
    fileExtraction = useRef<AbortController | undefined>(undefined),
    questionHeading = useRef<HTMLLegendElement>(null);
  useEffect(() => () => fileExtraction.current?.abort(), []);
  const topicField = useRef<HTMLTextAreaElement>(null);
  const { mode, language, topic, review, step, source, fileName, answers } = draft;
  const patch = (next: Partial<Draft>) => { setWarning(undefined); setError(''); setDraft((current) => ({ ...current, ...next })); };
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* Storage may be full. */
    }
  }, [draft]);
  useEffect(() => {
    if (step >= 0) questionHeading.current?.focus({ preventScroll: true });
  }, [step]);
  const sample = useMemo(() => makeFixtureDeck(language), [language]);
  const selectedFiles = mode==='source' ? draft.sourceFiles ?? [] : mode==='file' && draft.uploadedSource ? [draft.uploadedSource] : [];
  const activeSource =
    mode === 'source' && draft.sampleSource
      ? sample.source
      : mode === 'file' && source.trim()
        ? { name: fileName || t.sourceLabel, text: source.trim() }
        : undefined;
  const [savedSources, setSavedSources] = useState<{id: string; name: string}[]>([]);
  useEffect(() => {
    if (mode !== 'source') return;
    let active = true;
    void request<{id: string; name: string}[]>('/sources').then(items => { if (active) setSavedSources(items); }).catch(() => { if (active) setError(t.error); });
    return () => { active = false; };
  }, [mode, t.error]);
  const researchQuery = mode === 'topic' && researchTopics.includes(draft.researchQuery ?? '') ? draft.researchQuery : undefined;
  const canUseAlem = alem && mode === 'topic' && !researchQuery;
  const canUseLocal = localAuthoring && !researchQuery && mode !== 'pptx';
  const provider: Provider = draft.provider === 'fixture' ? 'fixture' : draft.provider === 'alem' && canUseAlem ? 'alem' :
    canUseLocal ? 'local' : canUseAlem ? 'alem' : 'fixture';
  const localName = {en:'Local AI',ru:'Локальный ИИ',kk:'Жергілікті ЖИ'}[locale];
  const localNote = {en:'Creates slides on this computer using the lesson and its source passages.',ru:'Создаёт слайды на этом компьютере по материалам урока и фрагментам источника.',kk:'Сабақ материалдары мен дереккөз үзінділерінен осы компьютерде слайдтар жасайды.'}[locale];
  const question = questions[step];
  function recordStart(answer?:typeof question) {
    void request('/usage/creation',{method:'POST',body:{id:draft.creationId,language,question:answer}}).catch(()=>undefined);
  }
  useEffect(()=>{recordStart();},[draft.creationId]);
  const choices = {
    level: [
      [t.middle, 'middle'],
      [t.secondary, 'secondary'],
      [t.adult, 'adult'],
    ],
    duration: ['10','20','45'].map(value=>[formatTimeUnit(Number(value),locale,'minute'),value]),
    image: [
      [t.usePictures, 'illustrations'],
      [ui.imageLed, 'image-led'],
      [ui.ownImages, 'own'],
      [t.noPictures, 'none'],
    ],
    quiz: [[ui.includeQuiz,'include'],[ui.omitQuiz,'omit']],
  };
  const activeAnswer = question === 'duration' && draft.slideCount !== undefined ? 'exact' :
    draft.customAnswers?.[question] ? 'custom' : answers[question] ?? '';
  const questionTitles = {level:ui.audience, duration:ui.time, image:ui.visuals, quiz:ui.quiz};
  const questionHints = {level:ui.audienceHint, duration:ui.timeHint, image:ui.visualsHint, quiz:ui.quizHint};
  const stepLabels = {level:ui.audienceShort, duration:ui.timeShort, image:ui.visualsShort, quiz:ui.quizShort};
  const answerIcons: Record<string, typeof ListChecksIcon> = {
    '': ListChecksIcon, middle: BookOpenIcon, secondary: GraduationCapIcon, adult: UsersThreeIcon,
    illustrations: ImageIcon, 'image-led': ImagesSquareIcon, own: UploadSimpleIcon, none: TextTIcon,
    include: QuestionIcon, omit: MinusCircleIcon, custom: PencilSimpleIcon, exact: StackIcon,
  };
  const customLabel = {level:ui.customLevel, duration:ui.customTime, image:ui.customImage, quiz:ui.customQuiz};
  const customField = {level:'level', duration:'duration', image:'imageInstruction', quiz:'quizInstruction'} as const;
  const customPlaceholder = {level:ui.customLevelHint, duration:'30', image:ui.customImageHint, quiz:undefined};
  function selectAnswer(value:string) {
    const custom = value === 'custom';
    const next: Answers = { ...answers };
    if (question === 'quiz') {
      next.quiz = value === 'omit' ? 'omit' : value ? 'include' : undefined;
      next.quizInstruction = undefined;
    } else if (question === 'image') {
      next.image = custom ? 'illustrations' : value;
      next.imageSource = value === 'own' || value === 'none' ? value : value ? 'ai' : undefined;
      next.imageInstruction = undefined;
    } else {
      next[question] = custom || value === 'exact' ? '' : value;
    }
    patch({
      customAnswers: {...draft.customAnswers,[question]:custom},
      ...(question==='duration' && {slideCount:value==='exact' ? draft.slideCount ?? '' : undefined}),
      answers:next,
    });
  }
  function answerText(key:typeof questions[number]) {
    if (key === 'duration' && draft.slideCount) return `${draft.slideCount} · ${ui.customSlidesHint}`;
    if (key === 'duration' && answers.duration && Number.isFinite(Number(answers.duration)))
      return formatTimeUnit(Number(answers.duration),locale,'minute');
    if (draft.customAnswers?.[key] && answers[customField[key]]) return answers[customField[key]];
    return choices[key].find(([,value]) => value === answers[key])?.[0] || answers[key] || t.auto;
  }
  const languagePicker = <div className="creation-language">
    <Label id="lesson-language-label" htmlFor="lesson-language">{t.lessonLanguage}</Label>
    <Select items={languageOptions} value={language} onValueChange={value=>{if (value) patch({language:value});}}>
      <SelectTrigger id="lesson-language" aria-labelledby="lesson-language-label"><LanguageFlag locale={language}/><SelectValue/></SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {languageOptions.map(item=><SelectItem key={item.value} value={item.value}><span className="creation-language-name"><LanguageFlag locale={item.value}/>{item.label}</span></SelectItem>)}
      </SelectPopup>
    </Select>
  </div>;
  const modes = [
    ['topic', t.topicOption, NotePencilIcon],
    ['file', t.fileOption, FileTextIcon],
    ['source', t.sourceLibrary, BooksIcon],
    ['pptx', t.importOption, PresentationChartIcon],
  ] as const;
  const settings = [
    ...(localAuthoring ? [{id:'local',label:localName,Icon:HardDrivesIcon}] : []),
    { id: 'alem', label: t.live, Icon: CpuIcon },
    { id: 'fixture', label: t.fixture, Icon: HardDrivesIcon },
  ] as const;

  async function finish(blank = false, confirmation?:string) {
    if (finishLock.current || readingStyle) return;
    finishLock.current = true;
    setBusy(true);
    setError('');
    setWarning(undefined);
    try {
      const attachment = !blank && answers.imageSource==='own' && ownImage
        ? {data:await imageBytes(ownImage),alt:ownImageAlt} : undefined;
      await onCreate({
        creationId:draft.creationId,
        moderationConfirmation:confirmation,
        powerPointStyle,
        ...(!blank && draft.slideCount && {slideCount:Number(draft.slideCount)}),
        ...(!blank && {imageMode:answers.image === 'none' ? 'none' : answers.image === 'image-led' ? 'image-led' : answers.image === 'illustrations' ? 'illustrated' : 'auto'}),
        topic: topic.trim() || (blank ? t.createBlank : t.topic),
        language,
        provider: blank ? 'fixture' : provider,
        review: blank || review,
        template: blank ? 'blank' : draft.template,
        answers:attachment ? {...answers,ownImage:attachment} : answers,
        ...(!blank && researchQuery ? { researchQuery } : {}),
        ...(!blank && (selectedFiles.length ? {sourceFileIds:selectedFiles.map(file=>file.id)} :
          mode==='source' && draft.sourceDeckId ? {sourceDeckId:draft.sourceDeckId} : activeSource ? {source:activeSource} : {})),
      });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Creation has succeeded. */
      }
    } catch (failure) {
      setError(failure instanceof ApiError ? (failure.status===429 ? runLimitMessage[locale] :
        ownImage && answers.imageSource==='own' && [413,415].includes(failure.status) ? ui.ownImageLimit : failure.message) : t.error);
      if (failure instanceof ApiError && failure.body.moderationConfirmation)
        setWarning({token:failure.body.moderationConfirmation,blank});
    } finally {
      finishLock.current = false;
      setBusy(false);
    }
  }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    fileExtraction.current?.abort();
    const version = ++fileRequest.current;
    setError('');
    setReadingFile(false);
    if (mode === 'file') patch({ fileName: '', source: '', uploadedSource: undefined });
    if (mode === 'pptx') {
      setImportFile(undefined);
      setEditablePptx(false);
    }
    const isImage = /\.(?:png|webp|jpe?g)$/i.test(file.name);
    if (file.size > (isImage ? 10_000_000 : 20_000_000)) {
      setError(mode === 'pptx' ? t.importHint : t.fileLimit);
      return;
    }
    if (mode === 'pptx') {
      if (!/\.(?:pptx|pdf|png|webp|jpe?g)$/i.test(file.name)) {
        setError(t.importHint);
        return;
      }
      setImportFile(file);
      patch({ topic: topic || file.name.replace(/\.[^.]+$/, '').slice(0, 160) });
      return;
    }
    setReadingFile(true);
    const controller = new AbortController();
    fileExtraction.current = controller;
    try {
      const uploadedSource = await uploadSourceFile(file,locale,ocr,controller.signal);
      const {text} = await request<{text:string}>(sourceFilePath(uploadedSource.id), {signal:controller.signal});
      if (fileRequest.current !== version) return;
      setDraft((current) => ({
        ...current,
        fileName: file.name,
        source: text,
        uploadedSource,
        topic: current.topic || file.name.replace(/\.[^.]+$/, '').slice(0, 160),
      }));
    } catch (error) {
      if (fileRequest.current===version && !(error instanceof DOMException && error.name==='AbortError')) {
        setError(error instanceof ApiError ? error.status===413 ? t.fileLimit :
          error.status>=500 || error.status===429 ? t.extractionUnavailable : t.unreadableFile : t.error);
      }
    } finally {
      if (fileRequest.current === version) {
        fileExtraction.current = undefined;
        setReadingFile(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (readingFile || finishLock.current) return;
    if (mode === 'pptx') {
      if (!importFile) { setError(t.importHint); return; }
      finishLock.current = true;
      setBusy(true);
      void onImport(importFile, topic.trim() || importFile.name, language, draft.creationId, selectedPptx && editablePptx)
        .then(() => { try { sessionStorage.removeItem(draftKey); } catch { /* Storage is optional. */ } })
        .catch(() => setError(t.importError))
        .finally(() => { finishLock.current = false; setBusy(false); });
      return;
    }
    if ((mode === 'file' || mode === 'source') && !activeSource && !selectedFiles.length && !(mode === 'source' && draft.sourceDeckId)) {
      patch({ step: -1 });
      setError(t.selectSource);
      return;
    }
    if (!topic.trim()) {
      patch({ step: -1 });
      setError(s.missingTopic);
      topicField.current?.focus();
      return;
    }
    if ((activeSource?.text.length ?? 0) > 100_000 || selectedFiles.reduce((sum,file)=>sum+file.characterCount,0)>100_000) {
      setError(t.fileLimit);
      return;
    }
    if (step < 0 && initialMode && location.hash === '#/start/' + initialMode) {
      // The input-method shortcut has been consumed. Refresh now resumes the saved question.
      history.replaceState(history.state, '', '#/start');
    }
    if(step>=0 && question) recordStart(question);
    if (step === questions.length - 1) void finish();
    else patch({ step: step + 1 });
  }
  const modeName = modes.find(([id]) => id === mode)![1];
  const previewName = mode === 'pptx' ? importFile?.name : fileName;
  return (
    <div className="creation-page">
      {step < 0 && (
        <div className="creation-back">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t.back}
          </Button>
        </div>
      )}
      <header className="creation-heading creation-heading-actions">
        <div>
          <h1>{step < 0 ? t.startLesson : t.detailTitle}</h1>
          {step >= 0 && <p>{t.detailIntro}</p>}
        </div>
        {step < 0 && (
          <Button className="creation-blank" variant="outline" size="sm" aria-label={t.createBlank} title={t.createBlank} disabled={busy} onClick={() => void finish(true)}>
            <PlusIcon data-icon="inline-start" />
            <span>{t.createBlank}</span>
          </Button>
        )}
      </header>
      <form className="creation-spread" onSubmit={submit} data-step={step < 0 ? 'compose' : 'questions'}>
        {step < 0 ? (
          <section className="creation-composer">
            <div className="creation-topic">
              <Label htmlFor="topic">{t.topic}</Label>
              <Textarea
                id="topic"
                ref={topicField}
                rows={3}
                maxLength={500}
                required
                value={topic}
                placeholder={t.topicHint}
                onChange={(e) => patch({ topic: e.target.value })}
              />
            </div>
            <fieldset className="creation-sources">
              <legend>{t.startFrom}</legend>
              <div>
                {modes.map(([id, label, Icon]) => (
                  <Button
                    type="button"
                    key={id}
                    variant="outline"
                    className="creation-mode"
                    aria-pressed={mode === id}
                    onClick={() => {
                      ++fileRequest.current;
                      fileExtraction.current?.abort();
                      setReadingFile(false);
                      patch({ mode: id });
                      setError('');
                    }}
                  >
                    <Icon weight="duotone" />
                    <span>{label}</span>
                    {mode === id && <CheckIcon className="creation-mode-check" />}
                  </Button>
                ))}
              </div>
            </fieldset>
            {(mode === 'file' || mode === 'pptx') && (
              <div className="creation-upload">
                <Label htmlFor="source-file">
                  <UploadSimpleIcon weight="duotone" />
                  <span>{t.upload}</span>
                  <Input
                    nativeInput
                    unstyled
                    id="source-file"
                    type="file"
                    accept={mode === 'pptx' ? '.pptx,.pdf,.png,.jpg,.jpeg,.webp' : sourceFileAccept(ocr)}
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      e.target.value = '';
                      void loadFile(selected);
                    }}
                  />
                </Label>
                <p role="status">{readingFile ? t.readingFile : mode === 'pptx'
                  ? t.importHint + (editablePptx ? '' : ' ' + t.importRasterHint)
                  : t.uploadHint + (ocr ? ' ' + t.scanHint : '')}</p>
                {previewName && (
                  <div className="creation-file">
                    <FileTextIcon />
                    <span>{previewName}</span>
                  </div>
                )}
                {mode === 'pptx' && selectedPptx && (
                  <div className="creation-editable-import">
                    <Label className="creation-review">
                      <Checkbox checked={editablePptx} onCheckedChange={setEditablePptx} disabled={busy}
                        aria-describedby="editable-pptx-description" />
                      {t.importEditable}
                    </Label>
                    <p id="editable-pptx-description">{t.importEditableHint}</p>
                  </div>
                )}
              </div>
            )}
            {mode === 'file' && (
              <div className="creation-topic">
                <Label htmlFor="source-text">{t.paste}</Label>
                <Textarea
                  id="source-text"
                  rows={4}
                  value={source}
                  maxLength={100_000}
                  onChange={(e) => {
                    ++fileRequest.current;
                    fileExtraction.current?.abort();
                    setReadingFile(false);
                    patch({ source: e.target.value, uploadedSource: undefined });
                  }}
                />
              </div>
            )}
            {mode === 'source' && <div className="grid justify-items-start gap-2">
              <SourceFilePicker locale={locale} limit={10} disabled={busy} selected={selectedFiles.map(file=>file.id)} onSelect={files=>{
                patch({sourceFiles:files,sourceDeckId:undefined,sampleSource:false,topic:topic || files[0]?.name.replace(/\.[^.]+$/,'') || ''});
              }}/>
              {selectedFiles.length>0 && <ul className="grid gap-1 text-sm" aria-label={sourceCopy[locale].title}>
                {selectedFiles.map(file=><li className="flex items-center gap-2 break-all" key={file.id}>
                  <FileTextIcon className="shrink-0 text-muted-foreground" aria-hidden/>{file.name}
                  <Button size="xs" variant="ghost" aria-label={`${sourceCopy[locale].deselect} · ${file.name}`}
                    onClick={()=>patch({sourceFiles:selectedFiles.filter(item=>item.id!==file.id)})}>
                    <MinusCircleIcon aria-hidden/>
                  </Button>
                </li>)}
              </ul>}
            </div>}
            {mode === 'source' && savedSources.length > 0 && <div className="creation-topic">
              <Label htmlFor="saved-source">{s.savedSource}</Label>
              <select id="saved-source" value={draft.sourceDeckId ?? ''} onChange={event => {
                const id = event.target.value;
                patch({ sourceDeckId: id, sourceFiles: undefined, sampleSource: false, topic: topic || savedSources.find(item => item.id === id)?.name || '' });
              }}>
                <option value="">—</option>
                {savedSources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>}
            {mode === 'topic' && researchTopics.length > 0 && <div className="creation-topic">
              <Label className="creation-review"><Checkbox checked={Boolean(researchQuery)}
                onCheckedChange={checked => patch({ researchQuery: checked ? researchTopics[0] : undefined })}/>{s.research}</Label>
              {researchQuery && <><Label htmlFor="public-query">{s.publicQuery}</Label>
                <select id="public-query" value={researchQuery} onChange={event => patch({ researchQuery: event.target.value })}>
                  {researchTopics.map(query => <option key={query}>{query}</option>)}
                </select></>}
            </div>}
            {mode === 'source' && (
              <div className="creation-sample-source">
                <div>
                  <FileTextIcon weight="duotone" />
                  <span>{sample.source?.name}</span>
                </div>
                <Button
                  type="button"
                  variant={draft.sampleSource ? 'secondary' : 'outline'}
                  aria-pressed={draft.sampleSource}
                  onClick={() => patch({ sampleSource: true, sourceDeckId: undefined, sourceFiles: undefined, topic: topic || sample.title })}
                >
                  {draft.sampleSource && <CheckIcon />}
                  {t.useSource}
                </Button>
              </div>
            )}
            {mode!=='pptx' && <details className="creation-design" open={powerPointStyle ? true : undefined}>
              <summary><PresentationChartIcon aria-hidden/>{ui.style}<CaretDownIcon aria-hidden/></summary><div className="creation-upload">
              <Label htmlFor="pptx-design">{templateWords.label}<Input id="pptx-design" type="file" accept=".pptx" disabled={busy} onChange={event=>{
                const file=event.target.files?.[0];event.target.value='';void readStyle(file);
              }}/></Label>
              {readingStyle && <p role="status">{templateWords.loading}</p>}
              {powerPointStyle && <div className="creation-file"><span>{powerPointStyle.name} · {powerPointStyle.headingFont} / {powerPointStyle.bodyFont}</span>
                <Button type="button" size="sm" variant="ghost" onClick={()=>setPowerPointStyle(undefined)}>{templateWords.remove}</Button></div>}
            </div></details>}
            <Button
              className="creation-template-link"
              type="button"
              variant="ghost"
              onClick={onTemplates}
            >
              <StackIcon data-icon="inline-start" />
              {draft.template ? lessonTemplates[draft.template].name[locale] : t.browseTemplates}
              <CaretRightIcon data-icon="inline-end" />
            </Button>
          </section>
        ) : (
          <section className="creation-composer creation-questions">
            <div className="creation-steps">
              <div className="creation-step-status" aria-hidden="true"><strong>{stepLabels[question]}</strong><span>{step + 1} / {questions.length}</span></div>
              <ol className="creation-progress" aria-label={t.detailTitle}>
                {questions.map((name, i) => (
                  <li key={name} aria-current={i === step ? 'step' : undefined} data-state={i < step ? 'done' : i === step ? 'active' : 'next'}>
                    <span className="creation-step-label"><b aria-hidden="true">{i < step ? <CheckIcon/> : i + 1}</b>{stepLabels[name]}</span>
                  </li>
                ))}
              </ol>
            </div>
            <fieldset className="creation-answer-set" key={question}>
              <legend id="creation-question-heading" tabIndex={-1} ref={questionHeading}>
                {questionTitles[question]}
              </legend>
              <p className="creation-question-hint">{questionHints[question]}</p>
              <RadioGroup name={question} value={activeAnswer} aria-labelledby="creation-question-heading"
                onValueChange={value=>selectAnswer(String(value))}>
                {[[t.auto, ''], ...choices[question], [customLabel[question],'custom'],
                  ...(question==='duration' ? [[ui.customSlides,'exact']] : [])].map(([label, value]) => {
                  const Icon = answerIcons[value] ?? TimerIcon;
                  return <Label className="creation-question" key={value} data-checked={activeAnswer === value}>
                    <span className="creation-answer-icon" aria-hidden><Icon/></span><span>{label}</span><Radio value={value}/>
                  </Label>;
                })}
              </RadioGroup>
              {activeAnswer==='custom' && <div className="creation-custom-field">
                <Label htmlFor="creation-custom-answer">{question==='duration' ? ui.customDurationHint : customLabel[question]}</Label>
                <Input id="creation-custom-answer" type={question==='duration'?'number':'text'} required min={question==='duration'?1:undefined}
                  maxLength={question==='level' ? 120 : 240} placeholder={customPlaceholder[question]} value={answers[customField[question]]??''}
                  onChange={event=>patch({answers:{...answers,[customField[question]]:event.target.value}})}/>
              </div>}
              {activeAnswer==='exact' && <div className="creation-custom-field">
                <Label htmlFor="creation-slide-count">{ui.customSlidesHint} · {minGeneratedSlides}–{maxLessonSlides}</Label>
                <Input id="creation-slide-count" type="number" min={minGeneratedSlides} max={maxLessonSlides} step={1} required
                  value={draft.slideCount??''} onChange={event=>patch({slideCount:event.target.value})}/>
              </div>}
              {question==='level' && languagePicker}
              {question==='image' && activeAnswer==='own' && <div className="creation-custom-field">
                <Label htmlFor="creation-own-image">{ui.uploadImage}</Label>
                <Input id="creation-own-image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{
                  const file=event.target.files?.[0];
                  if (file && (!file.size || file.size>10_000_000)) {
                    setOwnImage(undefined);
                    event.target.value='';
                    setError(ui.ownImageLimit);
                    return;
                  }
                  setError('');
                  setOwnImage(file);
                }}/>
                {ownImage && <><span>{ownImage.name}</span><Label htmlFor="creation-own-image-alt">{ui.ownImageAlt}</Label>
                  <Input id="creation-own-image-alt" value={ownImageAlt} maxLength={400} onChange={event=>setOwnImageAlt(event.target.value)}/>
                </>}
              </div>}
            </fieldset>
          </section>
        )}
        <aside className="creation-settings" data-brief={step>=0} aria-label={step < 0 ? s.settings : s.brief}>
          <h2>
            {step < 0 ? <SlidersHorizontalIcon /> : <BookOpenIcon />}
            {step < 0 ? s.settings : s.brief}
          </h2>
          <Button
            variant="ghost"
            className="creation-settings-toggle"
            type="button"
            aria-expanded={showSettings}
            aria-controls="lesson-creation-settings"
            onClick={() => setShowSettings((open) => !open)}
          >
            {step < 0 ? <SlidersHorizontalIcon /> : <BookOpenIcon />}
            <strong>{step < 0 ? s.settings : s.brief}</strong>
            <span className="creation-language-name"><LanguageFlag locale={language}/>{languages[language]}</span>
            <CaretDownIcon />
          </Button>
          <div id="lesson-creation-settings" className="creation-settings-body" data-open={showSettings}>
            {step < 0 ? (
              <>
                {languagePicker}
                {mode !== 'pptx' && <><Label className="creation-review">
                  <Checkbox
                    checked={review}
                    onCheckedChange={(checked) => patch({ review: checked })}
                  />
                  {t.reviewOutline}
                </Label>
                <fieldset className="creation-providers" aria-describedby="provider-note">
                  <legend id="creation-provider-label">{t.providerLabel}</legend>
                  <RadioGroup
                    aria-labelledby="creation-provider-label"
                    name="provider"
                    value={provider}
                    onValueChange={(value) => {
                      if (value === 'alem' || value === 'fixture' || value === 'local') patch({ provider: value });
                    }}
                  >
                    {settings.map(({ id, label, Icon }) => (
                      <Label key={id} data-disabled={(id === 'alem' && !canUseAlem) || (id === 'local' && !canUseLocal)}>
                        <Radio value={id} disabled={(id === 'alem' && !canUseAlem) || (id === 'local' && !canUseLocal)} />
                        <Icon />
                        <span>{label}</span>
                      </Label>
                    ))}
                  </RadioGroup>
                  <p id="provider-note">
                    {provider === 'local' ? localNote : provider === 'alem'
                      ? t.liveModeNote
                      : mode !== 'topic'
                        ? t.sourceModeNote
                        : !alem
                          ? t.liveUnavailable + ' ' + t.sampleModeNote
                          : t.sampleModeNote}
                  </p>
                </fieldset></>}
              </>
            ) : (
              <>
                {draft.template && <div className="creation-brief-cover" aria-hidden="true"><CatalogCover id={draft.template} locale={locale} topic={topic}/></div>}
                <strong className="creation-brief-title">{topic}</strong>
                <dl className="creation-brief">
                  <div>
                    <dt>{t.startFrom}</dt>
                    <dd>{modeName}</dd>
                  </div>
                  {draft.template && (
                    <div>
                      <dt>{s.current}</dt>
                      <dd>{lessonTemplates[draft.template].name[locale]}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t.lessonLanguage}</dt>
                    <dd><span className="creation-language-name"><LanguageFlag locale={language}/>{languages[language]}</span></dd>
                  </div>
                  <div>
                    <dt>{t.providerLabel}</dt>
                    <dd>{provider === 'local' ? localName : provider === 'alem' ? t.live : t.fixture}</dd>
                  </div>
                  {questions
                    .filter((_, index) => index <= step)
                    .map((key,index) => (
                      <div key={key}>
                        <dt>{stepLabels[key]}</dt>
                        <dd><button type="button" className="creation-answer-link" onClick={()=>patch({step:index})}>{answerText(key)}</button></dd>
                      </div>
                    ))}
                </dl>
                <Button type="button" variant="outline" size="sm" onClick={() => patch({ step: -1 })}>
                  {s.edit}
                </Button>
              </>
            )}
          </div>
        </aside>
        <footer className="creation-actions">
          {error && <p role="alert">{error}</p>}
          {warning && <Button type="button" variant="outline" disabled={busy} onClick={()=>void finish(warning.blank,warning.token)}>
            {{en:'Create anyway',ru:'Создать всё равно',kk:'Сонда да жасау'}[locale]}
          </Button>}
          {step < 0 ? (
            <span />
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => patch({ step: step - 1 })}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {t.back}
            </Button>
          )}
          <Button type="submit" disabled={busy || readingFile || readingStyle}>
            {busy
              ? t.working
              : mode === 'pptx' ? t.importSlides : step === questions.length - 1
                ? review
                  ? t.outline
                  : t.generate
                : t.continue}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </footer>
      </form>
    </div>
  );
}
