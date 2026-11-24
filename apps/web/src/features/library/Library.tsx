import { useRef, useState } from 'react';
import { ArrowRightIcon, ArrowsDownUpIcon, BooksIcon, CaretLeftIcon, CaretRightIcon, EyeIcon, ListBulletsIcon, MagnifyingGlassIcon, PlusIcon, PresentationChartIcon, SlidersHorizontalIcon, SquaresFourIcon, StackIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { effectiveFreeLayout } from '@sabaq/lesson/free-layout';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { languages, words } from '@/copy';
import { formatStudioDate } from '@/lib/date';
import { LanguageFlag } from '@/components/LanguageFlag';
import { Badge } from '@/components/shadcn/badge';
import { Button, buttonVariants } from '@/components/shadcn/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/shadcn/card';
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
import './library.css';

const pageSize = 12;
const languageOptions = Object.entries(languages).map(([value,label]) => ({value,label}));
const copy = {
  en:{recent:'Continue working',latest:'Latest lesson',lessons:'Lessons',status:'Status',draft:'Draft',overview:'Slide overview',preview:'Preview lesson',slidePreview:'Slide preview',empty:'No slides ready',filters:'Filters',display:'View',done:'Done',searchClear:'Clear search',matches:'Search results',previous:'Previous',next:'Next',slides:(n:number)=>`${n} ${n===1?'slide':'slides'}`,rows:(n:number)=>`${n} ${n===1?'lesson':'lessons'}`},
  ru:{recent:'Продолжить работу',latest:'Последний урок',lessons:'Уроки',status:'Статус',draft:'Черновик',overview:'Обзор слайдов',preview:'Просмотр урока',slidePreview:'Просмотр слайда',empty:'Готовых слайдов пока нет',filters:'Фильтры',display:'Вид',done:'Готово',searchClear:'Очистить поиск',matches:'Результаты поиска',previous:'Назад',next:'Далее',slides:(n:number)=>`${n} ${n%10===1&&n%100!==11?'слайд':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'слайда':'слайдов'}`,rows:(n:number)=>`Уроков: ${n}`},
  kk:{recent:'Жұмысты жалғастыру',latest:'Соңғы сабақ',lessons:'Сабақтар',status:'Күйі',draft:'Нобай',overview:'Слайдтар шолуы',preview:'Сабақты алдын ала көру',slidePreview:'Слайдты алдын ала көру',empty:'Дайын слайдтар жоқ',filters:'Сүзгілер',display:'Көрініс',done:'Дайын',searchClear:'Іздеуді тазарту',matches:'Іздеу нәтижелері',previous:'Алдыңғы',next:'Келесі',slides:(n:number)=>`${n} слайд`,rows:(n:number)=>`${n} сабақ`},
};

const stateCopy = {
  en: { unfinished: 'Unfinished', outline: 'Outline', interrupted: 'Needs attention' },
  ru: { unfinished: 'Не завершены', outline: 'План', interrupted: 'Не завершено' },
  kk: { unfinished: 'Аяқталмағандар', outline: 'Жоспар', interrupted: 'Аяқталмаған' },
};

const resultRange = {
  en: (first: number, last: number, total: number) => `${first}–${last} of ${total}`,
  ru: (first: number, last: number, total: number) => `${first}–${last} из ${total}`,
  kk: (first: number, last: number, total: number) => `${total} сабақтың ${first}–${last}-і`,
};

function ready(deck:Deck) {
  return deck.phase==='editing' && deck.slides.length>0 && deck.slides.every(slide=>slide.status==='ready');
}

function lessonState(deck:Deck) {
  if (ready(deck)) return 'ready';
  if (deck.outlineStatus === 'generating' || deck.phase === 'generating') return 'running';
  if (deck.outlineStatus === 'failed' || deck.slides.some(slide=>slide.status === 'failed' || slide.status === 'cancelled')) return 'interrupted';
  if (deck.phase === 'outline' && deck.outline.length > 0) return 'outline';
  return 'draft';
}

function lessonSize(deck:Deck) {
  return deck.slides.length || deck.outline.length;
}

function href(deck:Deck, view?:'grid'|'present') {
  return `#/deck/${encodeURIComponent(deck.id)}${view?'/'+view:''}`;
}

function thumbnailSlide(slide: Slide) {
  if (!slide.freeLayout || !slide.body || slide.importedPage) return slide;
  const { items } = effectiveFreeLayout(slide);
  const title = items.find(item => item.id === 'title');
  const body = items.find(item => item.id === 'body');
  if (!title || !body || title.rotation || body.rotation) return slide;

  // Compare the opening text bands. The full frames can overlap when their text does not.
  const width = Math.min(title.x + title.w, body.x + body.w) - Math.max(title.x, body.x);
  const height = Math.min(title.y + Math.min(title.h, 13), body.y + Math.min(body.h, 6)) - Math.max(title.y, body.y);
  return width > Math.min(title.w, body.w) * .2 && height > 1 ? { ...slide, freeLayout: null } : slide;
}

function LessonImage({deck,slide,thumbnail=false}:{deck:Deck;slide?:Slide;thumbnail?:boolean}) {
  if (!slide) return <div className="library-outline-cover" data-state={lessonState(deck)} aria-hidden="true">
    <span><PresentationChartIcon weight="duotone"/></span>
  </div>;
  return <SlideCanvas deck={deck} slide={thumbnail ? thumbnailSlide(slide) : slide} revealAnswer={false} thumbnail={thumbnail}/>;
}

function LessonMetadata({deck,locale,status}:{deck:Deck;locale:Locale;status:string}) {
  const size=lessonSize(deck);
  return <>
    <span className="library-meta-facts">
      <span className="library-language" lang={deck.language}><LanguageFlag locale={deck.language}/><span>{languages[deck.language]}</span></span>
      {size>0&&<span>{copy[locale].slides(size)}</span>}
      <time dateTime={deck.updatedAt}>{formatStudioDate(deck.updatedAt, locale)}</time>
    </span>
    <span className="library-row-status" data-state={lessonState(deck)} title={status}><span>{status}</span></span>
  </>;
}

function CollectionSkeleton({view}:{view:'list'|'grid'}) {
  return <div className={view==='list'?'library-loading-list':'dashboard-grid library-loading-grid'} aria-hidden="true">
    {[0,1,2,3].map(index=><div className="library-loading-lesson" key={index}>
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
    <CardHeader>
      <CardTitle><h2 lang={deck.language}>{deck.title}</h2></CardTitle>
      <CardDescription className="library-preview-meta">
        <span className="library-language" lang={deck.language}><LanguageFlag locale={deck.language}/>{languages[deck.language]}</span><span>{c.slides(lessonSize(deck))}</span>
        <Badge variant="outline">{status}</Badge>
      </CardDescription>
    </CardHeader>
    <CardContent className="library-preview-content">
      <div className="library-preview-art" role="img" aria-label={slide?.title || (deck.outline.length ? deck.title : c.empty)}>
        <div className="library-preview-frame">
          {slide?<div inert aria-hidden="true"><LessonImage deck={deck} slide={slide}/></div>:<span className="library-preview-no-slide">
            <StackIcon weight="light" aria-hidden="true"/>{deck.outline.length?t.outline:c.empty}
          </span>}
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
        {openAction}<ArrowRightIcon data-icon="inline-end"/>
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

export function Library({decks,locale,loading,error,onRetry,onNew}: {
  decks:Deck[];locale:Locale;loading:boolean;error:boolean;onRetry:()=>void;onNew:()=>void;
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
  const previewTrigger=useRef<HTMLButtonElement|null>(null);
  const compact=useMediaQuery('(max-width: 760px)');
  const wide=useMediaQuery('(min-width: 1180px)');
  const showPanel=wide && view==='list';
  const pending=loading && decks.length===0;
  const unavailable=error && decks.length===0;
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
  const filterCount=Number(language!=='all')+(compact?Number(status!=='all')+Number(sort!=='updated'):0);
  const statusLabel=(deck:Deck)=>{
    const state=lessonState(deck);
    if(state==='ready')return t.ready;
    if(state==='running')return t.inProgress;
    if(state==='outline'||state==='interrupted')return stateCopy[locale][state];
    return c.draft;
  };
  const changeQuery=(value:string)=>{setQuery(value);setPage(0);};
  const changeStatus=(value:string)=>{setStatus(value);setPage(0);};
  const changeLanguage=(value:string)=>{setLanguage(value);setPage(0);};
  const changeSort=(value:string)=>{setSort(value);setPage(0);};
  const clearFilters=()=>{changeStatus('all');setLanguage('all');setSort('updated');};

  const statusOptions=[{value:'all',label:t.allLessons},{value:'ready',label:t.ready},{value:'unfinished',label:stateCopy[locale].unfinished}];
  const sortOptions=[{value:'updated',label:t.newest},{value:'title',label:t.alphabetical}];
  const filtersFields=<FieldGroup className="library-filter-fields">
    {compact&&<FilterSelect id="library-status" label={c.status} value={status} options={statusOptions} onChange={changeStatus}/>}
    <FilterSelect id="library-language" label={t.lessonLanguage} value={language} options={[{value:'all',label:t.allLanguages},...languageOptions]} onChange={changeLanguage}/>
    {compact&&<FilterSelect id="library-sort" label={t.sortLessons} value={sort} options={sortOptions} onChange={changeSort}/>}
  </FieldGroup>;
  const filterButton=<Button variant="outline" className="library-filter-trigger" aria-label={c.filters} title={c.filters}/>;
  const filterLabel=<><SlidersHorizontalIcon data-icon="inline-start"/><span>{c.filters}</span>{filterCount>0&&<Badge variant="secondary">{filterCount}</Badge>}</>;
  const preview=selected&&<LessonPreview key={selected.id} deck={selected} locale={locale} recency={recency} status={statusLabel(selected)} onNavigate={()=>setPreviewOpen(false)}/>;
  const previewControl=(deck:Deck)=><Button size="icon-sm" variant="ghost" className="library-preview-trigger"
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
      <h1>{t.library}</h1>
      <div className="library-primary-actions">
        <Button size="lg" onClick={onNew}><PlusIcon data-icon="inline-start"/>{t.newLesson}</Button>
      </div>
    </header>
    <div className="library-workspace" data-has-preview={showPanel&&(Boolean(selected)||pending)&&!unavailable}>
      <section className="dashboard-library" aria-label={c.lessons} aria-busy={pending}>
        <div className="library-tools">
          {!compact&&
            <ToggleGroup className="library-status-control" aria-label={c.status} spacing={1} size="sm" value={[status]} onValueChange={values=>{if(values[0])changeStatus(values[0]);}}>
              {statusOptions.map(option=><ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
            </ToggleGroup>}
          <div className="library-toolbar">
            <div className="library-search-tools" role="search">
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
                  <Button variant="ghost" size="sm" disabled={!filterCount} onClick={()=>changeLanguage('all')}>{t.clearFilters}</Button>
                </PopoverContent>
              </Popover>}
            </div>
            {!compact&&<Select items={sortOptions} value={sort} onValueChange={value=>{if(value!==null)changeSort(value);}}>
              <SelectTrigger className="library-sort-trigger" aria-label={t.sortLessons} title={`${t.sortLessons} · ${sort==='title'?t.alphabetical:t.newest}`}>
                <ArrowsDownUpIcon aria-hidden="true"/><SelectValue/>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {sortOptions.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>}
            <ToggleGroup className="library-view-control" aria-label={c.display} spacing={0} size="default" variant="outline" value={[view]} onValueChange={values=>{
              const option=values[0];
              if(option==='list'||option==='grid'){localStorage.setItem('sabaq:library-view',option);setView(option);}
            }}>
              <ToggleGroupItem value="list" aria-label={t.listView} title={t.listView}><ListBulletsIcon/></ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label={t.gridView} title={t.gridView}><SquaresFourIcon/></ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {pending?<CollectionSkeleton view={view}/>:
          unavailable?<Empty role="alert"><EmptyHeader><EmptyMedia variant="icon"><WarningCircleIcon/></EmptyMedia><EmptyDescription>{t.unavailable}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={onRetry}>{t.retry}</Button></EmptyContent></Empty>:
          rows.length===0?<Empty><EmptyHeader><EmptyMedia variant="icon"><BooksIcon/></EmptyMedia><EmptyTitle>{filtered?t.emptyLibrary:t.noLessons}</EmptyTitle></EmptyHeader><EmptyContent>
            <Button variant="outline" onClick={filtered?()=>{changeQuery('');clearFilters();}:onNew}>{filtered?t.clearFilters:t.newLesson}</Button>
          </EmptyContent></Empty>:view==='list'?
          <ItemGroup role="list" aria-label={c.lessons} className="lesson-list">
            {rows.map(deck=><Item role="listitem" key={deck.id} className="library-list-item" data-preview-selected={showPanel&&selected?.id===deck.id}>
              <a className="library-row-link" href={href(deck)}>
                <ItemMedia className="library-row-cover" inert aria-hidden="true"><LessonImage deck={deck} slide={deck.slides.find(slide=>slide.status==='ready')} thumbnail/></ItemMedia>
                <ItemContent>
                  <ItemTitle lang={deck.language}>{deck.title}</ItemTitle>
                  <ItemDescription><LessonMetadata deck={deck} locale={locale} status={statusLabel(deck)}/></ItemDescription>
                </ItemContent>
              </a>
              <ItemActions>{previewControl(deck)}</ItemActions>
            </Item>)}
          </ItemGroup>:<ul className="dashboard-grid">
            {rows.map(deck=><li key={deck.id} className="library-grid-item">
              <a className="lesson-card library-grid-link" href={href(deck)}>
                <div className="library-grid-cover" inert aria-hidden="true"><LessonImage deck={deck} slide={deck.slides.find(slide=>slide.status==='ready')} thumbnail/></div>
                <div className="library-grid-caption">
                  <h3 lang={deck.language} title={deck.title}>{deck.title}</h3>
                  <p><LessonMetadata deck={deck} locale={locale} status={statusLabel(deck)}/></p>
                </div>
              </a>
              {previewControl(deck)}
            </li>)}
          </ul>}
        {!pending&&!unavailable&&rows.length>0&&<div className="dashboard-pagination">
          <p role="status">{pages>1?resultRange[locale](current*pageSize+1,current*pageSize+rows.length,visible.length):c.rows(visible.length)}</p>
          {pages>1&&<div>
            <span>{current+1} / {pages}</span>
            <Button size="icon-sm" variant="outline" aria-label={c.previous} disabled={current===0} onClick={()=>setPage(current-1)}><CaretLeftIcon/></Button>
            <Button size="icon-sm" variant="outline" aria-label={c.next} disabled={current===pages-1} onClick={()=>setPage(current+1)}><CaretRightIcon/></Button>
          </div>}
        </div>}
      </section>
      {showPanel&&(preview||pending)&&!unavailable&&<aside className="library-preview-panel" aria-label={c.slidePreview}>{pending?<PreviewSkeleton/>:preview}</aside>}
    </div>
    {pending&&<span className="sr-only" role="status">{t.initial}</span>}
    {!showPanel&&<Sheet open={previewOpen&&Boolean(preview)} onOpenChange={setPreviewOpen}>
      <SheetContent side="bottom" showCloseButton={false} className="library-preview-sheet" finalFocus={()=>previewTrigger.current}>
        <SheetHeader className="sr-only"><SheetTitle>{c.preview}</SheetTitle></SheetHeader>
        {preview}
        <SheetClose render={<Button variant="ghost" size="icon-sm" className="library-preview-close" aria-label={t.close}/>}><XIcon/></SheetClose>
      </SheetContent>
    </Sheet>}
  </div>;
}
