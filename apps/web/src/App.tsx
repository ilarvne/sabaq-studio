import { coeditLabels } from '@sabaq/lesson/coedit';
import { Outline, Generation, useAuthoringProgress } from '@/features/authoring/DeckWorkbench';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TranslateIcon, WarningCircleIcon, DownloadSimpleIcon, ClockCounterClockwiseIcon, SquaresFourIcon, PlayIcon, MagnifyingGlassIcon, VideoCameraIcon, XIcon, DotsThreeIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { CreateInput, Deck, Locale } from '@sabaq/lesson/types';
import { languages, searchCopy, words } from './copy';
import { ApiError, request, runLimitMessage } from '@/lib/api';
import { useDeck } from '@/features/editor/useDeck';
import { EditConflictDetails } from '@/features/editor/EditConflictDetails';
import type { StartMode, Template } from '@/features/authoring/Start';
import { Home } from '@/features/home/Home';
import { homeCopy } from '@/features/home/home-copy';
import type { ReviewMode } from '@/features/presentation/Review';
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuTrigger } from './components/coss/menu';
import { Button } from './components/coss/button';
import { TooltipProvider } from './components/coss/tooltip';
import { StudioNavigation, StudioLanguagePicker } from './StudioNavigation';
import { Button as StudioButton } from './components/shadcn/button';
import { Skeleton } from './components/shadcn/skeleton';
import { LessonAccess, ReadOnlyLesson } from '@/features/collaboration/LessonAccess';
import { Library } from '@/features/library/Library';
import { LanguageVersions, versionLabels } from '@/features/collaboration/LanguageVersions';
import { OrganizationMember, OrganizationPublisher, organizationWords } from '@/features/organization/Organization';
import './workspace-loading.css';
import { DeckNavigation, DeckSidebar } from '@/components/DeckNavigation';
import './deck-chrome.css';
import { setStudioAppearance } from './appearance';

type Route = { page:'home'|'library'|'files'|'templates' } | {page:'start'; mode?:StartMode} | { page:'deck'; id:string; view?:'grid'|'present'|'coedit' };
function readRoute(): Route {
  const [page,id,view] = location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'deck' && id) return {page,id:decodeURIComponent(id),view:view==='grid'||view==='present'||view==='coedit'?view:undefined};
  if (page === 'start') return {page, mode:id === 'file' || id === 'source' || id === 'pptx' || id === 'topic' ? id : undefined};
  return {page:page === 'templates' || page === 'library' || page === 'files' ? page : 'home'};
}
function route(path: string) { location.hash = '/' + path; }
const deckPath = (id:string) => '/decks/' + encodeURIComponent(id);
const locales = Object.keys(languages) as Locale[];
const Coedit=lazy(()=>import('@/features/collaboration/Coedit'));
const Editor = lazy(() => import('@/features/editor/Editor'));
const Start = lazy(() => import('@/features/authoring/Start').then(module => ({default:module.Start})));
const Templates = lazy(() => import('@/features/authoring/Start').then(module => ({default:module.Templates})));
const Review = lazy(() => import('@/features/presentation/Review').then(module => ({default: module.Review})));
const UsageReport = lazy(()=>import('@/features/admin/UsageReport'));
const SourceLibrary = lazy(()=>import('@/features/sources/SourceLibrary'));
const WorkspaceSearch = lazy(() => import('@/features/library/WorkspaceSearch').then(module => ({default: module.WorkspaceSearch})));

function SlidePlaceholder() {
  return <div className="workspace-loading-slide" aria-hidden="true">
    <Skeleton/><Skeleton/><Skeleton/>
  </div>;
}

function EditorPlaceholder({label,overview=false}:{label:string;overview?:boolean}) {
  return <div className="workspace-loading-editor" role="status" aria-busy="true" data-overview={overview}>
    <span className="sr-only">{label}</span>
    <div className="workspace-loading-rail" aria-hidden="true">
      <Skeleton/>
      {[1,2,3].map(index=><SlidePlaceholder key={index}/>)}
    </div>
    <div className="workspace-loading-stage" aria-hidden="true">
      <Skeleton/>
      {overview ? <div className="workspace-loading-grid">
        {[1,2,3,4].map(index=><SlidePlaceholder key={index}/>)}
      </div> : <SlidePlaceholder/>}
    </div>
    <div className="workspace-loading-inspector" aria-hidden="true">
      <Skeleton/><Skeleton/><Skeleton/>
    </div>
  </div>;
}

export function App() {
  const [state,setState] = useState<Route>(readRoute);
  useLayoutEffect(()=>{ window.scrollTo({top:0,behavior:'instant'}); },[state]);
  const [locale,setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('sabaq:locale') as Locale;
    return locales.includes(saved) ? saved : 'kk';
  });
  const [dark,setDark] = useState(() => document.documentElement.dataset.appearance !== 'light');
  const [decks,setDecks] = useState<Deck[]>([]);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState(false);
  const [template,setTemplate] = useState<Template>();
  const [catalogTopic,setCatalogTopic] = useState<string>();
  const [localAuthoring,setLocalAuthoring] = useState(false);
  const [alem,setAlem] = useState(false);
  const [usageAdmin,setUsageAdmin]=useState(false);
  const [coeditEnabled,setCoeditEnabled]=useState<boolean>();
  const [organization,setOrganization]=useState({member:false,admin:false});
  const [researchTopics,setResearchTopics] = useState<string[]>([]);
  const [searchOpen,setSearchOpen] = useState<boolean>();
  const loadedDecks = useRef(false);
  const t = words[locale];
  const reload = () => {
    setLoading(true);
    setLoadError(false);
    void request<Deck[]>('/decks').then((items) => {
      loadedDecks.current = true;
      setDecks(items);
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
  };
  useEffect(() => {
    const onRoute = () => setState(readRoute());
    window.addEventListener('hashchange', onRoute);
    void request<{alem:boolean;usageAdmin?:boolean; coedit?:boolean; accounts?:boolean; organizationAdmin?:boolean; localAuthoring?:boolean; researchTopics?:string[]}>('/capabilities').then(value => { setCoeditEnabled(Boolean(value.coedit)); setUsageAdmin(Boolean(value.usageAdmin)); setOrganization({member:Boolean(value.accounts),admin:Boolean(value.organizationAdmin)}); setAlem(value.alem); setLocalAuthoring(Boolean(value.localAuthoring)); setResearchTopics(value.researchTopics ?? []); }).catch(() => undefined);
    return () => window.removeEventListener('hashchange', onRoute);
  }, []);
  useEffect(() => { if (state.page === 'home' || state.page === 'library' || (state.page !== 'deck' && !loadedDecks.current)) reload(); }, [state.page]);
  useEffect(() => { if (searchOpen && state.page !== 'library' && !loadedDecks.current) reload(); }, [searchOpen]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase()!=='k' || event.defaultPrevented ||
          (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable=true]'))) return;
      event.preventDefault();
      setSearchOpen(value=>!value);
    };
    window.addEventListener('keydown',onShortcut);
    return () => window.removeEventListener('keydown',onShortcut);
  }, []);
  useEffect(() => {
    localStorage.setItem('sabaq:locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);
  function changeAppearance(value: boolean) {
    setStudioAppearance(value);
    setDark(value);
  }

  const openStart = (next?:Template,topic?:string) => { setTemplate(next); setCatalogTopic(topic); route('start'); };
  const create = async (input:CreateInput) => {
    const deck = await request<Deck>('/decks', {method:'POST',body:input});
    setDecks(current => [deck,...current.filter(d=>d.id!==deck.id)]);
    route('deck/' + deck.id + (input.review ? '' : '/grid'));
  };

  const importSlides = async (file: File, title: string, language: Locale, creationId: string, editable: boolean) => {
    const query = new URLSearchParams({ format: file.name.split('.').at(-1)!.toLowerCase(), title, language,creationId });
    if (editable) query.set('mode', 'editable');
    const response = await fetch('/api/import/slides?' + query, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    if (!response.ok) throw new Error(String(response.status));
    const deck: Deck = await response.json();
    setDecks(current => [deck, ...current.filter(item => item.id !== deck.id)]);
    route('deck/' + deck.id);
  };

  const searchLabel = state.page === 'deck' ? searchCopy[locale].title : homeCopy[locale].search;
  const find = <StudioButton aria-label={searchLabel} className="workspace-jump" variant="ghost" title={searchLabel} aria-keyshortcuts="Meta+K Control+K" onClick={()=>setSearchOpen(true)}>
    <MagnifyingGlassIcon data-icon="inline-start" aria-hidden/><span>{searchLabel}</span>
  </StudioButton>;
  const command = searchOpen !== undefined && <Suspense fallback={null}>
    <WorkspaceSearch locale={locale} decks={decks} open={searchOpen} onOpenChange={setSearchOpen} onNavigate={route} onNew={()=>openStart()}/>
  </Suspense>;
  if (state.page === 'deck') {
    return <><OrganizationMember.Provider value={organization.member}><DeckPage coeditView={state.view==='coedit'} coeditEnabled={coeditEnabled} organizationAdmin={organization.admin} key={state.id} id={state.id} initial={decks.find(d=>d.id===state.id)} grid={state.view==='grid'} presentation={state.view==='present'} locale={locale} controls={<>{find}<StudioLanguagePicker locale={locale} onLocale={setLocale}/></>} /></OrganizationMember.Provider>{command}</>;
  }

  const recent = [...decks].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const startMode = (mode:StartMode) => { setTemplate(undefined); setCatalogTopic(undefined); route('start/' + mode); };
  return <TooltipProvider>
    <StudioNavigation page={state.page} locale={locale} dark={dark} search={find} recent={recent} loading={loading}
      onLocale={setLocale} onAppearance={changeAppearance} onNew={()=>openStart()}>
      {state.page === 'home' && <Home locale={locale} dark={dark} researchTopics={researchTopics} recent={recent.slice(0, 3)} loading={loading} error={loadError} onRetry={reload}
        onTemplate={openStart} onStart={startMode} alem={alem} localAuthoring={localAuthoring} onCreate={create}/>}
      {state.page==='library' && usageAdmin && <Suspense fallback={null}><UsageReport locale={locale}/></Suspense>}
      {state.page === 'library' && <Library decks={decks} locale={locale} loading={loading} error={loadError} onRetry={reload} onNew={()=>openStart()} onTemplate={openStart} />}
      <Suspense fallback={<div className="workspace-loading-form page-inner" role="status" aria-busy="true">
        <span className="sr-only">{t.initial}</span><Skeleton/><Skeleton/><Skeleton/>
      </div>}>
        {state.page === 'templates' && <Templates organization={organization.member} locale={locale} onChoose={openStart} />}
        {state.page === 'files' && <SourceLibrary locale={locale}/>}
        {state.page === 'start' && <Start key={state.mode} initialMode={state.mode} locale={locale} template={template} catalogTopic={catalogTopic} alem={alem} localAuthoring={localAuthoring} researchTopics={researchTopics} onCreate={create} onBack={()=>route('home')} onTemplates={()=>route('templates')} onImport={importSlides} />}
      </Suspense>
    </StudioNavigation>
    {command}
  </TooltipProvider>;
}

function DeckPage({id,initial,grid,presentation,locale,controls,organizationAdmin,coeditView,coeditEnabled}: {coeditView:boolean;coeditEnabled?:boolean;organizationAdmin:boolean;id:string;initial?:Deck;grid:boolean;presentation:boolean;locale:Locale;controls:React.ReactNode}) {
  const [deck,setDeck] = useState(initial);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void request<Deck>(deckPath(id),{signal:controller.signal}).then(setDeck).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[id,coeditView,attempt]);
  const loadingPage = <div className="deck-shell" data-editor="true">
    <header className="deck-header">
      <DeckNavigation locale={locale}/>
      <Skeleton className="workspace-loading-title" aria-hidden="true"/>
      <div className="deck-preferences">{controls}</div>
    </header>
    <main className="deck-editor-main"><EditorPlaceholder label={words[locale].initial} overview={grid}/></main>
  </div>;
  if (!deck) {
    const t=words[locale];
    if (error) return <div className="deck-shell">
      <header className="deck-header"><DeckNavigation locale={locale}/><div className="deck-preferences">{controls}</div></header>
      <main className="standalone-state"><p role="alert">{t.unavailable}</p><Button variant="outline" onClick={()=>{setError(false);setAttempt(value=>value+1);}}>{t.retry}</Button><a className="underline" href="#/library">{t.library}</a></main>
    </div>;
    return loadingPage;
  }
  if(coeditView && coeditEnabled===undefined)return loadingPage;
  if(coeditView && coeditEnabled && deck.viewerPermission && deck.viewerPermission!=='view')
    return <Suspense fallback={loadingPage}><Coedit deck={deck} locale={locale}/></Suspense>;
  if (deck.viewerPermission === 'view' || deck.activeEditor) return <ReadOnlyLesson deck={deck} locale={locale}
    coeditHref={coeditEnabled && deck.viewerPermission!=='view' ? '#/deck/'+encodeURIComponent(id)+'/coedit' : undefined}/>;
  return <DeckWorkspace coeditEnabled={Boolean(coeditEnabled)} organizationAdmin={organizationAdmin} initial={deck} grid={grid} presentation={presentation} locale={locale} controls={controls}/>;
}

function DeckWorkspace({initial,grid,presentation,locale,controls,organizationAdmin,coeditEnabled}: {coeditEnabled:boolean;organizationAdmin:boolean;initial:Deck;grid:boolean;presentation:boolean;locale:Locale;controls:React.ReactNode}) {
  const {deck,status,receive,submit,edit,undoLast,redoLast,canUndo,canRedo,historyError,receiveAssistant,resolve,flush,
    conflictFields,canKeepConflict}=useDeck(initial);
  useEffect(() => {
    if (!initial.viewerPermission || presentation) return;
    const path = deckPath(initial.id) + '/edit-session';
    let mounted = true;
    const claim = () => {
      if (document.visibilityState !== 'visible') return;
      void request(path, {method:'POST'}).catch(error => { if (mounted && error?.status === 423) location.reload(); });
    };
    claim();
    const timer = setInterval(claim, 30000);
    const release = () => { void fetch('/api'+path+'/release',{ method:'POST', keepalive:true }).catch(()=>{}); };
    window.addEventListener('pagehide',release);
    return () => { mounted=false; clearInterval(timer); window.removeEventListener('pagehide',release); release(); };
  }, [initial.id,initial.viewerPermission,presentation]);
  useEffect(() => { localStorage.setItem('sabaq:last-opened-lesson',initial.id); },[initial.id]);
  const [selected,setSelected]=useState(() => {
    const key='sabaq:slide:'+initial.id;
    const savedSlide=sessionStorage.getItem(key) ?? localStorage.getItem(key);
    return initial.slides.find(slide=>slide.id===savedSlide)?.id ?? initial.slides.find(slide=>slide.status==='ready')?.id ?? '';
  });
  const [showEditor,setShowEditor]=useState(!grid && initial.phase==='editing');
  const [review,setReview]=useState<ReviewMode>();
  const reviewMode=presentation?'present':review;
  const [versionsOpen,setVersionsOpen]=useState(false);
  const [publishing,setPublishing]=useState(false);
  const [error,setError]=useState<string>();
  const [busy,setBusy]=useState(false);
  const t=words[locale];
  useEffect(() => { if (historyError) setError(t.error); }, [historyError, t.error]);
  const path=deckPath(deck.id);
  const ready=deck.slides.filter(s=>s.status==='ready');
  useAuthoringProgress(deck, receive);
  const active=deck.phase==='generating' || deck.slides.some(s=>s.status==='generating'||s.status==='pending');
  const allReady=deck.phase==='editing' && ready.length>0 && ready.length===deck.slides.length;
  useEffect(() => {
    const generating = deck.phase === 'generating' || deck.outlineStatus === 'generating';
    const state = generating
      ? { en: 'Creating…', ru: 'Формирование…', kk: 'Жасалуда…' }[locale]
      : allReady ? { en: 'Ready', ru: 'Готово', kk: 'Дайын' }[locale] : '';
    document.title = [state, deck.title, 'Sabaq Studio'].filter(Boolean).join(' · ');
    return () => { document.title = 'Sabaq Studio'; };
  }, [deck.phase, deck.outlineStatus, deck.title, allReady, locale]);
  const select=(id:string)=>{
    setSelected(id);
    sessionStorage.setItem('sabaq:slide:'+deck.id,id);
    localStorage.setItem('sabaq:slide:'+deck.id,id);
  };
  const open=(id:string)=>{
    select(id);
    setShowEditor(true);
    if (grid) route('deck/'+deck.id);
  };
  useEffect(()=>{
    if (grid) setShowEditor(false);
    else if (!active && ready.length) setShowEditor(true);
  },[grid]);
  const action=async (suffix:string,body?:unknown)=>{
    setBusy(true);setError(undefined);
    try {receive(await request<Deck>(path+suffix,{method:'POST',body}));}
    catch (failure) {setError(failure instanceof ApiError && failure.status===429 ? runLimitMessage[locale] : t.error);}
    finally{setBusy(false);}
  };
  async function generate() {if (!(await flush())) return;setShowEditor(false);await action('/generate');}
  const buttons=ready.length>0;
  const stateLabel=status==='conflict'?t.conflict:t[status];
  const editing = allReady || (showEditor && ready.length>0);
  const stage = deck.phase==='outline' ? 'outline' : editing ? 'editor' : 'generation';
  useLayoutEffect(()=>{ window.scrollTo({top:0,behavior:'instant'}); },[stage]);
  return <div className="deck-shell" data-editor={editing} data-authoring={!editing}>
    {!editing && <DeckSidebar locale={locale} deck={deck}/>}
    <header className="deck-header">
      <DeckNavigation locale={locale} deck={editing?undefined:deck}/>
      <div className="deck-title">
        <h1 lang={deck.language} title={deck.title}>{deck.title}</h1>
        <div className="deck-subtitle">
          <span>{deck.phase==='outline' ? t.outline : editing ? (grid ? t.slideGrid : {en:'Slide editor',ru:'Редактор слайдов',kk:'Слайд өңдегіші'}[locale]) : t.slideSequence}</span>
          <span aria-hidden="true">·</span>
          <small role="status" data-save-state={status}>{status==='saved' && <CheckCircleIcon size={13} aria-hidden="true"/>}{stateLabel}</small>
        </div>
      </div>
      <div className="deck-preferences">{controls}</div>
      <div className="deck-tool-actions">
        {initial.viewerPermission && <LessonAccess deck={{...deck, viewerPermission:initial.viewerPermission}} locale={locale} slideId={selected}/>}
        {!editing && buttons && deck.phase!=='outline' && <Button variant="outline" className="deck-view" onClick={()=>open(ready.find(slide=>slide.id===selected)?.id ?? ready[0].id)}><SquaresFourIcon data-icon="inline-start" /><span>{t.openEditor}</span></Button>}
        {buttons && <Menu>
          <MenuTrigger render={<Button variant="ghost" size="icon" aria-label={t.options} title={t.options} disabled={!buttons}/>}>
            <DotsThreeIcon weight="bold"/>
          </MenuTrigger>
          <MenuPopup sideOffset={7} align="end" className="deck-menu"><MenuGroup>
            {coeditEnabled && <MenuItem disabled={!allReady} onClick={async()=>{if(await flush())route('deck/'+deck.id+'/coedit');}}>{coeditLabels[locale]}</MenuItem>}
            {organizationAdmin && initial.viewerPermission==='owner' && <MenuItem disabled={!allReady} onClick={async()=>{if(await flush())setPublishing(true);}}>{organizationWords[locale].publish}</MenuItem>}
            <MenuItem disabled={!allReady} onClick={async()=>{if(await flush())setVersionsOpen(true);}}><TranslateIcon/>{versionLabels[locale].create}</MenuItem>
            <MenuItem onClick={()=>setReview('versions')}><ClockCounterClockwiseIcon/>{t.versions}</MenuItem>
            <MenuItem onClick={async()=>{if(await flush())setReview('export');}}><DownloadSimpleIcon/>{t.export}</MenuItem>
            {!allReady && <MenuItem onClick={()=>setReview('video')}><VideoCameraIcon/>{t.video}</MenuItem>}
          </MenuGroup></MenuPopup>
        </Menu>}
        {buttons && <Button variant="outline" data-action="present" aria-label={t.present} onClick={()=>setReview('present')} title={t.present}><PlayIcon weight="fill" data-icon="inline-start"/><span>{t.present}</span></Button>}
        {allReady && <Button data-action="video" aria-label={t.video} title={t.video} onClick={async()=>{if(await flush())setReview('video');}}><VideoCameraIcon weight="bold" data-icon="inline-start"/><span>{t.video}</span></Button>}
      </div>
    </header>
    {publishing && <OrganizationPublisher deck={deck} locale={locale} close={()=>setPublishing(false)}/>}
    {allReady && <LanguageVersions deck={deck} locale={locale} open={versionsOpen} onOpen={async next=>{if(!next || await flush())setVersionsOpen(next);}} onUpdate={receive}/>}
    {status==='conflict' && <div className="page-alert" role="alert">
      <WarningCircleIcon size={17} aria-hidden="true"/>{t.conflict}
      <Button variant="outline" disabled={!canKeepConflict} onClick={()=>resolve(true)}>{t.keepMine}</Button>
      <Button variant="ghost" onClick={()=>resolve(false)}>{t.keepServer}</Button>
      <EditConflictDetails locale={locale} fields={conflictFields}/>
    </div>}
    {error && <div className="page-alert" role="alert"><WarningCircleIcon size={17}/>{error}<Button size="icon" variant="ghost" aria-label={t.close} onClick={()=>setError(undefined)}><XIcon /></Button></div>}
    {deck.phase==='outline' ? <Outline deck={deck} locale={locale} busy={busy} onEdit={submit} onGenerate={()=>void generate()} onRetry={()=>void action('/outline/retry')}/> :
      editing ? <main className="deck-editor-main"><Suspense fallback={<EditorPlaceholder label={t.initial} overview={grid}/>}><Editor
        deck={deck} uiLocale={locale} selectedSlideId={deck.slides.find(slide=>slide.id===selected)?.id ?? ready[0].id} onSelectSlide={select} onEdit={edit}
        view={allReady && grid?'overview':'slide'} onViewChange={view=>{
          if (!allReady) setShowEditor(view==='slide');
          route('deck/'+deck.id+(view==='overview'?'/grid':''));
        }}
        onEditOp={submit} onUndo={undoLast} onRedo={redoLast} canUndo={canUndo} canRedo={canRedo}
        onRetry={id=>void action('/retry',{slideId:id})}
        beforeAssistant={flush} onAssistantDeck={receiveAssistant}
      /></Suspense></main> : <Generation deck={deck} locale={locale} active={active} busy={busy} onAdd={()=>submit({kind:'add'})} onOpen={open} onPresent={()=>setReview('present')} onCancel={()=>void action('/cancel')} onResume={()=>void generate()} onRetry={id=>void action('/retry',{slideId:id})}/>}
    {reviewMode && <Suspense fallback={null}><Review mode={reviewMode} deck={deck} slideId={selected||ready[0]?.id} locale={locale} onClose={()=>{
      setReview(undefined);
      if (presentation) route('deck/'+deck.id);
    }} onRestore={receive}/></Suspense>}
  </div>;
}
