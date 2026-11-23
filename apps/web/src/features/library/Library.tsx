import { useRef, useState } from 'react';
import { ArrowRightIcon, StackIcon, BooksIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, EyeIcon, ListBulletsIcon, MagnifyingGlassIcon, PlusIcon, PresentationChartIcon, SlidersHorizontalIcon, SquaresFourIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { languages, words } from '@/copy';
import { formatStudioDate } from '@/lib/date';
import { LanguageFlag } from '@/components/LanguageFlag';
import { Badge } from '@/components/shadcn/badge';
import { Button, buttonVariants } from '@/components/shadcn/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/shadcn/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/shadcn/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/shadcn/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/shadcn/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/shadcn/input-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/shadcn/item';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/shadcn/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/shadcn/sheet';
import { Skeleton } from '@/components/shadcn/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import { useMediaQuery } from '@/components/coss/use-media-query';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { reviewText } from '@/features/presentation/review-copy';
import { lessonTemplates, type TemplateId as Template } from '@sabaq/lesson/lesson-templates';
import './library.css';

const pageSize = 8;
const languageOptions = Object.entries(languages).map(([value,label]) => ({value,label}));
const quickTemplates = [
  {id:'measurement',description:'measurementBody'},
  {id:'explain',description:'explainBody'},
  {id:'revise',description:'reviseBody'},
] as const;
const copy = {
  en:{recent:'Continue working',latest:'Latest lesson',template:'Start from a template',lessons:'Lessons',status:'Status',draft:'Draft',overview:'Slide overview',preview:'Preview lesson',slidePreview:'Slide preview',empty:'No slides ready',filters:'Filters',display:'View',done:'Done',searchClear:'Clear search',matches:'Search results',previous:'Previous',next:'Next',slides:(n:number)=>`${n} ${n===1?'slide':'slides'}`,rows:(n:number)=>`${n} ${n===1?'lesson':'lessons'}`},
  ru:{recent:'Продолжить работу',latest:'Последний урок',template:'Начать с шаблона',lessons:'Уроки',status:'Статус',draft:'Черновик',overview:'Обзор слайдов',preview:'Просмотр урока',slidePreview:'Просмотр слайда',empty:'Готовых слайдов пока нет',filters:'Фильтры',display:'Вид',done:'Готово',searchClear:'Очистить поиск',matches:'Результаты поиска',previous:'Назад',next:'Далее',slides:(n:number)=>`${n} ${n%10===1&&n%100!==11?'слайд':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'слайда':'слайдов'}`,rows:(n:number)=>`Уроков: ${n}`},
  kk:{recent:'Жұмысты жалғастыру',latest:'Соңғы сабақ',template:'Үлгіден бастау',lessons:'Сабақтар',status:'Күйі',draft:'Нобай',overview:'Слайдтар шолуы',preview:'Сабақты алдын ала көру',slidePreview:'Слайдты алдын ала көру',empty:'Дайын слайдтар жоқ',filters:'Сүзгілер',display:'Көрініс',done:'Дайын',searchClear:'Іздеуді тазарту',matches:'Іздеу нәтижелері',previous:'Алдыңғы',next:'Келесі',slides:(n:number)=>`${n} слайд`,rows:(n:number)=>`${n} сабақ`},
};

function ready(deck:Deck) {
  return deck.phase==='editing' && deck.slides.length>0 && deck.slides.every(slide=>slide.status==='ready');
}

function lessonSize(deck:Deck) {
  return deck.slides.length || deck.outline.length;
}

function href(deck:Deck, view?:'grid'|'present') {
  return `#/deck/${encodeURIComponent(deck.id)}${view?'/'+view:''}`;
}

function LessonImage({deck,slide,thumbnail=false}:{deck:Deck;slide?:Slide;thumbnail?:boolean}) {
  if (!slide) return <div className="library-outline-cover">
    <StackIcon aria-hidden/>
    <strong lang={deck.language}>{deck.title}</strong>
    <span>{copy[deck.language].draft} · {copy[deck.language].slides(lessonSize(deck))}</span>
  </div>;
  return <SlideCanvas deck={deck} slide={thumbnail?{...slide,richText:undefined,bodyRuns:undefined}:slide} revealAnswer={false}/>;
}

function TemplateIllustration({kind}:{kind:Template}) {
  return <svg viewBox="0 0 104 78" className="library-template-art" focusable="false" aria-hidden="true">
    {kind==='measurement'&&<>
      <path className="art-fill" d="M33 34h31v23a8 8 0 0 1-8 8H41a8 8 0 0 1-8-8z"/>
      <g className="art-line"><path d="M28 18h40l-4 5v34a8 8 0 0 1-8 8H41a8 8 0 0 1-8-8V25zM34 35c8-6 16 4 29-1M56 25h7M59 42h4M56 50h7M59 57h4"/><path d="m73 12 2 5m5 2 5 1"/></g>
      <circle className="art-point" cx="44" cy="49" r="3"/><circle className="art-point" cx="50" cy="57" r="2"/>
    </>}
    {kind==='explain'&&<>
      <path className="art-line" d="M28 25h23m6 0h17v26M34 50l17-20"/>
      <circle className="art-paper" cx="24" cy="25" r="9"/>
      <rect className="art-fill art-shape" x="47" y="15" width="19" height="19" rx="4" transform="rotate(-9 56 24)"/>
      <path className="art-paper" d="m71 43 10 17H61z"/>
      <circle className="art-point" cx="32" cy="53" r="5"/>
    </>}
    {kind==='revise'&&<>
      <g transform="rotate(-11 49 40)">
        <rect className="art-fill art-shape" x="27" y="19" width="46" height="36" rx="4"/>
        <rect className="art-paper" x="22" y="25" width="46" height="36" rx="4"/>
        <path className="art-line" d="m29 38 3 3 6-7m5 5h16m-30 9 3 3 6-7m5 5h12"/>
      </g>
      <path className="art-line" d="m75 18 4-4m-2 11h6"/>
    </>}
  </svg>;
}

function CollectionSkeleton({view}:{view:'list'|'grid'}) {
  return <div className={view==='list'?'library-loading-list':'dashboard-grid library-loading-grid'} aria-hidden="true">
    {[0,1,2].map(index=><div className="library-loading-lesson" key={index}>
      <Skeleton className="library-loading-cover"/>
      <div className="library-loading-text"><Skeleton/><Skeleton/></div>
    </div>)}
  </div>;
}

function PreviewSkeleton() {
  return <Card className="library-preview-card library-preview-loading" size="sm" aria-hidden="true">
    <CardHeader><div className="library-loading-text"><Skeleton/><Skeleton/></div></CardHeader>
    <CardContent className="library-preview-content"><Skeleton className="library-preview-art"/><Skeleton className="library-loading-meta"/></CardContent>
    <CardFooter className="library-preview-actions"><Skeleton className="library-loading-action"/><Skeleton className="library-loading-action"/></CardFooter>
  </Card>;
}

function FilterSelect({id,label,value,options,onChange}:{
  id:string;label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void;
}) {
  return <Field orientation="horizontal" className="library-filter-field">
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={options} value={value} onValueChange={next=>{if(next!==null)onChange(next);}}>
      <SelectTrigger id={id} size="default">{id==='library-language' && value in languages && <LanguageFlag locale={value as Locale}/>}<SelectValue/></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>{options.map(option=><SelectItem key={option.value} value={option.value}>{id==='library-language' && option.value in languages ? <span className="library-language"><LanguageFlag locale={option.value as Locale}/>{option.label}</span> : option.label}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  </Field>;
}

function LessonPreview({deck,locale,status,recency,onNavigate}:{
  deck:Deck;locale:Locale;status:string;recency?:'opened'|'latest';onNavigate?:()=>void;
}) {
  const t=words[locale];
  const c=copy[locale];
  const [page,setPage]=useState<string>();
  const available=deck.slides.filter(slide=>slide.status==='ready');
  const remembered=sessionStorage.getItem('sabaq:slide:'+deck.id) ?? localStorage.getItem('sabaq:slide:'+deck.id);
  const index=Math.max(0,available.findIndex(slide=>slide.id===(page??remembered)));
  const slide=available[index];
  const updated=formatStudioDate(deck.updatedAt,locale);
  const openAction=deck.phase==='outline'?t.reviewOutline:recency==='opened'?t.resume:t.openLesson;
  const firstThumbnail = Math.min(Math.max(index-1, 0), Math.max(0, available.length-4));
  const thumbnails = available.slice(firstThumbnail, firstThumbnail+4);
  return <Card className="library-preview-card library-recent" size="sm">
    <div className="library-preview-heading"><EyeIcon aria-hidden="true"/>{c.slidePreview}</div>
    <CardHeader>
      <CardTitle><h2 lang={deck.language}>{deck.title}</h2></CardTitle>
      <CardDescription className="library-preview-meta">
        <span className="library-language" lang={deck.language}><LanguageFlag locale={deck.language}/>{languages[deck.language]}</span><span>{c.slides(lessonSize(deck))}</span>
        <Badge variant="outline">{status}</Badge>
      </CardDescription>
    </CardHeader>
    <CardContent className="library-preview-content">
      <div className="library-preview-art" role="img" aria-label={slide?.title || (deck.outline.length ? deck.title : c.empty)}>
        <div className="library-preview-frame" key={slide?.id??'empty'} data-motion="preview-change">
          {slide?<div inert aria-hidden="true"><LessonImage deck={deck} slide={slide}/></div>:deck.outline.length ? <div className="library-outline-cover">
            <StackIcon aria-hidden="true"/><strong lang={deck.language}>{deck.title}</strong><span>{t.outline} · {c.slides(deck.outline.length)}</span>
          </div>:<span>{c.empty}</span>}
        </div>
      </div>
      {thumbnails.length>1 && <div className="library-filmstrip" role="group" aria-label={c.slidePreview}>
        {thumbnails.map((item, offset)=><div className="library-film-frame" key={item.id}>
          <div inert aria-hidden="true"><LessonImage deck={deck} slide={item} thumbnail/></div>
          <button type="button" aria-label={`${c.slidePreview} ${deck.slides.indexOf(item)+1} · ${item.title}`}
            title={item.title} aria-pressed={firstThumbnail+offset===index} onClick={()=>setPage(item.id)}/>
        </div>)}
      </div>}
      <div className="library-preview-caption">
        <div className="library-preview-recency">
          {recency&&<Badge variant="secondary">{recency==='opened'?c.recent:c.latest}</Badge>}
          <time dateTime={deck.updatedAt}>{t.generatedAt} {updated}</time>
        </div>
        {slide&&<div className="library-slide-controls">
          <Button size="icon-sm" variant="ghost" aria-label={reviewText(locale,'prev')} disabled={index===0} onClick={()=>setPage(available[index-1].id)}><CaretLeftIcon/></Button>
          <span aria-live="polite">{deck.slides.indexOf(slide)+1} / {deck.slides.length}</span>
          <Button size="icon-sm" variant="ghost" aria-label={reviewText(locale,'next')} disabled={index>=available.length-1} onClick={()=>setPage(available[index+1].id)}><CaretRightIcon/></Button>
        </div>}
      </div>
    </CardContent>
    <CardFooter className="library-preview-actions">
      <a data-slot="button" className={buttonVariants({variant:'default',size:'lg'})} href={href(deck)} onClick={onNavigate}>
        {openAction}<ArrowRightIcon data-icon="inline-end" data-motion-arrow/>
      </a>
      {ready(deck)&&<a data-slot="button" className={buttonVariants({variant:'ghost',size:'lg'})} href={href(deck,'present')} onClick={onNavigate}>
        <PresentationChartIcon data-icon="inline-start"/>{t.present}
      </a>}
      {deck.phase!=='outline'&&<a data-slot="button" className={buttonVariants({variant:'ghost',size:'icon-lg'})}
        aria-label={c.overview} title={c.overview} href={href(deck,'grid')} onClick={onNavigate}>
        <SquaresFourIcon/>
      </a>}
    </CardFooter>
  </Card>;
}

export function Library({decks,locale,loading,error,onRetry,onNew,onTemplate}: {
  decks:Deck[];locale:Locale;loading:boolean;error:boolean;onRetry:()=>void;onNew:()=>void;onTemplate:(template:Template)=>void;
}) {
  const t=words[locale];
  const c=copy[locale];
  const [query,setQuery]=useState('');
  const [language,setLanguage]=useState('all');
  const [status,setStatus]=useState('all');
  const [sort,setSort]=useState('updated');
  const [page,setPage]=useState<number>();
  const [view,setView]=useState<'grid'|'list'>(()=>localStorage.getItem('sabaq:library-view')==='list'?'list':'grid');
  const [selectedId,setSelectedId]=useState<string>();
  const [previewOpen,setPreviewOpen]=useState(false);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const previewTrigger=useRef<HTMLButtonElement|null>(null);
  const compact=useMediaQuery('(max-width: 760px)');
  const wide=useMediaQuery('(min-width: 1180px)');
  const showPanel=wide && (view==='list' || Boolean(selectedId));
  const number=new Intl.NumberFormat(locale);
  const lastOpened=localStorage.getItem('sabaq:last-opened-lesson');
  const latest=decks.reduce<Deck|undefined>((last,deck)=>!last||last.updatedAt<deck.updatedAt?deck:last,undefined);
  const normalizedQuery=query.trim().toLocaleLowerCase(locale);
  const visible=decks.filter(deck=>
    (language==='all'||deck.language===language) &&
    (status==='all'||(status==='ready'?ready(deck):!ready(deck))) &&
    [deck.title,deck.topic].some(value=>value.toLocaleLowerCase(locale).includes(normalizedQuery)),
  ).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,locale):b.updatedAt.localeCompare(a.updatedAt));
  const pages=Math.max(1,Math.ceil(visible.length/pageSize));
  const lastOpenedPage=Math.floor(Math.max(0,visible.findIndex(deck=>deck.id===lastOpened))/pageSize);
  const current=Math.min(page??lastOpenedPage,pages-1);
  const rows=visible.slice(current*pageSize,current*pageSize+pageSize);
  const selected=rows.find(deck=>deck.id===selectedId)
    ?? rows.find(deck=>deck.id===lastOpened)
    ?? rows.find(deck=>deck.id===latest?.id)
    ?? rows[0];
  const recency=selected?.id===lastOpened?'opened':selected?.id===latest?.id?'latest':undefined;
  const filtered=Boolean(normalizedQuery||language!=='all'||status!=='all');
  const filterCount=Number(status!=='all')+Number(language!=='all')+Number(sort!=='updated');
  const statusLabel=(deck:Deck)=>ready(deck)?t.ready:deck.slides.some(slide=>slide.status==='generating'||slide.status==='pending')?t.inProgress:c.draft;
  const changeQuery=(value:string)=>{setQuery(value);setPage(0);};
  const changeStatus=(value:string)=>{setStatus(value);setPage(0);};
  const clearFilters=()=>{changeStatus('all');setLanguage('all');setSort('updated');};

  const statusOptions=[{value:'all',label:t.allLessons},{value:'ready',label:t.ready},{value:'draft',label:c.draft}];
  const filtersFields=<FieldGroup className="library-filter-fields">
    {compact&&<FilterSelect id="library-status" label={c.status} value={status} options={statusOptions} onChange={changeStatus}/>}
    <FilterSelect id="library-language" label={t.lessonLanguage} value={language} options={[{value:'all',label:t.allLanguages},...languageOptions]} onChange={value=>{setLanguage(value);setPage(0);}}/>
    <FilterSelect id="library-sort" label={t.sortLessons} value={sort} options={[{value:'updated',label:t.newest},{value:'title',label:t.alphabetical}]} onChange={value=>{setSort(value);setPage(0);}}/>
  </FieldGroup>;
  const filterButton=<Button variant="outline" size="lg" className="library-filter-trigger"/>;
  const filterLabel=<><SlidersHorizontalIcon data-icon="inline-start"/>{c.filters}{filterCount>0&&<Badge variant="secondary">{filterCount}</Badge>}</>;
  const preview=selected&&<LessonPreview key={selected.id} deck={selected} locale={locale} recency={recency} status={statusLabel(selected)} onNavigate={()=>setPreviewOpen(false)}/>;
  const previewControl=(deck:Deck)=><Button size="icon-lg" variant="ghost" className="library-preview-trigger"
    aria-label={`${c.preview} · ${deck.title}`} title={c.preview} aria-pressed={showPanel?selected?.id===deck.id:undefined}
    onClick={event=>{
      previewTrigger.current=event.currentTarget;
      setSelectedId(deck.id);
      if(!showPanel)setPreviewOpen(true);
    }}>
    <EyeIcon/>
  </Button>;

  return <div className="library-dashboard">
    <header className="library-masthead">
      <div>
        <h1>{t.library}</h1>
        <p>{t.libraryIntro}</p>
      </div>
      <div className="library-primary-actions">
        <Button size="lg" onClick={onNew}><PlusIcon data-icon="inline-start"/>{t.newLesson}</Button>
      </div>
    </header>
    <div className="library-workspace" data-has-preview={showPanel&&(Boolean(selected)||loading)&&!error}>
      <section className="dashboard-library" aria-label={c.lessons} aria-busy={loading}>
        <div className="library-collection-heading">
          <h2>{c.lessons}</h2>
          {!loading&&!error&&<span aria-label={c.rows(visible.length)}>{number.format(visible.length)}</span>}
        </div>
        <div className="library-toolbar" role="search">
          <InputGroup className="search-field">
            <InputGroupInput type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={event=>changeQuery(event.target.value)}/>
            <InputGroupAddon><MagnifyingGlassIcon aria-hidden/></InputGroupAddon>
            {query&&<InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={c.searchClear} onClick={()=>changeQuery('')}><XIcon/></InputGroupButton></InputGroupAddon>}
          </InputGroup>
          {compact?<Sheet>
            <SheetTrigger render={filterButton}>{filterLabel}</SheetTrigger>
            <SheetContent side="bottom" className="library-filter-sheet" showCloseButton={false}>
              <SheetHeader><SheetTitle>{c.filters}</SheetTitle></SheetHeader>
              <div className="library-sheet-body">{filtersFields}</div>
              <SheetFooter>
                <Button variant="ghost" disabled={!filterCount} onClick={clearFilters}>{t.clearFilters}</Button>
                <SheetClose render={<Button/>}>{c.done}</SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>:<Popover>
            <PopoverTrigger render={filterButton}>{filterLabel}</PopoverTrigger>
            <PopoverContent align="end" className="library-filter-popover">
              <PopoverHeader><PopoverTitle>{c.filters}</PopoverTitle></PopoverHeader>
              {filtersFields}
              <Button variant="ghost" size="sm" disabled={!filterCount} onClick={clearFilters}>{t.clearFilters}</Button>
            </PopoverContent>
          </Popover>}
        </div>
        <div className="library-collection-control">
          {compact?(filtered&&<p className="library-result-count" role="status">{c.rows(visible.length)}</p>):
            <ToggleGroup aria-label={c.status} spacing={1} size="sm" value={[status]} onValueChange={values=>{if(values[0])changeStatus(values[0]);}}>
              {statusOptions.map(option=><ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
            </ToggleGroup>}
          <ToggleGroup aria-label={c.display} spacing={0} size="default" variant="outline" value={[view]} onValueChange={values=>{
            const option=values[0];
            if(option==='list'||option==='grid'){localStorage.setItem('sabaq:library-view',option);setView(option);}
          }}>
            <ToggleGroupItem value="list" aria-label={t.listView} title={t.listView}><ListBulletsIcon/></ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label={t.gridView} title={t.gridView}><SquaresFourIcon/></ToggleGroupItem>
          </ToggleGroup>
        </div>
        {loading?<CollectionSkeleton view={view}/>:
          error?<Empty role="alert"><EmptyHeader><EmptyMedia variant="icon"><WarningCircleIcon/></EmptyMedia><EmptyDescription>{t.unavailable}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={onRetry}>{t.retry}</Button></EmptyContent></Empty>:
          rows.length===0?<Empty><EmptyHeader><EmptyMedia variant="icon"><BooksIcon/></EmptyMedia><EmptyTitle>{filtered?t.emptyLibrary:t.noLessons}</EmptyTitle></EmptyHeader><EmptyContent>
            <Button variant="outline" onClick={filtered?()=>{changeQuery('');clearFilters();}:onNew}>{filtered?t.clearFilters:t.newLesson}</Button>
          </EmptyContent></Empty>:view==='list'?
          <ItemGroup role="list" aria-label={c.lessons} className="lesson-list">
            {rows.map(deck=><Item role="listitem" key={deck.id} className="library-list-item" data-preview-selected={showPanel&&selected?.id===deck.id}>
              <a className="library-row-link" href={href(deck)} data-motion="preview">
                <ItemMedia className="library-row-cover" inert aria-hidden="true" data-motion-media><LessonImage deck={deck} slide={deck.slides.find(slide=>slide.status==='ready')} thumbnail/></ItemMedia>
                <ItemContent>
                  <ItemTitle lang={deck.language}>{deck.title}</ItemTitle>
                  <ItemDescription><span className="library-language" lang={deck.language}><LanguageFlag locale={deck.language}/>{languages[deck.language]}</span><span>{c.slides(lessonSize(deck))}</span><span className="library-row-status" data-ready={ready(deck)}>{statusLabel(deck)}</span></ItemDescription>
                </ItemContent>
              </a>
              <ItemActions>{previewControl(deck)}</ItemActions>
            </Item>)}
          </ItemGroup>:<ul className="dashboard-grid">
            {rows.map(deck=><li key={deck.id} className="library-grid-item" data-preview-selected={showPanel&&selected?.id===deck.id}>
              <a className="lesson-card library-grid-link" href={href(deck)} data-motion="preview">
                <div className="library-grid-cover" inert aria-hidden="true" data-motion-media><LessonImage deck={deck} slide={deck.slides.find(slide=>slide.status==='ready')} thumbnail/></div>
                <div className="library-grid-caption">
                  <h3 lang={deck.language} title={deck.title}>{deck.title}</h3>
                  <p><span className="library-language" lang={deck.language}><LanguageFlag locale={deck.language}/>{languages[deck.language]}</span><span>{c.slides(lessonSize(deck))}</span><span className="library-row-status" data-ready={ready(deck)}>{statusLabel(deck)}</span></p>
                </div>
              </a>
              {previewControl(deck)}
            </li>)}
          </ul>}
        {!loading&&!error&&rows.length>0&&(filtered||pages>1)&&<div className="dashboard-pagination">
          {!compact&&<p role="status">{c.rows(visible.length)}</p>}
          {pages>1&&<div>
            <span>{current+1} / {pages}</span>
            <Button size="icon-sm" variant="outline" aria-label={c.previous} disabled={current===0} onClick={()=>setPage(current-1)}><CaretLeftIcon/></Button>
            <Button size="icon-sm" variant="outline" aria-label={c.next} disabled={current===pages-1} onClick={()=>setPage(current+1)}><CaretRightIcon/></Button>
          </div>}
        </div>}
      </section>
      {showPanel&&(preview||loading)&&!error&&<aside className="library-preview-panel" aria-label={c.slidePreview}>{loading?<PreviewSkeleton/>:preview}</aside>}
    </div>
    <Collapsible open={!compact||templatesOpen} onOpenChange={setTemplatesOpen}>
      <section className="library-template-start" aria-labelledby="library-template-heading">
        <h2 id="library-template-heading">{compact?<CollapsibleTrigger render={<Button variant="ghost"/>}>{c.template}<CaretDownIcon data-icon="inline-end"/></CollapsibleTrigger>:c.template}</h2>
        <CollapsibleContent className="library-template-actions">
          {quickTemplates.map(({id,description})=><Button key={id} variant="outline" className="library-template-choice" data-template={id} onClick={()=>onTemplate(id)}>
            <span className="library-template-figure"><TemplateIllustration kind={id}/></span>
            <span className="library-template-copy"><strong>{lessonTemplates[id].name[locale]}</strong><span>{t[description]}</span></span>
            <ArrowRightIcon data-motion-arrow aria-hidden/>
          </Button>)}
        </CollapsibleContent>
      </section>
    </Collapsible>
    {loading&&<span className="sr-only" role="status">{t.initial}</span>}
    {!showPanel&&<Sheet open={previewOpen&&Boolean(preview)} onOpenChange={setPreviewOpen}>
      <SheetContent side="bottom" showCloseButton={false} className="library-preview-sheet" finalFocus={()=>previewTrigger.current}>
        <SheetHeader className="sr-only"><SheetTitle>{c.preview}</SheetTitle></SheetHeader>
        {preview}
        <SheetFooter><SheetClose render={<Button variant="outline"/>}>{t.close}</SheetClose></SheetFooter>
      </SheetContent>
    </Sheet>}
  </div>;
}
