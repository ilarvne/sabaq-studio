import { useContext, useEffect, useId, useRef, useState } from 'react';
import { cropRectangle, defaultImageCrop, type ImageCrop } from '@sabaq/lesson/image-crop';
import { isSlideSymbol, slidePictograms, type Deck, type Locale, type Slide, type SlideChanges, type SlideImage, type SlidePictogram } from '@sabaq/lesson/types';
import { ApiError, request } from '@/lib/api';
import { Button } from '@/components/coss/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Input } from '@/components/coss/input';
import { Textarea } from '@/components/coss/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/shadcn/collapsible';
import { Field, FieldLabel } from '@/components/shadcn/field';
import { Checkbox } from '@/components/coss/checkbox';
import { Skeleton } from '@/components/coss/skeleton';
import { ArrowClockwiseIcon, UploadSimpleIcon, CaretDownIcon, CheckIcon, CloudArrowUpIcon, CropIcon, GridFourIcon, ImageIcon, RectangleIcon, SlidersHorizontalIcon, WarningCircleIcon } from '@phosphor-icons/react';
import './lesson-image-editor.css';
import { OptionSelect } from '@/components/OptionSelect';
import { OrganizationImagePicker, OrganizationMember } from '@/features/organization/Organization';

export const imageWords={
  en:{place:'Place (optional)',period:'Historical period (optional)',unreviewed:'These images have not been checked by a vision model.',rejected:'None of the images passed the subject, setting and content checks. Try a more specific scene.',add:'Add image',edit:'Replace or crop image',file:'Upload image',scene:'Describe the scene',generate:'Generate four alternatives',alt:'Image description',decorative:'Decorative image',aspect:'Crop shape',original:'Original',wide:'Wide',square:'Square',portrait:'Portrait',horizontal:'Horizontal focus',vertical:'Vertical focus',zoom:'Zoom',radius:'Corner radius',save:'Apply image',cancel:'Cancel',choice:'Alternative',busy:'Processing image…',worker:'The illustration generator or local reviewer is unavailable.',failed:'Could not process the image.',limit:'Choose a PNG, JPEG or WebP up to 10 MB.'},
  ru:{place:'Место (необязательно)',period:'Эпоха (необязательно)',unreviewed:'Эти изображения не проверены моделью оценки.',rejected:'Ни один вариант не прошёл проверку темы, обстановки и содержания. Уточните описание сцены.',add:'Добавить изображение',edit:'Заменить или кадрировать изображение',file:'Загрузить изображение',scene:'Описание сцены',generate:'Сгенерировать четыре варианта',alt:'Описание изображения',decorative:'Декоративное изображение',aspect:'Форма кадра',original:'Исходная',wide:'Широкая',square:'Квадратная',portrait:'Вертикальная',horizontal:'Фокус по горизонтали',vertical:'Фокус по вертикали',zoom:'Приближение',radius:'Радиус углов',save:'Применить изображение',cancel:'Отмена',choice:'Вариант',busy:'Обработка изображения…',worker:'Сервис генерации или локальная модель оценки изображений недоступны.',failed:'Не удалось обработать изображение.',limit:'Выберите файл PNG, JPEG или WebP до 10 МБ.'},
  kk:{place:'Орын (міндетті емес)',period:'Тарихи кезең (міндетті емес)',unreviewed:'Бұл суреттерді бағалау моделі тексерген жоқ.',rejected:'Суреттердің ешқайсысы тақырып, орта және мазмұн бойынша тексеруден өтпеді. Көріністі нақтылап жазыңыз.',add:'Сурет қосу',edit:'Суретті ауыстыру немесе қиып алу',file:'Сурет жүктеу',scene:'Көріністі сипаттау',generate:'Төрт нұсқа жасау',alt:'Сурет сипаттамасы',decorative:'Сәндік сурет',aspect:'Кадр пішіні',original:'Бастапқы',wide:'Кең',square:'Шаршы',portrait:'Тік',horizontal:'Көлденең фокус',vertical:'Тік фокус',zoom:'Ұлғайту',radius:'Бұрыш радиусы',save:'Суретті қолдану',cancel:'Бас тарту',choice:'Нұсқа',busy:'Сурет өңделуде…',worker:'Сурет жасау қызметі немесе жергілікті бағалау моделі қолжетімсіз.',failed:'Суретті өңдеу мүмкін болмады.',limit:'10 МБ-ға дейінгі PNG, JPEG немесе WebP файлын таңдаңыз.'},
};

export const imageGridWords={
  en:{add:'Add image',edit:'Edit image',remove:'Remove image'},
  ru:{add:'Добавить изображение',edit:'Изменить изображение',remove:'Удалить изображение'},
  kk:{add:'Сурет қосу',edit:'Суретті өзгерту',remove:'Суретті алып тастау'},
};

const mediaKinds=['image','formula','pictogram'] as const;
const symbols={
  en:{type:'Media type',image:'Image',formula:'Math formula',pictogram:'Pictogram',latex:'LaTeX expression',formulaError:'Check the LaTeX expression or split it into shorter formulas.',save:'Apply to slide'},
  ru:{type:'Тип элемента',image:'Изображение',formula:'Математическая формула',pictogram:'Пиктограмма',latex:'Формула в LaTeX',formulaError:'Проверьте формулу LaTeX или разделите её на части.',save:'Применить на слайде'},
  kk:{type:'Элемент түрі',image:'Сурет',formula:'Математикалық формула',pictogram:'Пиктограмма',latex:'LaTeX формуласы',formulaError:'LaTeX формуласын тексеріңіз немесе бірнеше бөлікке бөліңіз.',save:'Слайдқа қолдану'},
};
const pictogramNames:Record<Locale,Record<SlidePictogram,string>>={
  en:{atom:'Atom',book:'Book',flask:'Flask',globe:'Globe',leaf:'Leaf',lightbulb:'Light bulb',ruler:'Ruler',triangle:'Triangle'},
  ru:{atom:'Атом',book:'Книга',flask:'Колба',globe:'Глобус',leaf:'Лист',lightbulb:'Лампочка',ruler:'Линейка',triangle:'Треугольник'},
  kk:{atom:'Атом',book:'Кітап',flask:'Құты',globe:'Глобус',leaf:'Жапырақ',lightbulb:'Шам',ruler:'Сызғыш',triangle:'Үшбұрыш'},
};

const workflowCopy = {
  en: {
    upload:'Upload', generate:'Generate', source:'Image source', drop:'Drop an image here', browse:'Choose a file',
    formats:'PNG, JPEG or WebP · Up to 10 MB', slide:'Slide', close:'Close', settings:'Scene details', crop:'Crop and position',
    replace:'Change image', back:'Back to selected image', preview:'Image preview', pending:'Generating four alternatives…', one:'Generate image', pendingOne:'Generating image…',
    unavailable:'Image generation is unavailable for this lesson. You can still upload an image.', key:'The OpenAI project key needs to be checked or renewed.', quota:'The OpenAI project has run out of image generation quota.',
    describe:'What should the viewer see?', access:'Describe what this image adds to the slide.', retry:'The image service is busy. Try again shortly.',
  },
  ru: {
    upload:'Загрузить', generate:'Сгенерировать', source:'Источник изображения', drop:'Перетащите изображение сюда', browse:'Выбрать файл',
    formats:'PNG, JPEG или WebP · До 10 МБ', slide:'Слайд', close:'Закрыть', settings:'Детали сцены', crop:'Кадрирование и положение',
    replace:'Сменить изображение', back:'К выбранному изображению', preview:'Предпросмотр изображения', pending:'Генерируем четыре варианта…', one:'Сгенерировать изображение', pendingOne:'Генерируем изображение…',
    unavailable:'Генерация изображений для этого урока недоступна. Вы можете загрузить изображение.', key:'Проверьте или обновите ключ проекта OpenAI.', quota:'Лимит генерации изображений в проекте OpenAI исчерпан.',
    describe:'Что должно быть на изображении?', access:'Опишите, что изображение поясняет на слайде.', retry:'Сервис изображений занят. Попробуйте чуть позже.',
  },
  kk: {
    upload:'Жүктеу', generate:'Жасау', source:'Сурет көзі', drop:'Суретті осында сүйреп әкеліңіз', browse:'Файл таңдау',
    formats:'PNG, JPEG немесе WebP · 10 МБ-қа дейін', slide:'Слайд', close:'Жабу', settings:'Көрініс параметрлері', crop:'Қию және орналастыру',
    replace:'Суретті ауыстыру', back:'Таңдалған суретке оралу', preview:'Суретті алдын ала қарау', pending:'Төрт нұсқа жасалып жатыр…', one:'Сурет жасау', pendingOne:'Сурет жасалып жатыр…',
    unavailable:'Бұл сабақ үшін сурет жасау қолжетімсіз. Дайын суретті жүктеуге болады.', key:'OpenAI жоба кілтін тексеріңіз немесе жаңартыңыз.', quota:'OpenAI жобасының сурет жасау лимиті таусылды.',
    describe:'Суретте не болуы керек?', access:'Сурет слайдта нені түсіндіретінін жазыңыз.', retry:'Сурет қызметі бос емес. Сәлден кейін қайталап көріңіз.',
  },
};

export function LessonImageEditor({deck,slide,locale,index=0,initialKind,save,close}: {deck:Deck;slide:Slide;locale:Locale;index?:number;initialKind?:'image'|'formula'|'pictogram';save:(c:SlideChanges)=>void;close:()=>void}) {
  const member=useContext(OrganizationMember);
  const t=imageWords[locale], path=`/decks/${encodeURIComponent(deck.id)}/images`;
  const initial=index ? slide.additionalImages?.[index-1] : slide.image;
  const w = workflowCopy[locale];
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const selectedForReview = useRef(false);
  const [source, setSource] = useState('upload');
  const [choosing, setChoosing] = useState(!initial || isSlideSymbol(initial));
  const [dragging, setDragging] = useState(false);
  const [generating, setGenerating] = useState<1|4>();
  const [canGenerate,setCanGenerate]=useState<boolean>();
  const provenance=initial?.provenance;
  const [kind,setKind]=useState<(typeof mediaKinds)[number]>(initialKind ?? (provenance?.source==='formula' || provenance?.source==='pictogram' ? provenance.source : 'image'));
  const [latex,setLatex]=useState(provenance?.source==='formula' ? provenance.latex : '');
  const [formulaAlt,setFormulaAlt]=useState(provenance?.source==='formula' ? initial?.alt ?? '' : '');
  const [icon,setIcon]=useState<SlidePictogram>(provenance?.source==='pictogram' ? provenance.icon : 'atom');
  const [iconAlt,setIconAlt]=useState(provenance?.source==='pictogram' ? initial?.alt ?? '' : pictogramNames[deck.language].atom);
  const [image,setImage]=useState(initial && !isSlideSymbol(initial) ? initial : undefined),[choices,setChoices]=useState<SlideImage[]>([]);
  const [crop,setCrop]=useState<ImageCrop>(initial?.crop ?? defaultImageCrop);
  const [prompt,setPrompt]=useState((initial?.alt || slide.title).slice(0,400)),[alt,setAlt]=useState(initial?.alt || '');
  const [place,setPlace]=useState(''),[period,setPeriod]=useState('');
  const [decorative,setDecorative]=useState(!!initial?.decorative),[size,setSize]=useState({width:1,height:1});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const job=useRef<AbortController | undefined>(undefined);
  useEffect(()=>()=>job.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();
    void request<{generate:boolean}>(path+'/capabilities',{signal:controller.signal})
      .then(result=>setCanGenerate(result.generate)).catch(()=>{if(!controller.signal.aborted)setCanGenerate(false);});
    return ()=>controller.abort();
  },[path]);
  useEffect(()=>{
    if (!choosing && selectedForReview.current) {
      selectedForReview.current = false;
      previewHeading.current?.focus({preventScroll:true});
    }
  },[choosing]);
  const stop=()=>{job.current?.abort();close();};
  const original=image?.originalSrc ?? image?.src;
  const rect=cropRectangle(size.width,size.height,crop);
  const types=symbols[locale];
  const canSave=kind==='formula' ? !!latex.trim() && !!formulaAlt.trim()
    : kind==='pictogram' ? !!iconAlt.trim() : !!image && !!original && (!!alt.trim() || decorative);
  function select(next:SlideImage) {
    selectedForReview.current = true;
    setImage(next); setAlt(next.alt); setCrop(next.crop ?? defaultImageCrop);
    setDecorative(Boolean(next.decorative)); setChoosing(false); setError('');
  }
  async function work(action:(signal:AbortSignal)=>Promise<void>) {
    if (job.current) return;
    const controller=new AbortController();job.current=controller;setBusy(true);setError('');
    try {await action(controller.signal);} catch (e) {
      if(!controller.signal.aborted) {
        if(e instanceof ApiError && kind==='formula' && [400,422].includes(e.status)) setError(types.formulaError);
        else if(e instanceof ApiError && e.status===503) {
          const code='code' in e.body ? e.body.code : undefined;
          setError(code==='image_provider_key' ? w.key : code==='image_provider_quota' ? w.quota : t.worker);
        }
        else if(e instanceof ApiError && [413,415].includes(e.status)) setError(t.limit);
        else if(e instanceof ApiError && e.status===422 && kind==='image') setError(generating || source==='generate' && choosing ? t.rejected : t.failed);
        else if(e instanceof ApiError && e.status===429) setError(w.retry);
        else setError(t.failed);
      }
    }
    finally {job.current=undefined;if(!controller.signal.aborted)setBusy(false);}
  }
  function apply() {
    if (!canSave) return;
    void work(async signal=>{
      let next:SlideImage;
      if(kind==='image') {
        if(!image || !original) return;
        const fitted=await request<Pick<SlideImage,'src'|'originalSrc'|'crop'>>(path+'/crop',{method:'POST',signal,body:{src:original,crop}});
        next={...image,...fitted,alt:decorative?'':alt.trim(),decorative};
      } else {
        const body=kind==='formula' ? {source:kind,latex:latex.trim(),alt:formulaAlt.trim()} : {source:kind,icon,alt:iconAlt.trim()};
        next=await request<SlideImage>(path+'/symbol',{method:'POST',signal,body});
      }
      signal.throwIfAborted();
      if (index) {
        const additionalImages=[...(slide.additionalImages ?? [])];
        additionalImages[index-1]=next;
        save({additionalImages,...(!initial && {layout:'image-grid'})});
      } else {
        const layout=slide.image ? undefined : slide.chart || slide.table || (slide.design?.variant && !['opening','reflection'].includes(slide.design.variant)) ? 'split' : slide.layout==='cover' ? 'cover' : 'image-right';
        save({image:next,...(layout && {layout})});
      }
      close();
    });
  }
  function upload(file: File | undefined) {
    if (!file || busy) return;
    if (file.size > 10_000_000 || (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      setError(t.limit);
      return;
    }
    void work(async signal => {
      const response = await fetch('/api'+path+'/upload', {
        method:'POST', signal, headers:{'Content-Type':'application/octet-stream'}, body:file,
      });
      if (!response.ok) throw new ApiError(response.status, await response.json().catch(()=>({})));
      const uploaded: SlideImage = await response.json();
      signal.throwIfAborted();
      select(uploaded); setChoices([]);
    });
  }
  function generate(count:1|4) {
    if (!canGenerate || !prompt.trim() || busy) return;
    void work(async signal => {
      setGenerating(count);
      try {
        const result = await request<SlideImage[]>(path+'/variants', {method:'POST', signal, body:{
          prompt:prompt.trim(), alt:prompt.trim(), slideId:slide.id, place:place.trim() || undefined, period:period.trim() || undefined, count,
        }});
        signal.throwIfAborted();
        setChoices(result);
        if (count===1 && result[0]) select(result[0]);
      } finally { if(!signal.aborted)setGenerating(undefined); }
    });
  }
  const slideNumber = deck.slides.findIndex(item=>item.id===slide.id) + 1;
  const title = kind !== 'image' ? types[kind]
    : index ? (initial ? imageGridWords[locale].edit : imageGridWords[locale].add)+' '+(index+1)
    : initial ? t.edit : t.add;
  const showSource = kind === 'image' && (choosing || !original);
  const range = (field:'x'|'y'|'zoom'|'radius', label:string, max:number, min=0, step=1) => (
    <label className="im-range">
      <span>{label}<output>{crop[field]}{field==='zoom' ? '×' : '%'}</output></span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={crop[field]}
        onChange={event=>setCrop({...crop,[field]:Number(event.target.value)})}/>
    </label>
  );
  return (
    <Dialog open onOpenChange={open=>{if(!open)stop();}}>
      <DialogPopup className="im-dialog" closeProps={{'aria-label':w.close, title:w.close}}>
        <DialogHeader className="im-header">
          <span className="im-header-mark" aria-hidden><ImageIcon weight="duotone"/></span>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription><RectangleIcon aria-hidden/>{w.slide} {slideNumber}
              {slide.title && <> · <span lang={deck.language}>{slide.title}</span></>}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogPanel className="im-panel" scrollFade={false}>
          <fieldset className="im-fields" disabled={busy}>
            {showSource && (
              <Tabs value={source} onValueChange={value=>{setSource(String(value));setError('');}} className="im-sources">
                <TabsList className="im-tabs" aria-label={w.source} activateOnFocus>
                  <TabsTrigger value="upload" disabled={busy}><UploadSimpleIcon aria-hidden/>{w.upload}</TabsTrigger>
                  <TabsTrigger value="generate" disabled={busy}><GridFourIcon aria-hidden/>{w.generate}</TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="im-upload">
                  <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={t.file}
                    onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';upload(file);}}/>
                  <button type="button" className="im-drop" aria-label={t.file} aria-describedby={id+'-formats'}
                    data-dragging={dragging} onClick={()=>fileInput.current?.click()}
                    onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}}
                    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}}
                    onDrop={event=>{event.preventDefault();setDragging(false);upload(event.dataTransfer.files[0]);}}>
                    <span className="im-upload-mark"><CloudArrowUpIcon aria-hidden weight="duotone"/></span>
                    <strong>{w.drop}</strong>
                    <span id={id+'-formats'} className="im-hint">{w.formats}</span>
                    <span className="im-browse">{w.browse}</span>
                  </button>
                  {member && <OrganizationImagePicker locale={locale} choose={asset=>{
                    select({src:asset.src,alt:asset.name,provenance:{source:'upload'}});setChoices([]);
                  }}/>}
                </TabsContent>
                <TabsContent value="generate" className="im-generation">
                  {canGenerate===false ? <p className="im-hint">{w.unavailable}</p> : <>
                  <Field><FieldLabel htmlFor={id+'-scene'}>{t.scene}</FieldLabel>
                    <Textarea id={id+'-scene'} lang={deck.language} rows={3} maxLength={400} value={prompt}
                      placeholder={w.describe} onChange={event=>setPrompt(event.target.value)}/>
                  </Field>
                  <Collapsible className="im-disclosure">
                    <CollapsibleTrigger className="im-summary"><SlidersHorizontalIcon aria-hidden/>{w.settings}<CaretDownIcon aria-hidden/></CollapsibleTrigger>
                    <CollapsibleContent className="im-disclosure-panel">
                      <div className="im-pair">
                        <Field><FieldLabel htmlFor={id+'-place'}>{t.place}</FieldLabel>
                          <Input id={id+'-place'} value={place} maxLength={160} onChange={e=>setPlace(e.target.value)}/>
                        </Field>
                        <Field><FieldLabel htmlFor={id+'-period'}>{t.period}</FieldLabel>
                          <Input id={id+'-period'} value={period} maxLength={160} onChange={e=>setPeriod(e.target.value)}/>
                        </Field>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  <div className="im-generate-actions">
                    <Button disabled={busy || !canGenerate || !prompt.trim()} className="im-generate" onClick={()=>generate(1)}>
                      <ImageIcon aria-hidden data-icon="inline-start"/>{w.one}
                    </Button>
                    <Button variant="outline" disabled={busy || !canGenerate || !prompt.trim()} className="im-generate" onClick={()=>generate(4)}>
                      <GridFourIcon aria-hidden data-icon="inline-start"/>{t.generate}
                    </Button>
                  </div>
                  {generating && <div className="im-variants" aria-hidden>{Array.from({length:generating},(_,i)=><Skeleton key={i}/>)}</div>}
                  {!generating && !!choices.length && <div className="im-variants" role="group" aria-label={t.generate}>
                    {choices.map((asset,i)=><button type="button" key={asset.src} aria-label={t.choice+' '+(i+1)}
                      aria-pressed={original===asset.src} onClick={()=>select(asset)}>
                      <img src={asset.src} alt=""/><span>{original===asset.src && <CheckIcon aria-hidden/>}{i+1}</span>
                    </button>)}
                  </div>}
                  {!generating && choices.some(asset=>asset.provenance?.source==='generated' && !asset.provenance.review) &&
                    <p className="im-hint">{t.unreviewed}</p>}
                  </>}
                </TabsContent>
              </Tabs>
            )}
            {kind==='image' && !showSource && original && <>
              <div className="im-selected-head"><h3 ref={previewHeading} tabIndex={-1}>{w.preview}</h3>
                <Button size="sm" variant="ghost" onClick={()=>{setChoosing(true);setError('');}}><ArrowClockwiseIcon aria-hidden/>{w.replace}</Button>
              </div>
              <div className="im-board">
                <div className="im-crop-preview" style={{width:`min(100%, ${174*rect.width/rect.height}px)`, aspectRatio:`${rect.width}/${rect.height}`,
                  borderRadius:`${crop.radius*Math.min(1,rect.height/rect.width)}% / ${crop.radius*Math.min(1,rect.width/rect.height)}%`}}>
                  <img src={original} alt={decorative?'':alt} onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
                    style={{width:100*size.width/rect.width+'%',height:100*size.height/rect.height+'%',left:-100*rect.left/rect.width+'%',top:-100*rect.top/rect.height+'%'}}/>
                </div>
              </div>
              {image?.provenance?.source==='generated' && !image.provenance.review && !image.decorative && <p className="im-hint">{t.unreviewed}</p>}
              <Collapsible className="im-disclosure">
                <CollapsibleTrigger className="im-summary"><CropIcon aria-hidden/>{w.crop}<CaretDownIcon aria-hidden/></CollapsibleTrigger>
                <CollapsibleContent className="im-disclosure-panel">
                  <div className="im-crop-controls">
                    <div className="im-select-row"><span>{t.aspect}</span>
                      <OptionSelect label={t.aspect} value={crop.aspect} options={(['original','wide','square','portrait'] as const).map(value=>({value,label:t[value]}))}
                        onChange={aspect=>setCrop({...crop,aspect})}/>
                    </div>
                    <div className="im-pair">{range('x',t.horizontal,100)}{range('y',t.vertical,100)}{range('zoom',t.zoom,5,1,.1)}{range('radius',t.radius,50)}</div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Field><FieldLabel htmlFor={id+'-alt'}>{t.alt}</FieldLabel>
                <Textarea id={id+'-alt'} rows={2} value={alt} maxLength={1000} disabled={decorative} placeholder={w.access} onChange={e=>setAlt(e.target.value)}/>
              </Field>
              <label className="im-check"><Checkbox checked={decorative} onCheckedChange={setDecorative}/>{t.decorative}</label>
            </>}
            {kind==='formula' && <>
              <Field><FieldLabel htmlFor={id+'-latex'}>{types.latex}</FieldLabel>
                <Textarea id={id+'-latex'} rows={3} maxLength={500} value={latex} placeholder={String.raw`\frac{a}{b}, \sqrt{x^2}, x_1`} onChange={e=>setLatex(e.target.value)}/>
              </Field>
              <Field><FieldLabel htmlFor={id+'-formula-alt'}>{t.alt}</FieldLabel>
                <Textarea id={id+'-formula-alt'} rows={2} maxLength={1000} value={formulaAlt} onChange={e=>setFormulaAlt(e.target.value)}/>
              </Field>
            </>}
            {kind==='pictogram' && <>
              <div className="im-select-row"><span>{types.pictogram}</span><OptionSelect label={types.pictogram} value={icon}
                options={slidePictograms.map(value=>({value,label:pictogramNames[locale][value]}))}
                onChange={value=>{setIcon(value);setIconAlt(pictogramNames[deck.language][value]);}} disabled={busy}/></div>
              <Field><FieldLabel htmlFor={id+'-pictogram-alt'}>{t.alt}</FieldLabel>
                <Textarea id={id+'-pictogram-alt'} rows={2} maxLength={1000} value={iconAlt} onChange={e=>setIconAlt(e.target.value)}/>
              </Field>
            </>}
          </fieldset>
          {busy && <p role="status" className="im-status">{generating===4 ? w.pending : generating===1 ? w.pendingOne : t.busy}</p>}
          {error && <p role="alert" className="im-error"><WarningCircleIcon aria-hidden/>{error}</p>}
        </DialogPanel>
        <DialogFooter className="im-footer">
          <div className="im-kind"><span>{types.type}</span>
            <OptionSelect label={types.type} value={kind} size="sm" options={mediaKinds.map(value=>({value,label:types[value]}))}
              onChange={value=>{setKind(value);setError('');}} disabled={busy}/>
          </div>
          <div className="im-buttons">
            {!!index && initial && <Button variant="destructive" disabled={busy} onClick={()=>{
              const additionalImages=(slide.additionalImages ?? []).filter((_,i)=>i!==index-1);
              save({additionalImages,...(!additionalImages.length && slide.layout==='image-grid' && {layout:'image-right'})});close();
            }}>{imageGridWords[locale].remove+' '+(index+1)}</Button>}
            <Button variant="ghost" onClick={stop}>{t.cancel}</Button>
            {showSource && original && <Button variant="outline" disabled={busy} onClick={()=>{setChoosing(false);setError('');}}>{w.back}</Button>}
            {!showSource && <Button disabled={busy || !canSave} onClick={apply}>{kind==='image'?t.save:types.save}</Button>}
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
