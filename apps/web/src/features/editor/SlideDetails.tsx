import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Editor as TipEditor } from '@tiptap/core';
import {
  ArrowCounterClockwiseIcon, ArrowClockwiseIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon, CaretDownIcon,
  CaretLeftIcon, CaretRightIcon, ChartBarIcon, FunctionIcon, ClockIcon, CopyIcon, FileTextIcon,
  DotsThreeIcon, TreeStructureIcon, TextTIcon, TextAlignJustifyIcon, ImageIcon, LayoutIcon,
  MinusIcon, MonitorIcon, NotePencilIcon, PlusIcon, RectangleIcon, ShapesIcon, SquaresFourIcon, StackIcon,
  SidebarSimpleIcon, SlidersHorizontalIcon, ChatCircleTextIcon, TableIcon, TrashIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import type { Layout, Slide, SlideChanges, SourceExcerpt } from '@sabaq/lesson/types';
import { effectiveFreeLayout, groupFree, selectedGroup, stackFree } from '@sabaq/lesson/free-layout';
import { selectionNodes, type SlideDiagram } from '@sabaq/lesson/diagram';
import { alternateLayouts, documentRuns, safeHref, SlideCanvas, type TextSlot } from '@sabaq/slide-renderer/canvas';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shadcn/tabs';
import { Button } from '@/components/shadcn/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/shadcn/dropdown-menu';
import { Textarea } from '@/components/coss/textarea';
import { Input } from '@/components/coss/input';
import { DialogFooter } from '@/components/coss/dialog';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem, SelectLabel } from '@/components/coss/select';
import { Toolbar, ToolbarButton, ToolbarSeparator } from '@/components/coss/toolbar';
import { AssistantPanel } from '@/features/assistant/Assistant';
import { CanvasAssistantMenu, CanvasAssistantDropdown, ShortenOverflowButton, useCanvasProposal, canvasCopy } from '@/features/assistant/AssistantCanvas';
import { slideLayoutNames } from '@/slide-layout-copy';
import { LectureNotes, lectureTitle } from './LectureNotes';
import { SourceReview } from './SourceReview';
import { elementNames, FreeLayoutEditor, FreeLayoutOverlay, freeWords } from './FreeLayoutEditor';
import { captureLayout } from './capture-layout';
import { useDirectPlacement } from './useDirectPlacement';
import { DiagramEditor, diagramWords } from './DiagramEditor';
import { SlideQuality } from './SlideQuality';
import { SlideObjectMenuItems, useSlideObjects } from './SlideObjects';
import { canvasWidthAt100Percent, canvasZoomLevels, useCanvasViewport, type CanvasZoom } from './useCanvasViewport';
import { LessonImageEditor, imageGridWords, imageWords } from './LessonImageEditor';
import { editorCopy, workspaceWords, type EditorCopy } from './editorCopy';
import { SlidePositionPicker } from './SlidePositionPicker';
import { ThemePicker } from './ThemePicker';
import { ImageStylePicker } from './ImageStylePicker';
import { SlideDataEditor } from './SlideDataEditor';
import { PowerPointLayoutPicker } from './PowerPointLayoutPicker';
import { layoutChoices, layoutPickerCopy, SlideLayoutPicker } from './SlideLayoutPicker';
import { IconButton, Modal } from './EditorControls';
import { ActiveSlot, TextSheet, ToolRow } from './InlineSlideText';
import { ImageAltDialog, StoryEdit, storyFields } from './SlideContentDialogs';
import type { EditorProps } from './Editor';

type SlideDetailsProps = Pick<EditorProps,
  'view' | 'deck' | 'uiLocale' | 'onEdit' | 'onEditOp' | 'onUndo' |
  'onRedo' | 'canUndo' | 'canRedo' | 'onRetry' | 'onSelectSlide'
> & {
  slide: Slide;
  index: number;
  focused: boolean;
  desktop: boolean;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  zoom: CanvasZoom;
  onZoomChange: (zoom: CanvasZoom) => void;
  onToggleFocus: () => void;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  onCreateContent: (content: NewSlideContent) => void;
  initialMediaKind?: InsertMediaKind;
  onMediaOpened: () => void;
  themeTrigger: RefObject<HTMLButtonElement | null>;
};

const placementCopy = {
  en: { layers: 'Layers' },
  ru: { layers: 'Слои' },
  kk: { layers: 'Қабаттар' },
};
type DialogKind = 'edit-image' | 'image' | 'source' | 'link' | 'remove' | 'story' | 'diagram' | 'arrange';

export type InspectorTab = 'design' | 'notes' | 'assistant';
export type InsertMediaKind = 'image'|'formula'|'pictogram';
export type NewSlideContent = {changes:SlideChanges} | {media:InsertMediaKind};
const canvasToolbarCopy = {
  en: { toolbar:'Slide controls', navigation:'Slide navigation', zoomIn:'Zoom in', zoomOut:'Zoom out', focus:'Focus', mouse:'Middle-drag to pan. Ctrl + mouse wheel to zoom.' },
  ru: { toolbar:'Управление слайдом', navigation:'Навигация по слайдам', zoomIn:'Увеличить масштаб', zoomOut:'Уменьшить масштаб', focus:'Фокус', mouse:'Перетаскивание средней кнопкой перемещает холст. Ctrl + колесо меняет масштаб.' },
  kk: { toolbar:'Слайдты басқару', navigation:'Слайдтар арасында өту', zoomIn:'Үлкейту', zoomOut:'Кішірейту', focus:'Фокус', mouse:'Кенепті тінтуірдің ортаңғы түймесімен жылжытыңыз. Масштабты Ctrl және тінтуір дөңгелегімен өзгертіңіз.' },
};
const inspectorWords = {
  en: { design: 'Design', notes: 'Notes', elements: 'Slide elements', deck: 'Entire presentation', words: 'Words', notesHint: 'Visible in presenter view.' },
  ru: { design: 'Дизайн', notes: 'Лекция', elements: 'Элементы слайда', deck: 'Вся презентация', words: 'Слов', notesHint: 'Видны в режиме докладчика.' },
  kk: { design: 'Дизайн', notes: 'Жазба', elements: 'Слайд элементтері', deck: 'Бүкіл презентация', words: 'Сөз саны', notesHint: 'Баяндамашы режимінде көрінеді.' },
};
const insertWords = {
  en: { insert:'Insert', image:'Image', table:'Table', chart:'Chart', diagram:'Diagram from text', formula:'Formula', icon:'Icon', free:'Free layout', column:'Column', category:'Category', series:'Series', newSlide:'on a new slide', limit:'This presentation has reached the 40-slide limit.' },
  ru: { insert:'Вставить', image:'Изображение', table:'Таблица', chart:'Диаграмма', diagram:'Схема из текста', formula:'Формула', icon:'Пиктограмма', free:'Свободный режим', column:'Столбец', category:'Категория', series:'Ряд', newSlide:'на новый слайд', limit:'В презентации уже 40 слайдов.' },
  kk: { insert:'Кірістіру', image:'Сурет', table:'Кесте', chart:'Диаграмма', diagram:'Мәтіннен сызба', formula:'Формула', icon:'Пиктограмма', free:'Еркін режим', column:'Баған', category:'Санат', series:'Қатар', newSlide:'жаңа слайдқа', limit:'Презентацияда 40 слайд бар.' },
};

const insertSections = {
  en: { objects: 'Objects', content: 'Media and data', edit: 'Edit this slide' },
  ru: { objects: 'Объекты', content: 'Медиа и данные', edit: 'Правка слайда' },
  kk: { objects: 'Нысандар', content: 'Медиа және деректер', edit: 'Слайдты өңдеу' },
};

function statusText(slide: Slide, c: EditorCopy) {
  return c[slide.status === 'cancelled' ? 'canceled' : slide.status];
}

function InspectorAction({ children, icon, onClick, disabled, title }: {
  children: ReactNode; icon: ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <Button variant="ghost" size="sm" type="button" className="inspect-action" onClick={onClick} disabled={disabled} title={title}>
      {icon}<span>{children}</span><CaretRightIcon data-icon="inline-end" aria-hidden />
    </Button>
  );
}

export function SlideDetails({
  slide,
  deck,
  uiLocale,
  onEdit,
  inspectorTab,
  setInspectorTab,
  onEditOp,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onRetry,
  onSelectSlide,
  index,
  focused,
  desktop,
  inspectorOpen,
  setInspectorOpen,
  zoom,
  onZoomChange,
  onToggleFocus,
  onCreateContent,
  initialMediaKind,
  onMediaOpened,
  themeTrigger,
  view = 'slide',
}: SlideDetailsProps) {
  const c = editorCopy[uiLocale];
  const [editing, setEditing] = useState<{ slot: TextSlot; inSheet: boolean } | null>(null);
  const proposal = useCanvasProposal();
  const [originalProposal, setOriginalProposal] = useState<string>();
  const reviewing = Boolean(proposal && inspectorTab === 'assistant' && !editing && view === 'slide');
  const proposed = reviewing && proposal && originalProposal !== proposal.id ? proposal : undefined;
  const words = {
    en: {preview:'Change preview', before:'Original', after:'Proposed', computer:'Use a computer to edit directly on the canvas.', overflow:'Text does not fit on the slide.'},
    ru: {preview:'Просмотр правок', before:'Исходный', after:'С правками', computer:'Редактировать прямо на холсте можно на компьютере.', overflow:'Текст не помещается на слайде.'},
    kk: {preview:'Түзетулерді қарау', before:'Бастапқы', after:'Ұсынылған', computer:'Слайдты кенепте тікелей өңдеу үшін компьютерді қолданыңыз.', overflow:'Мәтін слайдқа сыймайды.'},
  }[uiLocale];
  const slot = editing?.slot;
  const [tip, setTip] = useState<TipEditor | null>(null);
  const [arrangement,setArrangement]=useState<ReturnType<typeof captureLayout>>();
  const [diagramDraft,setDiagramDraft]=useState<{diagram:SlideDiagram; existing:boolean}>();
  const pendingDiagram=useRef<string|undefined>(undefined);
  useEffect(()=>{
    const id=pendingDiagram.current;
    if(id && deck.slides.some(item=>item.id===id)) {
      pendingDiagram.current=undefined;
      onSelectSlide(id);
    }
  },[deck.slides,onSelectSlide]);

  const labels = inspectorWords[uiLocale];
  const zoomLevels: readonly `${number}`[] = canvasZoomLevels;
  const visibleZoomLevels = zoom === 'fit' || zoomLevels.includes(zoom)
    ? zoomLevels : [...zoomLevels, zoom].sort((a, b) => Number(a) - Number(b));
  const zoomOptions: { value: CanvasZoom; label: string }[] = [
    { value: 'fit', label: workspaceWords[uiLocale].fit },
    ...visibleZoomLevels.map((value) => ({ value, label: `${value}%` })),
  ];
  const [modal, setModal] = useState<DialogKind | null>(initialMediaKind ? 'edit-image' : null);
  const [imageIndex,setImageIndex]=useState(0);
  const [mediaKind,setMediaKind]=useState<InsertMediaKind|undefined>(initialMediaKind);
  useEffect(()=>{if(initialMediaKind)onMediaOpened();},[initialMediaKind,onMediaOpened]);
  const [excerpt, setExcerpt] = useState<SourceExcerpt | null>(null);
  const [url, setUrl] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [overflow, setOverflow] = useState<TextSlot | null>(null);
  const { viewport, stage, changeZoom, resetPan } = useCanvasViewport(zoom, onZoomChange);
  const canvasTools = canvasToolbarCopy[uiLocale];
  function stepZoom(direction: 1 | -1) {
    const current = zoom === 'fit' ? (stage.current?.clientWidth ?? canvasWidthAt100Percent) / canvasWidthAt100Percent * 100 : Number(zoom);
    const next = direction === 1 ? canvasZoomLevels.find(level => Number(level) > current)
      : canvasZoomLevels.findLast(level => Number(level) < current);
    if (next) changeZoom(next);
  }
  const editEntry = useRef<HTMLElement>(null);
  const canEdit = slide.status === 'ready';
  const directEnabled = canEdit && view === 'slide' && !reviewing && !editing;
  const direct = useDirectPlacement({
    enabled: directEnabled, slide, stage,
    onCommit: freeLayout => onEdit(slide.id, {freeLayout}),
  });
  const detectOverflow = useCallback((overflows: boolean) => {
    if (!overflows) {
      setOverflow(null);
      return;
    }
    if (!slide.body.trim()) {
      setOverflow('title');
      return;
    }
    const title = stage.current?.querySelector('.ed-slide-title');
    if (title) {
      const bounds = title.getBoundingClientRect();
      const nodes = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some(rect => rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))) {
          setOverflow('title');
          return;
        }
      }
    }
    setOverflow('body');
  }, [slide.body]);
  function openAssistant() {
    setEditing(null);
    direct.clear();
    if (focused) onToggleFocus();
    if (desktop) setInspectorOpen(true);
    setInspectorTab('assistant');
  }
  const save = (changes: SlideChanges) => onEdit(slide.id, changes);
  const placement = placementCopy[uiLocale];
  const layerLayout = direct.layout ?? effectiveFreeLayout(slide);
  const layerName = elementNames(layerLayout, uiLocale);
  const slideObjects = useSlideObjects({
    deck, slide, locale:uiLocale, enabled:canEdit && !reviewing && view==='slide', onChange:save,
    renderActions:(object, close) => <CanvasAssistantDropdown object={object} openReview={()=>{close();openAssistant();}}
      trigger={<Button type="button" variant="outline" size="sm"><ChatCircleTextIcon aria-hidden />{canvasCopy[uiLocale].label}</Button>}/>,
  });
  const offset = (direction: number) => {
    const next = deck.slides[index + direction];
    if (next) onSelectSlide(next.id);
  };
  const startEditing = (slot: TextSlot, entry: HTMLElement) => {
    direct.clear();
    editEntry.current = entry;
    setEditing({ slot, inSheet: !desktop });
  };
  const endEditing = () => {
    setEditing(null);
    requestAnimationFrame(() => {
      const target = editEntry.current?.isConnected ? editEntry.current
        : stage.current?.querySelector<HTMLElement>(`[data-slot-entry="${slot}"]`);
      target?.focus({ preventScroll: true });
    });
  };
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryTrigger = useRef<HTMLButtonElement | null>(null);
  const previousPositions = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const positions = previousPositions.current;
    const surface = stage.current;
    if (!positions || !surface) return;
    previousPositions.current = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const options = {duration: reduced ? 100 : 400, easing: 'cubic-bezier(.2,.8,.2,1)'};
    const animations: Animation[] = [];
    for (const [selector, before] of positions) {
      const element = surface.querySelector<HTMLElement>(selector);
      if (!element) continue;
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!reduced && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        animations.push(element.animate([{translate: `${dx}px ${dy}px`}, {translate: '0 0'}], options));
      }
    }
    if (!animations.length) animations.push(surface.animate([{opacity:.8}, {opacity:1}], {...options, duration:reduced ? 100 : 200}));
    return () => animations.forEach(animation => animation.cancel());
  }, [slide.layout]);
  const [initialLayout] = useState(() => {
    if (!alternateLayouts.some((layout) => layout === slide.layout) || slide.design?.variant) return slide.layout;
    return deck.outline.find((item) => item.id === slide.id)?.layout ?? slide.layout;
  });
  const choices = layoutChoices(slide, initialLayout);
  const galleryWords = layoutPickerCopy[uiLocale];
  const layoutLabel = (layout: Layout) => slide.design?.variant && !['image-grid','image-section'].includes(layout) && !alternateLayouts.some((item) => item === layout)
    ? galleryWords.original : slideLayoutNames[uiLocale][layout];
  const applyLayout = (layout: Layout) => {
    if (!canEdit || layout === slide.layout && !slide.freeLayout) return;
    setEditing(null);
    direct.clear();
    const surface = stage.current;
    if (surface) {
      const positions = new Map<string, DOMRect>();
      for (const selector of ['.ed-slide-title', '.ed-slide-body', '.ed-slide-image']) {
        const element = surface.querySelector(selector);
        if (element) positions.set(selector, element.getBoundingClientRect());
      }
      previousPositions.current = positions;
    }
    save({layout,freeLayout:null});
  };
  const toggleGallery = (trigger: HTMLButtonElement) => {
    galleryTrigger.current = trigger;
    setGalleryOpen((open) => !open);
  };
  const gallery = galleryOpen && <SlideLayoutPicker deck={deck} slide={slide} locale={uiLocale}
    recommended={choices.gallery} layouts={choices.all} label={layoutLabel} closeLabel={c.close}
    onLayout={applyLayout} onClose={() => { setGalleryOpen(false); galleryTrigger.current?.focus({ preventScroll: true }); }} />;
  const insert = insertWords[uiLocale];
  const mediaNeedsSlide=Boolean(slide.importedPage || slide.diagram || (slide.additionalImages?.length??0)>=2);
  const dataNeedsSlide=Boolean(slide.importedPage || slide.diagram);
  const canCreateSlide=Boolean(onEditOp && deck.slides.length<40);
  const openMedia = (kind:InsertMediaKind) => {
    direct.clear();
    if(mediaNeedsSlide) {if(canCreateSlide)onCreateContent({media:kind});return;}
    setMediaKind(kind);
    setImageIndex(slide.image ? (slide.additionalImages?.length??0)+1 : 0);
    setModal('edit-image');
  };
  const openArrangement = () => {
    setEditing(null);
    direct.clear();
    setInspectorTab('design');
    if (desktop) setInspectorOpen(true);
    requestAnimationFrame(()=>{
      setArrangement(captureLayout(slide,stage.current?.querySelector<HTMLElement>('.ed-slide')));
      setModal('arrange');
    });
  };
  const insertData = (kind:'table'|'chart') => {
    setEditing(null);
    direct.clear();
    const changes:SlideChanges={layout:kind==='table' ? 'native-table' : 'data-chart',...(!slide.freeLayout && {freeLayout:null})};
    if (kind==='table' && !slide.table) changes.table={headers:[`${insert.column} 1`,`${insert.column} 2`],rows:[['',''],['','']]};
    if (kind==='chart' && !slide.chart) changes.chart={categories:[`${insert.category} 1`,`${insert.category} 2`,`${insert.category} 3`],series:[{name:`${insert.series} 1`,values:[0,0,0]}],alt:insert.chart};
    if(dataNeedsSlide) {if(canCreateSlide)onCreateContent({changes});return;}
    save(changes);
    setInspectorTab('design');
    if (desktop) setInspectorOpen(true);
    requestAnimationFrame(()=>document.querySelector<HTMLElement>(`.ed-inspector [data-data-kind="${kind}"] input`)?.focus({preventScroll:true}));
  };
  const hasStoryFields = Boolean(
    slide.design && (slide.design.eyebrow || slide.design.cards?.length || slide.design.takeaway || slide.answer !== undefined),
  );
  const activeText = slot && (
    <ActiveSlot
      key={slot}
      slide={slide}
      slot={slot}
      c={c}
      onChange={(doc) => {
        const runs = documentRuns(doc);
        save({
          [slot]: runs.map((run) => run.text).join(''),
          richText: { ...slide.richText, [slot]: doc },
          ...(slot === 'body' ? { bodyRuns: runs } : {}),
        });
      }}
      onInstance={setTip}
      onEnd={endEditing}
    />
  );
  const formatTools = slot && tip && (
    <ToolRow
      editor={tip}
      c={c}
      onEnd={editing?.inSheet ? undefined : endEditing}
      assistant={!editing?.inSheet && <CanvasAssistantDropdown field={slot} openReview={openAssistant} trigger={
        <ToolbarButton render={<Button type="button" variant="ghost" size="icon-sm" className="ed-icon"
          aria-label={canvasCopy[uiLocale].selected} title={canvasCopy[uiLocale].selected}><ChatCircleTextIcon /></Button>} />
      } />}
      diagram={slot==='body' && onEditOp && deck.phase==='editing' && deck.slides.length<40 ? {
        label:diagramWords[uiLocale].make,
        selected:text=>{
          setDiagramDraft({diagram:{kind:'process',nodes:selectionNodes(text)},existing:false});
          setEditing(null);
          setModal('diagram');
        },
      } : undefined}
      onLink={() => {
        setUrl(tip.getAttributes('link').href || '');
        setLinkError(false);
        setModal('link');
      }}
    />
  );
  const linkDialog = modal === 'link' && tip && (
    <Modal title={c.link} c={c} close={() => setModal(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const href = safeHref(url.trim());
          if (!href) {
            setLinkError(true);
            return;
          }
          tip.chain().focus().extendMarkRange('link').setLink({ href }).run();
          setModal(null);
        }}
      >
        <label>
          {c.linkLabel}
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        {linkError && (
          <p className="ed-error" role="alert">
            {c.invalidLink}
          </p>
        )}
        <DialogFooter variant="bare" render={<footer />}>
          {tip.isActive('link') && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                tip.chain().focus().extendMarkRange('link').unsetLink().run();
                setModal(null);
              }}
            >
              {c.removeLink}
            </Button>
          )}
          <Button type="submit">
            {c.save}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
  const sourceDialog = excerpt && (
    <Modal
      title={c.excerpt}
      c={c}
      close={() => {
        setModal(null);
        setExcerpt(null);
      }}
    >
      <strong>{excerpt.url ? <a href={excerpt.url} target="_blank" rel="noopener noreferrer">{excerpt.source}</a> : excerpt.source || deck.source?.name || c.sourceDoc}</strong>
      <blockquote lang={deck.language}>{excerpt.excerpt}</blockquote>
      <small>
        {excerpt.id} · {excerpt.start}–{excerpt.end}
      </small>
    </Modal>
  );
  return (
    <>
      {view === 'slide' && <ResizablePanel id="slide-canvas" minSize="330px" className="ed-pane">
      <section className="ed-center" aria-label={c.canvas}>
        <div className="ed-canvas-tools">
          <div className="ed-author-commands">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="ed-insert-trigger" disabled={!canEdit} aria-label={insert.insert} />}>
                <PlusIcon aria-hidden/><span>{insert.insert}</span><CaretDownIcon className="ed-insert-caret" aria-hidden/>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="ed-insert-menu">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{insertSections[uiLocale].objects}</DropdownMenuLabel>
                  <SlideObjectMenuItems locale={uiLocale} disabled={!slideObjects.canInsert} onInsert={slideObjects.insert}/>
                </DropdownMenuGroup>
                <DropdownMenuSeparator/>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{insertSections[uiLocale].content}</DropdownMenuLabel>
                  <DropdownMenuItem disabled={mediaNeedsSlide && !canCreateSlide} title={mediaNeedsSlide && !canCreateSlide ? insert.limit : undefined} onClick={()=>openMedia('image')}><ImageIcon/>{insert.image}{mediaNeedsSlide && ' · '+insert.newSlide}</DropdownMenuItem>
                  <DropdownMenuItem disabled={dataNeedsSlide && !canCreateSlide} title={dataNeedsSlide && !canCreateSlide ? insert.limit : undefined} onClick={()=>insertData('table')}><TableIcon/>{insert.table}{dataNeedsSlide && ' · '+insert.newSlide}</DropdownMenuItem>
                  <DropdownMenuItem disabled={dataNeedsSlide && !canCreateSlide} title={dataNeedsSlide && !canCreateSlide ? insert.limit : undefined} onClick={()=>insertData('chart')}><ChartBarIcon/>{insert.chart}{dataNeedsSlide && ' · '+insert.newSlide}</DropdownMenuItem>
                  <DropdownMenuItem disabled={mediaNeedsSlide && !canCreateSlide} title={mediaNeedsSlide && !canCreateSlide ? insert.limit : undefined} onClick={()=>openMedia('formula')}><FunctionIcon/>{insert.formula}{mediaNeedsSlide && ' · '+insert.newSlide}</DropdownMenuItem>
                  <DropdownMenuItem disabled={mediaNeedsSlide && !canCreateSlide} title={mediaNeedsSlide && !canCreateSlide ? insert.limit : undefined} onClick={()=>openMedia('pictogram')}><ShapesIcon/>{insert.icon}{mediaNeedsSlide && ' · '+insert.newSlide}</DropdownMenuItem>
                  {onEditOp && deck.slides.length<40 && <DropdownMenuItem onClick={()=>{
                    setDiagramDraft({diagram:slide.diagram ?? {kind:'process',nodes:selectionNodes(slide.body)},existing:Boolean(slide.diagram)});
                    setModal('diagram');
                  }}><TreeStructureIcon/>{insert.diagram}</DropdownMenuItem>}
                </DropdownMenuGroup>
                <DropdownMenuSeparator/>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{insertSections[uiLocale].edit}</DropdownMenuLabel>
                  {(['title','body'] as const).map(field=><DropdownMenuItem key={field} onClick={()=>{
                    const entry=stage.current?.querySelector<HTMLElement>(`[data-slot-entry="${field}"]`);
                    startEditing(field,entry ?? stage.current!);
                  }}>{field==='title' ? <TextTIcon/> : <TextAlignJustifyIcon/>}{field==='title' ? c.editTitle : c.editBody}</DropdownMenuItem>)}
                  <DropdownMenuItem onClick={openArrangement}><LayoutIcon/>{freeWords[uiLocale].name}</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Toolbar className="ed-actions" aria-label={c.canvas}>
              {(['title', 'body'] as const).map((field) => {
                const label = field === 'title' ? c.editTitle : c.editBody;
                return <ToolbarButton key={field} disabled={!canEdit} render={
                  <Button variant="ghost" size="sm" className="ed-author-tool" data-editor-tool={field} title={label}
                    aria-label={field==='title' ? workspaceWords[uiLocale].titleTool : workspaceWords[uiLocale].textTool} aria-description={label}
                    aria-pressed={slot === field} onClick={(event) => {
                      if (slot === field && tip) { tip.commands.focus(); return; }
                      startEditing(field, event.currentTarget);
                    }}>
                    {field === 'title' ? <TextTIcon aria-hidden /> : <TextAlignJustifyIcon aria-hidden />}
                    <span>{field === 'title' ? workspaceWords[uiLocale].titleTool : workspaceWords[uiLocale].textTool}</span>
                  </Button>
                } />;
              })}
              <ToolbarSeparator className="ed-toolbar-rule" />
              {onUndo && (
                <IconButton toolbar label={c.undo} onClick={() => { direct.clear(); onUndo(); }} disabled={!canUndo}>
                  <ArrowCounterClockwiseIcon />
                </IconButton>
              )}
              {onRedo && <IconButton toolbar label={c.redo} onClick={() => { direct.clear(); onRedo(); }} disabled={!canRedo}><ArrowClockwiseIcon/></IconButton>}
            </Toolbar>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="ed-layer-tool" />} disabled={!directEnabled}
                aria-label={placement.layers} title={placement.layers}>
                <StackIcon aria-hidden/><span>{placement.layers}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>{[...layerLayout.items].reverse().map(({id}) => <DropdownMenuCheckboxItem key={id}
                  checked={direct.selection.includes(id)} closeOnClick={false} onCheckedChange={checked => {
                    const current = direct.read();
                    const together = selectedGroup(current, [id]);
                    direct.select(checked ? [...new Set([...direct.selection, ...together])] : direct.selection.filter(item => !together.includes(item)), current);
                  }}>{layerName(id)}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup>
                <DropdownMenuSeparator/>
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={direct.selection.length < 2}
                    onClick={() => direct.commit(groupFree(direct.read(), direct.selection, crypto.randomUUID()))}>{freeWords[uiLocale].group}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!layerLayout.items.some(item => direct.selection.includes(item.id) && item.group)}
                    onClick={() => direct.commit(groupFree(direct.read(), direct.selection))}>{freeWords[uiLocale].ungroup}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!direct.selection.length}
                    onClick={() => direct.commit(stackFree(direct.read(), direct.selection, true))}>{freeWords[uiLocale].front}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!direct.selection.length}
                    onClick={() => direct.commit(stackFree(direct.read(), direct.selection, false))}>{freeWords[uiLocale].back}</DropdownMenuItem>
                </DropdownMenuGroup>
                {slide.freeLayout && <><DropdownMenuSeparator/><DropdownMenuItem onClick={() => {
                  direct.clear();
                  save({freeLayout:null});
                }}>{freeWords[uiLocale].adaptive}</DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ed-author-actions">
              <CanvasAssistantDropdown openReview={openAssistant} trigger={<Button variant="ghost" size="icon-sm" className="ed-icon ed-ai-tool" aria-label={canvasCopy[uiLocale].label} title={canvasCopy[uiLocale].label} disabled={!canEdit}><ChatCircleTextIcon/></Button>}/>
              {onEditOp && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={
                    <Button className="ed-slide-actions" variant="ghost" size="sm"
                      title={workspaceWords[uiLocale].slideActions} aria-label={workspaceWords[uiLocale].slideActions} />
                  }>
                    <DotsThreeIcon weight="bold" aria-hidden /><span>{workspaceWords[uiLocale].actions}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6} className="ed-slide-actions-menu">
                    <DropdownMenuGroup>
                      <DropdownMenuItem disabled={!canEdit} onClick={openAssistant}>
                        <ChatCircleTextIcon aria-hidden />{canvasCopy[uiLocale].label}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!canEdit} onClick={() => onEditOp({ kind: 'duplicate', slideId: slide.id })}>
                        <CopyIcon aria-hidden />{c.duplicate}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator/>
                    <DropdownMenuItem variant="destructive" disabled={deck.slides.length < 2} onClick={() => setModal('remove')}>
                      <TrashIcon aria-hidden />{c.remove}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {desktop && !focused && (
            <Button variant="ghost" size="sm" className="ed-inspector-toggle" data-editor-motion="inspector"
              aria-label={c.inspector} title={c.inspector} aria-expanded={inspectorOpen} aria-controls={inspectorOpen ? 'slide-inspector' : undefined}
              onClick={() => setInspectorOpen(!inspectorOpen)}>
              <SidebarSimpleIcon mirrored aria-hidden /><span>{c.inspector}</span>
            </Button>
          )}
        </div>
        {!editing?.inSheet && formatTools}
        {reviewing && proposal && <div className="ed-proposal-preview" role="group" aria-label={words.preview}>
          <span>{words.preview}</span>
          <button type="button" aria-pressed={!proposed} onClick={() => setOriginalProposal(proposal.id)}>{words.before}</button>
          <button type="button" aria-pressed={Boolean(proposed)} onClick={() => setOriginalProposal(undefined)}>{words.after}</button>
        </div>}
        <div className="ed-stage" ref={viewport} data-preview={proposed ? 'proposed' : 'original'} tabIndex={-1} role="group" aria-label={c.canvas} aria-description={canvasTools.mouse} data-zoomed={zoom !== 'fit'}>
          <div className="ed-stage-wrap" ref={stage} tabIndex={-1}
            data-direct-placement={directEnabled || undefined} {...direct.events}
            style={zoom === 'fit' ? undefined : { width: canvasWidthAt100Percent * Number(zoom) / 100 }}>
            <SlideCanvas
              slide={direct.preview ? {...slide, freeLayout:direct.preview} : proposed?.slide ?? slideObjects.previewSlide}
              deck={proposed ? {...deck, theme: proposed.theme} : deck}
              lang={uiLocale}
              includeChartData
              onOverflowChange={detectOverflow}
              renderObject={desktop && !reviewing ? slideObjects.renderObject : undefined}
              renderSlot={
                canEdit && desktop && !reviewing
                  ? (key, children) =>
                      slot === key && !editing?.inSheet ? activeText : (
                        <CanvasAssistantMenu field={key} openReview={openAssistant} trigger={<div
                          className="ed-slot"
                          data-slot-entry={key}
                          data-sheet-editing={editing?.inSheet && slot === key ? true : undefined}
                          tabIndex={0}
                          role="button"
                          aria-label={`${key === 'title' ? c.editTitle : c.editBody} · ${slide[key]}`}
                          onClick={(e) => {
                            e.preventDefault();
                            if (e.shiftKey && directEnabled) return;
                            startEditing(key, e.currentTarget);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              startEditing(key, e.currentTarget);
                            }
                          }}
                        >
                          {children}
                        </div>}/>
                      )
                  : undefined
              }
            />
            {direct.layout && direct.selection.length > 0 && <FreeLayoutOverlay layout={direct.layout} locale={uiLocale}
              selection={direct.selection} hitTargets={false} moveGuides={direct.guides}
              onSelectionChange={direct.select} onChange={direct.setPreview} onCommit={direct.commit}
              onCancel={() => direct.setPreview(undefined)}/>}
          </div>
        </div>
        {!desktop && canEdit && <p className="ed-canvas-note">{words.computer}</p>}
        {overflow && canEdit && !reviewing && <div className="ed-overflow-notice">
          <p role="status"><WarningCircleIcon aria-hidden />{words.overflow}</p>
          <ShortenOverflowButton field={overflow} openReview={openAssistant} />
        </div>}
        {gallery}
        <div className="ed-stage-foot" role="group" aria-label={canvasTools.toolbar}>
          <div className="ed-stage-controls">
            <div className="ed-slide-position" data-editor-motion="slide" role="group" aria-label={canvasTools.navigation}>
              <IconButton label={c.previous} disabled={index === 0} onClick={() => offset(-1)}><CaretLeftIcon aria-hidden /></IconButton>
              <SlidePositionPicker slides={deck.slides} index={index} locale={uiLocale} onChange={position => onSelectSlide(deck.slides[position].id)}/>
              <IconButton label={c.next} disabled={index === deck.slides.length - 1} onClick={() => offset(1)}><CaretRightIcon aria-hidden /></IconButton>
            </div>
            {canEdit && <div className="ed-slide-tools">
              <Button size="sm" variant="ghost" className="ed-layout-toggle ed-layout-footer-trigger" title={galleryWords.title}
                aria-label={galleryWords.title} aria-expanded={galleryOpen} aria-controls={galleryOpen ? 'editor-layout-gallery' : undefined}
                onClick={(event) => toggleGallery(event.currentTarget)}>
                <LayoutIcon aria-hidden /><span>{galleryWords.title}</span>
              </Button>
              <SlideQuality deck={deck} slide={slide} locale={uiLocale}/>
            </div>}
          </div>
          <div className="ed-stage-display">
            <div className="ed-stage-zoom">
              <Button className="ed-zoom-step" size="icon-sm" variant="ghost" aria-label={canvasTools.zoomOut} title={canvasTools.zoomOut}
                disabled={zoom === canvasZoomLevels[0]} onClick={() => stepZoom(-1)}><MinusIcon aria-hidden/></Button>
              <Select items={zoomOptions} value={zoom} onValueChange={(value) => { if (value) changeZoom(value); }}>
                <SelectTrigger className="ed-zoom" size="sm" aria-label={workspaceWords[uiLocale].zoom} title={canvasTools.mouse}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup className="ed-canvas-zoom-popup" align="end" side="top" sideOffset={8} alignItemWithTrigger={false}>
                  {zoomOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}
                      onClick={option.value === 'fit' && zoom === 'fit' ? resetPan : undefined}>{option.label}</SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button className="ed-zoom-step" size="icon-sm" variant="ghost" aria-label={canvasTools.zoomIn} title={canvasTools.zoomIn}
                disabled={zoom === canvasZoomLevels.at(-1)} onClick={() => stepZoom(1)}><PlusIcon aria-hidden/></Button>
            </div>
            <span className="ed-ratio"><MonitorIcon aria-hidden />16:9</span>
            <Button className="ed-canvas-focus" size="sm" variant="ghost"
              aria-label={focused ? c.exitFocus : c.enterFocus} title={focused ? c.exitFocus : c.enterFocus}
              aria-pressed={focused} onClick={onToggleFocus}>
              {focused ? <ArrowsInSimpleIcon aria-hidden/> : <ArrowsOutSimpleIcon aria-hidden/>}<span>{canvasTools.focus}</span>
            </Button>
          </div>
          {slide.status !== 'ready' && (
            <div className="ed-stage-notice">
              <span className="ed-status" data-status={slide.status}>
                {slide.status === 'failed' ? <WarningCircleIcon aria-hidden/> : <ClockIcon aria-hidden/>}
                {slide.moderationNotice || statusText(slide, c)}
              </span>
              {onRetry && (slide.status === 'failed' || slide.status === 'cancelled') &&
                <Button className="ed-pill" variant="outline" size="sm" onClick={() => onRetry(slide.id)}>
                  <ArrowCounterClockwiseIcon aria-hidden/>{c.retry}
                </Button>}
            </div>
          )}
        </div>
      </section>
      </ResizablePanel>}
      {(!desktop || inspectorOpen) && <>
      <ResizableHandle className="ed-separator" withHandle aria-label={workspaceWords[uiLocale].inspector} />
      <ResizablePanel id="slide-inspector" className="ed-pane" defaultSize={window.matchMedia('(min-width:961px) and (max-width:1150px)').matches ? '270px' : '324px'} minSize="264px" maxSize="470px" groupResizeBehavior="preserve-pixel-size">
      <aside className="ed-inspector studio-inspector" aria-label={c.inspector}>
        <Tabs className="inspect-root" value={inspectorTab}
          onValueChange={(value) => setInspectorTab(value as InspectorTab)}>
          <TabsList className="inspect-tabs" data-editor-motion="inspector" variant="line" aria-label={c.inspector} activateOnFocus>
            <TabsTrigger value="assistant"><ChatCircleTextIcon /><span>{c.assistant}</span></TabsTrigger>
            <TabsTrigger value="design"><SlidersHorizontalIcon /><span>{labels.design}</span></TabsTrigger>
            <TabsTrigger value="notes" aria-label={lectureTitle(uiLocale)} title={lectureTitle(uiLocale)}><NotePencilIcon /><span>{labels.notes}</span></TabsTrigger>
          </TabsList>
          <TabsContent value="design" className="inspect-surface inspect-design">
            <section className="inspect-scope" aria-labelledby="inspect-slide-heading">
              <header className="inspect-heading">
                <p className="inspect-slide-meta"><RectangleIcon aria-hidden/>{c.slide} {index + 1} / {deck.slides.length}</p>
                <h2 id="inspect-slide-heading" lang={slide.title ? deck.language : uiLocale}>{slide.title || c.slide}</h2>
              </header>

              <section className="inspect-section">
                <Select
                  value={slide.layout}
                  disabled={!canEdit}
                  items={choices.all.map((value) => ({ value, label: layoutLabel(value) }))}
                  onValueChange={(value) => { if (value) applyLayout(value); }}
                >
                  <SelectLabel className="inspect-label">{c.layout}</SelectLabel>
                  <SelectTrigger id="ed-layout" className="inspect-layout-trigger">
                    <LayoutIcon aria-hidden /><SelectValue />
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {choices.all.map((layout) => <SelectItem key={layout} value={layout}>{layoutLabel(layout)}</SelectItem>)}
                  </SelectPopup>
                </Select>
                {deck.powerPointStyle && <PowerPointLayoutPicker style={deck.powerPointStyle} slide={slide}
                  locale={uiLocale} disabled={!canEdit} onChange={save}/>}
                {canEdit && <Button className="ed-layout-toggle ed-layout-inspector-trigger" size="sm" variant="ghost"
                  aria-expanded={galleryOpen} aria-controls={galleryOpen ? 'editor-layout-gallery' : undefined}
                  onClick={(event) => toggleGallery(event.currentTarget)}>
                  <SquaresFourIcon aria-hidden />{galleryWords.title}<CaretDownIcon aria-hidden />
                </Button>}
                {view === 'overview' && gallery}
              </section>
              <SlideDataEditor slide={slide} locale={uiLocale} disabled={!canEdit} onChange={save}/>
              <section className="inspect-section inspect-elements" aria-label={labels.elements}>
                  <h3 className="inspect-label">{labels.elements}</h3>
                  {view === 'slide' && slideObjects.objects.map(object => <InspectorAction key={object.id}
                    icon={object.kind === 'text' ? <TextTIcon/> : <RectangleIcon/>} disabled={!canEdit || reviewing} onClick={() => slideObjects.open(object)}>
                    {slideObjects.label(object)}
                  </InspectorAction>)}
                  <InspectorAction icon={<LayoutIcon/>} disabled={!canEdit} onClick={openArrangement}>{freeWords[uiLocale].name}</InspectorAction>
                  {slide.diagram && <InspectorAction icon={<TreeStructureIcon/>} disabled={!canEdit} onClick={()=>{
                    if(slide.diagram) {setDiagramDraft({diagram:slide.diagram,existing:true});setModal('diagram');}
                  }}>{diagramWords[uiLocale].edit}</InspectorAction>}
                  {hasStoryFields && <InspectorAction icon={<NotePencilIcon />} disabled={!canEdit} onClick={() => setModal('story')}>
                    {storyFields[uiLocale].edit}
                  </InspectorAction>}
                  {!slide.importedPage && !slide.diagram && <InspectorAction icon={<ImageIcon />} disabled={!canEdit} onClick={()=>{setMediaKind(undefined);setImageIndex(0);setModal('edit-image');}}>{slide.image ? imageWords[uiLocale].edit : imageWords[uiLocale].add}</InspectorAction>}
                  {slide.image && !slide.importedPage && !slide.diagram &&
                    [1,2].filter(i=>i<=(slide.additionalImages?.length ?? 0)+1).map(i=><InspectorAction key={i}
                      icon={<ImageIcon />} disabled={!canEdit} onClick={()=>{setMediaKind(undefined);setImageIndex(i);setModal('edit-image');}}>
                      {(slide.additionalImages?.[i-1] ? imageGridWords[uiLocale].edit : imageGridWords[uiLocale].add)+' '+(i+1)}
                    </InspectorAction>)}
                  {slide.image && <InspectorAction icon={<ImageIcon />} disabled={!canEdit} onClick={() => setModal('image')}>
                    {c.editAlt}
                  </InspectorAction>}
              </section>
              {Boolean(slide.evidence?.length) && <section className="inspect-section">
                <h3 className="inspect-label">{c.source}</h3>
                {slide.evidence!.map((e) => <InspectorAction key={e.id} icon={<FileTextIcon />} title={e.excerpt}
                  onClick={() => { setExcerpt(e); setModal('source'); }}>
                  <span className="ed-source-title">{e.source || deck.source?.name || c.sourceDoc}</span>
                </InspectorAction>)}
              </section>}
            </section>
            {onEditOp && <section className="inspect-scope inspect-theme" aria-labelledby="inspect-deck-heading">
              <h2 id="inspect-deck-heading">{labels.deck}</h2>
              <ThemePicker deck={deck} locale={uiLocale} value={deck.theme} triggerRef={themeTrigger}
                onChange={(theme) => onEditOp({ kind: 'deck', theme })} />
              <ImageStylePicker deck={deck} locale={uiLocale} disabled={!canEdit} onChange={imageStyle=>onEditOp({kind:'deck',imageStyle})}/>
            </section>}
          </TabsContent>
          <TabsContent value="notes" className="inspect-surface inspect-notes">
            <header className="inspect-heading">
              <h2>{lectureTitle(uiLocale)}</h2>
              <span lang={deck.language}>{slide.title}</span>
            </header>
            <Textarea aria-label={c.notes} className="inspect-note-control" value={slide.notes} disabled={!canEdit}
              onChange={(e) => save({ notes: e.target.value })} placeholder={c.notesHint} lang={deck.language}/>
            <LectureNotes deckId={deck.id} slide={slide} locale={uiLocale} language={deck.language}
              speechRate={deck.speechProfile?.language===deck.language ? deck.speechProfile.wordsPerMinute : undefined}
              canEdit={canEdit} openReview={()=>setInspectorTab('assistant')}/>
            {slide.sourceReview && <SourceReview report={slide.sourceReview} locale={uiLocale}/>}
            <div className="inspect-notes-footer">
              <p className="inspect-notes-hint"><MonitorIcon aria-hidden />{labels.notesHint}</p>
              <span className="inspect-word-count">{labels.words}: {slide.notes.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length ?? 0}</span>
            </div>
          </TabsContent>
          <TabsContent value="assistant" className="inspect-surface inspect-chat">
            <AssistantPanel />
          </TabsContent>
        </Tabs>
      </aside>
      </ResizablePanel>
      </>}
      {editing?.inSheet && (
        <TextSheet title={slot === 'title' ? c.title : c.body} done={c.done} entry={editEntry} onEnd={endEditing}>
          {formatTools}
          <div className="ed-sheet-input" lang={deck.language}>{activeText}</div>
          {linkDialog}
        </TextSheet>
      )}
      {slideObjects.dialog}
      {modal==='arrange' && arrangement && <FreeLayoutEditor initial={arrangement} deck={deck} slide={slide} locale={uiLocale}
        onSave={freeLayout=>{save({freeLayout});setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal==='diagram' && diagramDraft && <DiagramEditor initial={diagramDraft.diagram} editing={diagramDraft.existing} locale={uiLocale} language={deck.language}
        onClose={()=>setModal(null)} onSave={diagram=>{
          if(diagramDraft.existing) save({diagram});
          else if(onEditOp) {
            const newSlideId=crypto.randomUUID();
            pendingDiagram.current=newSlideId;
            onEditOp({kind:'add',afterId:slide.id,newSlideId,diagram});
          }
          setModal(null);
        }}/>}
      {modal === 'edit-image' && <LessonImageEditor key={slide.id+':'+imageIndex+':'+(mediaKind??'auto')} deck={deck} slide={slide} locale={uiLocale} index={imageIndex} initialKind={mediaKind} save={save} close={()=>setModal(null)}/>}
      {modal === 'source' && sourceDialog}
      {modal === 'story' && slide.design && <StoryEdit design={slide.design} slide={slide} locale={uiLocale} onSave={save} close={()=>setModal(null)} />}
      {modal === 'image' && (
        <ImageAltDialog slide={slide} c={c} onSave={save} close={() => setModal(null)} />
      )}
      {modal === 'remove' && (
        <Modal title={c.remove} c={c} close={() => setModal(null)}>
          <p>{slide.title}</p>
          <DialogFooter variant="bare" render={<footer />}>
            <Button variant="outline" onClick={() => setModal(null)}>
              {c.cancelEdit}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setModal(null);
                onEditOp?.({ kind: 'remove', slideId: slide.id });
              }}
            >
              {c.remove}
            </Button>
          </DialogFooter>
        </Modal>
      )}
      {!editing?.inSheet && linkDialog}
    </>
  );
}
