import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretDownIcon, CaretUpIcon, CopyIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, RectangleIcon, SidebarSimpleIcon, SquaresFourIcon } from '@phosphor-icons/react';
import { useDefaultLayout } from 'react-resizable-panels';
import type { Deck, EditOp, Locale, SlideChanges } from '@sabaq/lesson/types';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/shadcn/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from '@/components/shadcn/dropdown-menu';
import { AssistantSession } from '@/features/assistant/AssistantSession';
import { SlideGroups, groupWords } from './SlideGroups';
import { SlideNavigator, slideOrderMessage } from './SlideNavigator';
import { editorCopy, workspaceWords } from './editorCopy';
import { IconButton } from './EditorControls';
import { SlideDetails, type InspectorTab, type InsertMediaKind, type NewSlideContent } from './SlideDetails';
import type { CanvasZoom } from './useCanvasViewport';
import './editor.css';
import './workspace-controls.css';
import './canvas-toolbar.css';

export type EditorView = 'slide' | 'overview';
export interface EditorProps {
  view?: EditorView;
  onViewChange?: (view: EditorView) => void;
  appearanceRequest?: number;
  deck: Deck;
  uiLocale: Locale;
  selectedSlideId: string;
  onSelectSlide: (id: string) => void;
  onEdit: (slideId: string, changes: SlideChanges) => void;
  beforeAssistant: () => Promise<boolean>;
  onAssistantDeck: (deck: Deck, appliedRevision?: number, restoredRevision?:number) => void;
  onEditOp?: (op: EditOp) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onRetry?: (slideId: string) => void;
}

export function Editor(props: EditorProps) {
  const { deck, uiLocale, selectedSlideId, onSelectSlide, onEditOp } = props;
  const c = editorCopy[uiLocale];
  const index = Math.max(
    0,
    deck.slides.findIndex((s) => s.id === selectedSlideId),
  );
  const slide = deck.slides[index];
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [groupsOpen,setGroupsOpen]=useState(false);
  const [pendingContent,setPendingContent]=useState<{id:string;content:NewSlideContent}>();
  const [initialMedia,setInitialMedia]=useState<{id:string;kind:InsertMediaKind}>();
  const [focused, setFocused] = useState(false);
  const [localView, setLocalView] = useState<EditorView>('slide');
  const view = props.view ?? localView;
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('assistant');
  const themeTrigger = useRef<HTMLButtonElement>(null);
  const [appearancePending, setAppearancePending] = useState(false);
  const createContent=(content:NewSlideContent)=>{
    if(!onEditOp || deck.slides.length>=40)return;
    const id=crypto.randomUUID();
    setPendingContent({id,content});
    onEditOp({kind:'add',newSlideId:id,afterId:slide.id});
  };
  useEffect(()=>{
    if(!pendingContent || !deck.slides.some(item=>item.id===pendingContent.id))return;
    const {id,content}=pendingContent;
    setPendingContent(undefined);
    if('changes' in content)props.onEdit(id,content.changes);
    else setInitialMedia({id,kind:content.media});
    onSelectSlide(id);
    setInspectorOpen(true);
    setInspectorTab('design');
  },[pendingContent,deck.slides,props.onEdit,onSelectSlide]);
  const canOverview = deck.phase === 'editing' && deck.slides.every((item) => item.status === 'ready');
  const [railModes, setRailModes] = useState({ slide: false, overview: false });
  const outline = railModes[view];
  const overviewList = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const focusAfterOpen = useRef(false);
  const focusViewSwitch = useRef<EditorView | null>(null);
  function changeView(next: EditorView) {
    if (next === view) return;
    setFocused(false);
    setMobileListOpen(false);
    if (props.onViewChange) props.onViewChange(next);
    else setLocalView(next);
  }
  function editFromOverview(id: string) {
    focusAfterOpen.current = true;
    onSelectSlide(id);
    changeView('slide');
  }
  useLayoutEffect(() => {
    if (view === 'overview') setFocused(false);
    if (view === 'slide') {
      setInspectorOpen(true);
      setInspectorTab('assistant');
    }
    if (view === 'slide' && focusAfterOpen.current) {
      workspace.current?.querySelector<HTMLElement>('.ed-stage')?.focus({ preventScroll: true });
      focusAfterOpen.current = false;
    }
    if (focusViewSwitch.current === view) {
      workspace.current?.querySelector<HTMLElement>('.ed-view-switch button[aria-pressed="true"]')?.focus({ preventScroll: true });
      focusViewSwitch.current = null;
    }
  }, [view]);
  useLayoutEffect(() => {
    if (!props.appearanceRequest) return;
    setFocused(false);
    setInspectorOpen(true);
    setInspectorTab('design');
    setAppearancePending(true);
  }, [props.appearanceRequest]);
  useLayoutEffect(() => {
    if (!appearancePending || !themeTrigger.current || inspectorTab !== 'design') return;
    const trigger = themeTrigger.current;
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    trigger.focus({preventScroll: true});
    trigger.scrollIntoView({block: 'nearest'});
    setAppearancePending(false);
  }, [appearancePending, inspectorTab]);
  const [zoom, setZoom] = useState<CanvasZoom>('fit');
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 961px)').matches);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: view === 'overview' ? 'sabaq-overview-' + inspectorOpen : desktop && !inspectorOpen ? 'sabaq-editor-canvas-and-list' : 'sabaq-editor-panes',
    onlySaveAfterUserInteractions: true,
  });
  useEffect(() => {
    const query = window.matchMedia('(min-width: 961px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(()=>{
    const root=workspace.current;
    if (!root) return;
    const viewport=window.visualViewport;
    const update=()=>{
      const height=viewport?.height ?? window.innerHeight;
      root.style.setProperty('--editor-available-height',`${Math.max(220,height-Math.max(0,root.getBoundingClientRect().top))}px`);
      root.dataset.keyboard=String(Boolean(viewport && height<window.innerHeight*.78));
    };
    const header=root.closest('.deck-shell')?.querySelector('.deck-header');
    const observer=new ResizeObserver(update);
    if (header) observer.observe(header);
    window.addEventListener('resize',update);
    viewport?.addEventListener('resize',update);
    update();
    return ()=>{
      observer.disconnect();
      window.removeEventListener('resize',update);
      viewport?.removeEventListener('resize',update);
    };
  },[view]);
  const rail = useRef<HTMLDivElement>(null);
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  useEffect(() => {
    if (!focused) return;
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [contenteditable="true"]'))
      )
        return;
      setFocused(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [focused]);
  useLayoutEffect(() => {
    const list = rail.current;
    const item = list?.querySelector<HTMLElement>('.ed-thumb[aria-current]');
    if (!list || !item || focused) return;
    const bounds = list.getBoundingClientRect();
    const active = item.getBoundingClientRect();
    const horizontal = getComputedStyle(list).flexDirection === 'row';
    const start = horizontal ? active.left - bounds.left : active.top - bounds.top;
    const end = horizontal ? active.right - bounds.right : active.bottom - bounds.bottom;
    const delta = start < 0 ? start - 8 : end > 0 ? end + 8 : 0;
    if (delta) list.scrollBy(horizontal ? { left: delta } : { top: delta });
  }, [slide?.id, index, focused, outline, mobileListOpen, view]);
  if (!slide)
    return (
      <section className="ed-workspace">
        <p>{c.empty}</p>
        {onEditOp && (
          <Button variant="outline" size="sm" onClick={() => onEditOp({ kind: 'add' })}>
            <PlusIcon />
            {c.add}
          </Button>
        )}
      </section>
    );
  function moveSlide(id: string, to: number) {
    const from = deck.slides.findIndex((item) => item.id === id);
    if (!onEditOp || deck.phase !== 'editing' || from < 0 || to === from || to < 0 || to >= deck.slides.length) return;
    const ids = deck.slides.map((item) => item.id);
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    onEditOp({kind: 'reorder', slideIds: ids});
    setOrderAnnouncement(slideOrderMessage(uiLocale, deck.slides[from], to, ids.length));
  }
  const words = workspaceWords[uiLocale];
  const viewSwitch = (canOverview || view === 'overview') && (
    <ToggleGroup className="ed-view-switch" aria-label={words.mode} value={[view]}
      onValueChange={(values) => {
        const next = values[0] as EditorView | undefined;
        if (!next || next === view) return;
        focusViewSwitch.current = next;
        changeView(next);
      }} spacing={0} size="sm">
      <ToggleGroupItem value="slide" aria-label={c.slide} title={c.slide}>
        <RectangleIcon aria-hidden /><span>{c.slide}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="overview" aria-label={words.grid} title={words.grid}>
        <SquaresFourIcon aria-hidden /><span>{words.grid}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const railCommands = (
    <div className="ed-rail-commands">
      {onEditOp && <IconButton label={c.add} onClick={() => onEditOp({ kind: 'add', afterId: slide.id })}><PlusIcon /></IconButton>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="ed-icon" aria-label={c.slideView} title={c.slideView} />}>
          <DotsThreeIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          <DropdownMenuRadioGroup value={outline ? 'outline' : 'thumbnails'} onValueChange={(value) => {
            setRailModes((current) => ({ ...current, [view]: value === 'outline' }));
            setMobileListOpen(true);
          }}>
            <DropdownMenuRadioItem value="thumbnails">{c.thumbnails}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="outline">{c.outline}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {onEditOp && deck.phase === 'editing' && <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={()=>{void props.beforeAssistant().then(ready=>{if(ready)setGroupsOpen(true);});}}><CopyIcon />{groupWords[uiLocale].open}</DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onClick={() => moveSlide(slide.id, index - 1)}><CaretUpIcon />{c.moveUp}</DropdownMenuItem>
              <DropdownMenuItem disabled={index === deck.slides.length - 1} onClick={() => moveSlide(slide.id, index + 1)}><CaretDownIcon />{c.moveDown}</DropdownMenuItem>
            </DropdownMenuGroup>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <section ref={workspace} className="ed-workspace ed-studio-editor" data-editor-panel={inspectorTab} aria-label={c.workspace}
      onPointerDownCapture={(event) => {
        const source = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-editor-motion]') : null;
        event.currentTarget.dataset.pointerMotion = source?.dataset.editorMotion ?? '';
      }}
      onKeyDownCapture={(event) => { delete event.currentTarget.dataset.pointerMotion; }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey && props.canUndo) {
          event.preventDefault();
          props.onUndo?.();
        }
        if ((key === 'z' && event.shiftKey || key === 'y') && props.canRedo) {
          event.preventDefault();
          props.onRedo?.();
        }
      }}>
      <div className="ed-frame" data-focused={focused} data-editor-view={view}>
        <ResizablePanelGroup id="sabaq-editor-panes" orientation="horizontal" className="ed-panes"
          disabled={!desktop || focused} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        {view === 'slide' && <><ResizablePanel id="slide-list" className="ed-pane" defaultSize={window.matchMedia('(min-width:961px) and (max-width:1150px)').matches ? '148px' : '192px'} minSize="144px" maxSize="320px" groupResizeBehavior="preserve-pixel-size">
        <nav className="ed-rail" aria-label={c.slides} data-mobile-open={mobileListOpen}>
          {viewSwitch}
          <div className="ed-rail-head">
            <h2>{c.slides} <span>{deck.slides.length}</span></h2>
            <Button className="ed-rail-disclosure" data-editor-motion="filmstrip" variant="ghost" size="sm"
              aria-expanded={mobileListOpen} aria-controls="editor-slide-navigator"
              onClick={() => setMobileListOpen((open) => !open)}>
              {c.slides}<span>{deck.slides.length}</span><CaretDownIcon aria-hidden />
            </Button>
            {railCommands}
          </div>
          <SlideNavigator deck={deck} locale={uiLocale} selectedId={slide.id} outline={outline}
            listRef={rail} onSelect={onSelectSlide} onMove={onEditOp && deck.phase === 'editing' ? moveSlide : undefined}
            announcement={orderAnnouncement} />
        </nav>
        </ResizablePanel>
        <ResizableHandle className="ed-separator" withHandle aria-label={workspaceWords[uiLocale].rail} /></>}
        <AssistantSession deck={deck} slide={slide} locale={uiLocale} enabled={inspectorTab==='assistant'} beforeAssistant={props.beforeAssistant} onAssistantDeck={props.onAssistantDeck}>
        {view === 'overview' && <ResizablePanel id="slide-canvas" minSize="330px" className="ed-pane">
          <section className="ed-center ed-overview" aria-label={workspaceWords[uiLocale].overview}>
            <div className="ed-overview-head">
              <div className="ed-overview-heading">
                {viewSwitch}
                <h2>{words.overview}<span>{deck.slides.length}</span></h2>
              </div>
              <div className="ed-overview-commands">
                {railCommands}
                {desktop && <Button size="icon-sm" variant="ghost" className="ed-overview-settings" data-editor-motion="inspector"
                  aria-label={c.inspector} title={c.inspector} aria-expanded={inspectorOpen}
                  aria-controls={inspectorOpen ? 'slide-inspector' : undefined} onClick={() => setInspectorOpen(!inspectorOpen)}>
                  <SidebarSimpleIcon mirrored aria-hidden />
                </Button>}
                <Button size="sm" variant="outline" className="ed-overview-edit" aria-label={words.editSlide}
                  title={words.editSlide} onClick={() => editFromOverview(slide.id)}>
                  <PencilSimpleIcon aria-hidden /><span>{words.editSlide}</span>
                </Button>
              </div>
            </div>
            <SlideNavigator deck={deck} locale={uiLocale} selectedId={slide.id} outline={outline} overview
              listRef={overviewList} onSelect={onSelectSlide} onOpen={editFromOverview}
              onMove={onEditOp && deck.phase === 'editing' ? moveSlide : undefined} announcement={orderAnnouncement} />
          </section>
        </ResizablePanel>}
        <SlideDetails
          key={`${view}:${slide.id}`}
          {...props}
          view={view}
          slide={slide}
          index={index}
          focused={focused}
          desktop={desktop}
          inspectorOpen={inspectorOpen}
          setInspectorOpen={setInspectorOpen}
          zoom={zoom}
          onZoomChange={setZoom}
          inspectorTab={inspectorTab}
          setInspectorTab={setInspectorTab}
          onToggleFocus={() => setFocused((value) => !value)}
          onCreateContent={createContent}
          initialMediaKind={initialMedia?.id===slide.id ? initialMedia.kind : undefined}
          onMediaOpened={()=>setInitialMedia(undefined)}
          themeTrigger={themeTrigger}
        />
        </AssistantSession>
        </ResizablePanelGroup>
      </div>
      {groupsOpen && onEditOp && <SlideGroups deck={deck} afterId={slide.id} locale={uiLocale} submit={onEditOp} close={()=>setGroupsOpen(false)}/>}
    </section>
  );
}
export default Editor;
