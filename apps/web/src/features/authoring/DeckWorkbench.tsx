import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, ArrowCounterClockwiseIcon, ClockIcon, FileTextIcon, GlobeIcon, PaintBrushIcon, PlusIcon, PresentationChartIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { formatSpeechTime, speechSeconds } from '@sabaq/lesson/speech-time';
import { spokenNarration } from '@sabaq/lesson/narration';
import { themeReasonText } from '@sabaq/lesson/themes';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { maxLessonSlides, minGeneratedSlides, type Deck, type EditOp, type Locale, type OutlineItem } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { Textarea } from '@/components/shadcn/textarea';
import { LanguageFlag } from '@/components/LanguageFlag';
import { request } from '@/lib/api';
import { OutlineActionsMenu } from './OutlineSlideControls';
import { slideLayoutNames } from '@/slide-layout-copy';
import { planCopy } from './outline-copy';
import { languages, words } from '@/copy';
import { ThemePicker } from '@/features/editor/ThemePicker';
import { ImageStylePicker } from '@/features/editor/ImageStylePicker';
import './workbench.css';

// A proxy can keep an SSE connection open while buffering its events. Each fresh
// deck revision postpones the fallback request so normal streaming stays inexpensive.
export function useAuthoringProgress(deck: Deck, receive: (next: Deck) => void) {
  const generating = deck.phase === 'generating' || deck.outlineStatus === 'generating';
  useEffect(() => {
    if (!generating) return;
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      try {
        const next = await request<Deck>('/decks/' + encodeURIComponent(deck.id), { signal: controller.signal });
        if (!controller.signal.aborted) receive(next);
      } catch { /* The next event or fallback request can recover an interrupted read. */ }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, 1500);
    }
    timer = window.setTimeout(refresh, 1500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [deck.id, deck.revision, generating, receive]);
}

const copy = {
  en: { appearance:'Slide appearance', brief:'Lesson brief', subject:'Topic', images:'Images', count:'Slides', spoken:'Speaking time', source:'Source', modes:{ auto:'Automatic', illustrated:'Illustrated', 'image-led':'Image-led', none:'No images' },
    undo:'Undo outline change', add:'Add slide', untitled:'Untitled slide', resume:'Resume generation', progress:'Generation progress', stopped:'Generation paused', status:{ ready:'Ready', generating:'Writing', pending:'Queued', failed:'Failed', cancelled:'Stopped' } },
  ru: { appearance:'Оформление слайдов', brief:'Задание к уроку', subject:'Тема', images:'Изображения', count:'Слайды', spoken:'Время выступления', source:'Источник', modes:{ auto:'Автоматически', illustrated:'С иллюстрациями', 'image-led':'Крупные изображения', none:'Без изображений' },
    undo:'Отменить изменение плана', add:'Добавить слайд', untitled:'Новый слайд', resume:'Продолжить создание', progress:'Ход создания', stopped:'Создание приостановлено', status:{ ready:'Готово', generating:'Создаётся', pending:'В очереди', failed:'Ошибка', cancelled:'Остановлено' } },
  kk: { appearance:'Слайдтардың безендірілуі', brief:'Сабақ тапсырмасы', subject:'Тақырып', images:'Суреттер', count:'Слайдтар', spoken:'Сөйлеу уақыты', source:'Дереккөз', modes:{ auto:'Автоматты', illustrated:'Иллюстрациямен', 'image-led':'Ірі суреттер', none:'Суретсіз' },
    undo:'Жоспар өзгерісін болдырмау', add:'Слайд қосу', untitled:'Жаңа слайд', resume:'Жасауды жалғастыру', progress:'Жасалу барысы', stopped:'Жасау тоқтатылды', status:{ ready:'Дайын', generating:'Жасалуда', pending:'Кезекте', failed:'Қате', cancelled:'Тоқтатылды' } },
};

function ProjectBrief({deck, locale}: {deck: Deck; locale: Locale}) {
  const c=copy[locale];
  return <section className="wb-panel wb-brief">
    <h2><FileTextIcon aria-hidden/>{c.brief}</h2>
    <p lang={deck.language}>{deck.topic}</p>
    <dl>
      <div><dt><GlobeIcon aria-hidden/>{words[locale].lessonLanguage}</dt><dd className="wb-language" lang={deck.language}><LanguageFlag locale={deck.language}/>{languages[deck.language]}</dd></div>
      <div><dt><PresentationChartIcon aria-hidden/>{c.images}</dt><dd>{deck.imageSource==='own' ? planCopy[locale].own : c.modes[deck.imageMode ?? 'auto']}</dd></div>
      {(deck.source?.name || deck.research?.query) && <div><dt><FileTextIcon aria-hidden/>{c.source}</dt><dd>{deck.source?.name || deck.research?.query}</dd></div>}
    </dl>
  </section>;
}

function Appearance({deck, locale, complete, onEdit}: {deck:Deck; locale: Locale; complete:boolean; onEdit:(op:EditOp)=>void}) {
  const opening=complete ? deck.outline[0] : undefined;
  const preview=deck.slides.find(slide=>slide.status==='ready') ?? {
    id:'outline-cover', status:'ready' as const, layout:'cover' as const, lessonPart:'',
    title:opening?.title || deck.topic, body:opening?.summary || '', notes:'', version:0,
  };
  return <section className="wb-panel wb-appearance"><h2><PaintBrushIcon aria-hidden/>{copy[locale].appearance}</h2>
    <div className="wb-theme-preview" aria-hidden="true" inert><SlideCanvas deck={deck} slide={preview}/></div>
    {deck.powerPointStyle ? <strong>{deck.powerPointStyle.name}</strong> : <ThemePicker deck={deck} locale={locale} value={deck.theme} onChange={theme=>onEdit({kind:'deck',theme})}/>}
    {!deck.brand && !deck.powerPointStyle && deck.themeRecommendation?.theme === deck.theme &&
      <small className="wb-theme-reason">{themeReasonText(deck.themeRecommendation, locale)}</small>}
    {deck.imageMode!=='none' && deck.imageSource!=='none' && deck.imageSource!=='own' &&
      <ImageStylePicker deck={deck} locale={locale} onChange={imageStyle=>onEdit({kind:'deck',imageStyle})}/>}
  </section>;
}

interface OutlineProps {deck:Deck; locale:Locale; busy:boolean; onEdit:(op:EditOp)=>void; onGenerate:()=>void; onRetry:()=>void}

export function Outline({deck,locale,busy,onEdit,onGenerate,onRetry}:OutlineProps) {
  const t=words[locale], c=copy[locale], fields=planCopy[locale];
  const history=useRef<OutlineItem[][]>([]);
  const [canUndo,setCanUndo]=useState(false);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [clearedTitle,setClearedTitle]=useState<string>();
  const addedTitle=useRef<string | undefined>(undefined);
  const items=deck.outline;
  const sections=items.map(item=>item.section?.trim());
  const count=items.length;
  const needsMoreSlides=deck.template !== 'blank' && !deck.slides.length && count < minGeneratedSlides && deck.outlineStatus !== 'generating' && deck.outlineStatus !== 'failed';
  const countHelp = {en:'Add slides to reach the 3-slide minimum.',ru:'Добавьте слайды: в плане должно быть не менее 3.',kk:'Жоспарда кемінде 3 слайд болуы керек.'}[locale];
  const complete=deck.outlineStatus==='complete' || (!deck.outlineStatus && count>0);
  const failed=deck.outlineStatus==='failed';
  const preparing=!complete && !failed;
  const placeholderCount=preparing ? Math.max(0, 3-count) : 0;
  const rate=deck.speechProfile?.language===deck.language ? deck.speechProfile.wordsPerMinute : undefined;
  const times=items.map(item=>{
    const spoken=spokenNarration(item.narrationDraft || item.summary,deck.language);
    return spoken ? speechSeconds(spoken,rate) : 0;
  });
  const seconds=times.reduce((total,time)=>total+time,0);
  function save(outline:OutlineItem[]) {
    history.current.push(items);
    if(history.current.length>30)history.current.shift();
    setCanUndo(true);
    onEdit({kind:'outline',outline});
  }
  function update(index:number, patch:Partial<OutlineItem>) {
    save(items.map((item,i)=>i===index ? {...item,...patch}:item));
  }
  function undo() {
    const previous=history.current.pop();
    if(previous)onEdit({kind:'outline',outline:previous});
    setCanUndo(history.current.length>0);
  }
  return <main className="deck-workbench wb-outline">
    <header className="wb-heading"><div><h1>{t.outline}</h1><p>{t.outlineIntro}</p></div><Button variant="outline" size="sm" className="wb-inspector-toggle" aria-controls="wb-style-details" aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(!inspectorOpen)}><PaintBrushIcon/>{c.appearance}</Button></header>
    <div className="wb-layout"><section className="wb-sequence" aria-labelledby="wb-sequence-heading">
      <div className="wb-section-heading">
        <h2 id="wb-sequence-heading">{t.slideSequence}</h2>
        {complete && count>0 && <span className="wb-count">{count}</span>}
        {preparing && <p className="wb-preparing" role="status">{t.outlineLoading}</p>}
        {complete && canUndo && <Button className="wb-undo" variant="ghost" size="sm" onClick={undo}><ArrowCounterClockwiseIcon/>{c.undo}</Button>}
      </div>
      {failed && <div className="wb-feedback" role="alert">
        <WarningCircleIcon aria-hidden/><p>{deck.outlineModerationNotice || t.failedOutline}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>{t.retry}</Button>
      </div>}
      {(count>0 || preparing) && <ol className="wb-outline-list" aria-busy={preparing}>{items.map((item,index)=>
        <li className="wb-outline-step" key={item.id}>
          {sections[index] && (index === 0 || sections[index] !== sections[index - 1]) &&
            <h3 className="wb-lesson-section" lang={deck.language}>{sections[index]}</h3>}
          <div className="wb-outline-item" id={'workbench-slide-'+item.id} tabIndex={-1}>
          <span className="wb-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
          <div className="wb-outline-copy">
            <Textarea rows={1} className="wb-outline-title" lang={deck.language} aria-label={t.outlineTitle+' '+(index+1)} maxLength={160}
              ref={node=>{if(node && addedTitle.current===item.id){addedTitle.current=undefined;node.focus();node.select();}}}
              value={clearedTitle===item.id?'':item.title} onBlur={()=>setClearedTitle(undefined)}
              onChange={event=>{const title=event.target.value.replace(/\n/g,' ');setClearedTitle(title.trim()?undefined:item.id);if(title.trim())update(index,{title});}}/>
            <Textarea className="wb-outline-summary" lang={deck.language} rows={1} aria-label={t.outlineSummary+' '+(index+1)} maxLength={600} value={item.summary}
              onChange={event=>update(index,{summary:event.target.value})}/>
            <div className="wb-slide-meta">
              <span><span className="sr-only">{fields.layout} </span>{slideLayoutNames[locale][item.layout]}</span>
              {item.assessment && <span>{fields.check}</span>}
              <span>{c.spoken} · {formatSpeechTime(times[index],locale)}</span>
            </div>
            <details className="wb-slide-details">
              <summary>{fields.details}</summary>
              {deck.imageSource!=='none' && deck.imageMode!=='none' && <label>{fields.visual}
                <Textarea rows={2} lang={deck.language} maxLength={400} value={item.visualDescription??''}
                  onChange={event=>update(index,{visualDescription:event.target.value})}/>
              </label>}
              {item.imageScenes?.map((description,scene)=><label key={scene}>{fields.scene} {scene+1}
                <Textarea key={description} rows={2} lang={deck.language} maxLength={400} defaultValue={description}
                  onBlur={event=>{
                    const next=event.currentTarget.value.trim();
                    const imageScenes=item.imageScenes!;
                    if (!next || imageScenes.some((other,position)=>position!==scene && other.toLowerCase()===next.toLowerCase())) {
                      event.currentTarget.value=description;
                      return;
                    }
                    if (next!==description) update(index,{imageScenes:imageScenes.map((other,position)=>position===scene ? next : other)});
                  }}/>
              </label>)}
              <label>{fields.narration}<Textarea rows={2} lang={deck.language} maxLength={2500} value={item.narrationDraft??''}
                onChange={event=>update(index,{narrationDraft:event.target.value})}/></label>
            </details>
          </div>
          <OutlineActionsMenu locale={locale} language={deck.language} items={items} index={index} disabled={busy||!complete} onChange={save}/>
          </div>
        </li>)}
        {Array.from({length:placeholderCount}, (_,index)=>(
          <li className="wb-outline-placeholder" aria-hidden="true" key={`pending-${count+index}`}>
            <span className="wb-placeholder-index"/><span className="wb-placeholder-copy"><span/><span/><span/></span>
          </li>
        ))}
      </ol>}
      {complete && <Button className="wb-add" variant="outline" disabled={busy||count>=maxLessonSlides} onClick={()=>{const id=crypto.randomUUID();addedTitle.current=id;save([...items,{id,title:c.untitled,summary:'',layout:'body'}]);}}><PlusIcon/>{c.add}</Button>}
      {complete && <footer className="wb-outline-bar">
        <div className="wb-bar-meta">
          <span>{fields.slides(count)}</span>
          {seconds>0 && <span><ClockIcon aria-hidden/>{formatSpeechTime(seconds,locale)}</span>}
        </div>
        {needsMoreSlides && <p id="wb-count-help" className="wb-count-help" role="status">{countHelp}</p>}
        <Button className="wb-primary" aria-describedby={needsMoreSlides?'wb-count-help':undefined} disabled={busy||needsMoreSlides} onClick={onGenerate}>{t.generate}<ArrowRightIcon aria-hidden/></Button>
      </footer>}
    </section>
    <aside className="wb-inspector" id="wb-style-details" data-open={inspectorOpen}><Appearance deck={deck} locale={locale} complete={complete} onEdit={onEdit}/><ProjectBrief deck={deck} locale={locale}/></aside></div>
  </main>;
}

export { Generation } from './GenerationStoryboard';
