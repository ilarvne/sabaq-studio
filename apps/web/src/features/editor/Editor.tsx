import { LectureNotes, lectureTitle } from './LectureNotes';
import { SourceReview } from './SourceReview';
import { SlideGroups, groupWords } from './SlideGroups';
import { FreeLayoutEditor, freeWords } from './FreeLayoutEditor';
import { captureLayout } from './capture-layout';
import { DiagramEditor, diagramWords } from './DiagramEditor';
import { selectionNodes, type SlideDiagram } from '@sabaq/lesson/diagram';
import { SlideQuality } from './SlideQuality';
import { LessonImageEditor, imageGridWords, imageWords } from './LessonImageEditor';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/shadcn/tabs';
import { Button } from '@/components/shadcn/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from '@/components/shadcn/dropdown-menu';
import { Textarea } from '@/components/coss/textarea';
import { Input } from '@/components/coss/input';
import { Dialog, DialogPopup, DialogHeader, DialogPanel, DialogTitle, DialogFooter } from '@/components/coss/dialog';
import { Sheet, SheetClose, SheetHeader, SheetPopup, SheetTitle } from '@/components/coss/sheet';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem, SelectLabel } from '@/components/coss/select';
import type { Editor as TipEditor, JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Toolbar, ToolbarButton, ToolbarSeparator } from '@/components/coss/toolbar';
import {
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  ChartBarIcon,
  FunctionIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  FileTextIcon,
  DotsThreeIcon,
  TreeStructureIcon,
  TextTIcon,
  TextAlignJustifyIcon,
  ImageIcon,
  LayoutIcon,
  LinkIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  NotePencilIcon,
  PlusIcon,
  PencilSimpleIcon,
  RectangleIcon,
  SquaresFourIcon,
  ShapesIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  ChatCircleTextIcon,
  TableIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBIcon,
  TextItalicIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type {
  Deck,
  EditOp,
  Layout,
  Locale,
  Slide,
  SlideChanges,
  SlideDesign,
  SourceExcerpt,
} from '@sabaq/lesson/types';
import { editorCopy } from './editorCopy';
import { SlideNavigator, slideOrderMessage } from './SlideNavigator';
import { SlidePositionPicker } from './SlidePositionPicker';
import { ThemePicker } from './ThemePicker';
import { ImageStylePicker } from './ImageStylePicker';
import { SlideDataEditor } from './SlideDataEditor';
import { PowerPointLayoutPicker } from './PowerPointLayoutPicker';
import { alternateLayouts, documentRuns, safeHref, SlideCanvas, slotDocument, type TextSlot } from '@sabaq/slide-renderer/canvas';
import './editor.css';
import './workspace-controls.css';
import { AssistantSession, AssistantPanel, CanvasAssistantMenu, CanvasAssistantDropdown, useCanvasProposal, canvasCopy } from '@/features/assistant/Assistant';

type Copy = (typeof editorCopy)[Locale];
type DialogKind = 'edit-image' | 'table' | 'chart' | 'image' | 'source' | 'link' | 'remove' | 'story' | 'diagram' | 'arrange';
export type EditorView = 'slide' | 'overview';
export interface EditorProps {
  view?: EditorView;
  onViewChange?: (view: EditorView) => void;
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

const layoutNames: Record<Locale, Record<Layout, string>> = {
  en: {
    stacked: 'Stacked', split: 'Two columns', centered: 'Centered',
    cover: 'Cover',
    body: 'Text',
    quote: 'Quotation',
    'image-left': 'Image on left',
    'image-right': 'Image on right',
    'image-full': 'Full image',
    'image-grid': 'Image grid',
    'image-section': 'Image section divider',
    'native-table': 'Table',
    'data-chart': 'Chart',
    'avatar-right': 'Avatar on right',
  },
  ru: {
    stacked: 'По вертикали', split: 'Две колонки', centered: 'По центру',
    cover: 'Обложка',
    body: 'Текст',
    quote: 'Цитата',
    'image-left': 'Изображение слева',
    'image-right': 'Изображение справа',
    'image-full': 'Фоновое изображение',
    'image-grid': 'Сетка изображений',
    'image-section': 'Раздел с изображением',
    'native-table': 'Таблица',
    'data-chart': 'Диаграмма',
    'avatar-right': 'Аватар справа',
  },
  kk: {
    stacked: 'Тігінен', split: 'Екі баған', centered: 'Ортасына',
    cover: 'Мұқаба',
    body: 'Мәтін',
    quote: 'Дәйексөз',
    'image-left': 'Сурет сол жақта',
    'image-right': 'Сурет оң жақта',
    'image-full': 'Фондық сурет',
    'image-grid': 'Суреттер торы',
    'image-section': 'Суретті бөлім',
    'native-table': 'Кесте',
    'data-chart': 'Диаграмма',
    'avatar-right': 'Аватар оң жақта',
  },
};
function statusText(slide: Slide, c: Copy) {
  return c[slide.status === 'cancelled' ? 'canceled' : slide.status];
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  pressed,
  toolbar = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  toolbar?: boolean;
}) {
  const button = (
    <Button
      className="ed-icon"
      size="icon-sm"
      variant="ghost"
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
  return toolbar ? <ToolbarButton disabled={disabled} render={button} /> : button;
}

function Modal({
  title,
  children,
  close,
  c,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  c: Copy;
}) {
  return (
    <Dialog defaultOpen onOpenChange={(open) => { if (!open) close(); }}>
      <DialogPopup className="inspector-dialog" closeProps={{ 'aria-label': c.close, title: c.close }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogPanel>{children}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ActiveSlot({
  slide,
  slot,
  c,
  onChange,
  onInstance,
  onEnd,
}: {
  slide: Slide;
  slot: TextSlot;
  c: Copy;
  onChange: (doc: JSONContent) => void;
  onInstance: (editor: TipEditor | null) => void;
  onEnd: () => void;
}) {
  const change = useRef(onChange);
  const dismiss = useRef(onEnd);
  useLayoutEffect(() => {
    change.current = onChange;
    dismiss.current = onEnd;
  });
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false, autolink: false },
          heading: false,
          codeBlock: false,
          code: false,
          blockquote: false,
          horizontalRule: false,
          strike: false,
          underline: false,
        }),
        TextAlign.configure({ types: ['paragraph'] }),
      ],
      content: slotDocument(slide, slot),
      autofocus: 'end',
      editorProps: {
        attributes: {
          'aria-label': slot === 'title' ? c.title : c.body,
          'aria-multiline': 'true',
          class: 'ed-live-text',
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss.current();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: instance }) => change.current(instance.getJSON()),
    },
    [slide.id, slot],
  );
  useEffect(() => {
    onInstance(editor);
    return () => onInstance(null);
  }, [editor, onInstance]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.view.composing) return;
    const content = slotDocument(slide, slot);
    if (JSON.stringify(content) !== JSON.stringify(editor.getJSON()))
      editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, slide.richText, slide[slot], slot]);
  return (
    <div className="ed-slot" data-editing={slot}>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolRow({
  editor,
  c,
  onEnd,
  onLink,
  diagram,
}: {
  diagram?: {label:string; selected:(text:string)=>void};
  editor: TipEditor;
  c: Copy;
  onEnd?: () => void;
  onLink: () => void;
}) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);
  return (
    <Toolbar
      className="ed-edit-tools"
      aria-label={c.editContent}
      onMouseDown={(e) => e.preventDefault()}
    >
      <IconButton
        toolbar
        label={c.bold}
        pressed={editor.isActive('bold')}
        onClick={() => {
          editor.chain().focus().toggleBold().run();
        }}
      >
        <TextBIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.italic}
        pressed={editor.isActive('italic')}
        onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <TextItalicIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.list}
        pressed={editor.isActive('bulletList')}
        onClick={() => {
          editor.chain().focus().toggleBulletList().run();
        }}
      >
        <ListBulletsIcon />
      </IconButton>
      <IconButton toolbar label={c.link} pressed={editor.isActive('link')} onClick={onLink}>
        <LinkIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.left}
        pressed={editor.isActive({ textAlign: 'left' }) || editor.isActive({ textAlign: null })}
        onClick={() => {
          editor.chain().focus().setTextAlign('left').run();
        }}
      >
        <TextAlignLeftIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.center}
        pressed={editor.isActive({ textAlign: 'center' })}
        onClick={() => {
          editor.chain().focus().setTextAlign('center').run();
        }}
      >
        <TextAlignCenterIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.right}
        pressed={editor.isActive({ textAlign: 'right' })}
        onClick={() => {
          editor.chain().focus().setTextAlign('right').run();
        }}
      >
        <TextAlignRightIcon />
      </IconButton>
      {diagram && <IconButton toolbar label={diagram.label} disabled={editor.state.selection.empty}
        onClick={()=>{
          const {from,to}=editor.state.selection;
          diagram.selected(editor.state.doc.textBetween(from,to,'\n','\n'));
        }}><TreeStructureIcon/></IconButton>}
      {onEnd && <IconButton toolbar label={c.done} onClick={onEnd}><CheckIcon /></IconButton>}
    </Toolbar>
  );
}

function TextSheet({ title, done, entry, onEnd, children }: {
  title: string;
  done: string;
  entry: RefObject<HTMLElement | null>;
  onEnd: () => void;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = viewport.scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      popup.current?.style.setProperty('--text-keyboard-inset', `${inset}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <Sheet defaultOpen onOpenChange={(open) => { if (!open) onEnd(); }}>
      <SheetPopup ref={popup} className="ed-text-sheet" side="bottom" showCloseButton={false}
        initialFocus={() => popup.current?.querySelector<HTMLElement>('[contenteditable="true"]') ?? false}
        finalFocus={entry}>
        <SheetHeader className="ed-text-sheet-heading">
          <SheetTitle>{title}</SheetTitle>
          <SheetClose render={<Button size="sm" />}>{done}</SheetClose>
        </SheetHeader>
        {children}
      </SheetPopup>
    </Sheet>
  );
}

const storyFields = {
  en:{edit:'Edit slide elements', label:'Section label', card:'Card', text:'Text', answer:'Reveal answer', takeaway:'Takeaway'},
  kk:{edit:'Слайд элементтерін өңдеу',label:'Бөлім атауы',card:'Карточка',text:'Мәтін',answer:'Көрсетілетін жауап',takeaway:'Қорытынды ой'},
  ru:{edit:'Редактировать элементы слайда',label:'Название раздела',card:'Карточка',text:'Текст',answer:'Ответ для показа',takeaway:'Главная мысль'},
};

function StoryEdit({slide,design,locale,onSave,close}: {
  slide:Slide; design:SlideDesign; locale:Locale; onSave:(changes:SlideChanges)=>void; close:()=>void;
}) {
  const copy = storyFields[locale];
  const c = editorCopy[locale];
  const [draft,setDraft] = useState(design);
  const [answer,setAnswer] = useState(slide.answer ?? '');
  const updateCard = (index:number,key:'title'|'text',value:string) => setDraft(current=>({
    ...current,
    cards:current.cards?.map((card,i)=>i===index ? {...card,[key]:value} : card),
  }));
  return <Modal title={copy.edit} c={c} close={close}>
    <form className="story-fields" onSubmit={event=>{
      event.preventDefault();
      const next = {...draft,eyebrow:draft.eyebrow?.trim(),takeaway:draft.takeaway?.trim()};
      onSave({design:next,...(slide.answer!==undefined ? {answer:answer.trim()} : {})});
      close();
    }}>
      {draft.eyebrow!==undefined && <label>{copy.label}
        <Input maxLength={60} value={draft.eyebrow} onChange={event=>setDraft({...draft,eyebrow:event.target.value})}/>
      </label>}
      {draft.cards?.map((card,index)=><fieldset key={index}>
        <legend>{copy.card} {index+1}</legend>
        <label>{c.title}<Input required maxLength={45} value={card.title} onChange={event=>updateCard(index,'title',event.target.value)}/></label>
        <label>{copy.text}<Textarea required rows={2} maxLength={140} value={card.text} onChange={event=>updateCard(index,'text',event.target.value)}/></label>
      </fieldset>)}
      {draft.takeaway!==undefined && <label>{copy.takeaway}
        <Textarea rows={2} maxLength={180} value={draft.takeaway} onChange={event=>setDraft({...draft,takeaway:event.target.value})}/>
      </label>}
      {slide.answer!==undefined && <label>{copy.answer}
        <Textarea rows={2} maxLength={160} value={answer} onChange={event=>setAnswer(event.target.value)}/>
      </label>}
      <DialogFooter variant="bare" render={<footer />}>
        <Button type="button" variant="outline" onClick={close}>{c.cancelEdit}</Button>
        <Button type="submit">{c.save}</Button>
      </DialogFooter>
    </form>
  </Modal>;
}

function DataEdit({
  slide,
  kind,
  c,
  onSave,
  close,
}: {
  slide: Slide;
  kind: 'table' | 'chart' | 'image';
  c: Copy;
  onSave: (changes: SlideChanges) => void;
  close: () => void;
}) {
  const [table, setTable] = useState(() =>
    slide.table ? [slide.table.headers, ...slide.table.rows].map((r) => r.map(String)) : [],
  );
  const [chart, setChart] = useState(() =>
    slide.chart
      ? [
          [c.chartLabel, ...slide.chart.series.map((s) => s.name)],
          ...slide.chart.categories.map((x, i) => [
            x,
            ...slide.chart!.series.map((s) => String(s.values[i] ?? 0)),
          ]),
        ]
      : [],
  );
  const [alt, setAlt] = useState(() =>
    kind === 'chart' ? (slide.chart?.alt ?? '') : (slide.image?.alt ?? ''),
  );
  const [error, setError] = useState('');
  const grid = kind === 'chart' ? chart : table;
  function save() {
    if (kind === 'image' && slide.image) onSave({ image: { ...slide.image, alt } });
    if (kind === 'table' && slide.table)
      onSave({
        table: {
          headers: table[0],
          rows: table
            .slice(1)
            .map((row, i) =>
              row.map((value, j) =>
                typeof slide.table!.rows[i][j] === 'number' &&
                value.trim() &&
                Number.isFinite(Number(value))
                  ? Number(value)
                  : value,
              ),
            ),
        },
      });
    if (kind === 'chart' && slide.chart) {
      const rows = chart.slice(1);
      if (rows.some((r) => r.slice(1).some((v) => !v.trim() || !Number.isFinite(Number(v))))) {
        setError(c.invalidValue);
        return;
      }
      onSave({
        chart: {
          categories: rows.map((r) => r[0]),
          series: chart[0]
            .slice(1)
            .map((name, i) => ({ name, values: rows.map((r) => Number(r[i + 1])) })),
          alt,
        },
      });
    }
    close();
  }
  return (
    <Modal
      title={kind === 'image' ? c.editAlt : `${c.editData} · ${kind === 'chart' ? c.chart : c.table}`}
      close={close}
      c={c}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {kind !== 'image' && grid.length > 0 && (
          <div
            className="ed-data-grid"
            style={{ gridTemplateColumns: `repeat(${grid[0].length}, minmax(68px,1fr))` }}
          >
            {grid.map((row, i) =>
              row.map((v, j) => (
                <Input
                  key={`${i}-${j}`}
                  aria-label={`${c.row} ${i + 1}, ${c.column} ${j + 1}`}
                  value={v}
                  readOnly={kind === 'chart' && i === 0 && j === 0}
                  onChange={(e) => {
                    const value = e.target.value;
                    const update = kind === 'chart' ? setChart : setTable;
                    update((prev) =>
                      prev.map((r, ri) =>
                        ri === i ? r.map((cell, ci) => (ci === j ? value : cell)) : r,
                      ),
                    );
                  }}
                />
              )),
            )}
          </div>
        )}
        {kind !== 'table' && (
          <label>
            {kind === 'chart' ? c.chart : c.alt}
            <Textarea
              value={alt}
              rows={3}
              onChange={(e) => setAlt(e.target.value)}
              placeholder={c.noAlt}
            />
          </label>
        )}
        {error && (
          <p className="ed-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter variant="bare" render={<footer />}>
          <Button variant="outline" type="button" onClick={close}>
            {c.cancelEdit}
          </Button>
          <Button type="submit">
            {c.save}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

type InspectorTab = 'design' | 'notes' | 'assistant';
type InsertMediaKind = 'image'|'formula'|'pictogram';
type NewSlideContent = {changes:SlideChanges} | {media:InsertMediaKind};
const canvasZoomLevels = ['50', '75', '100', '125', '150'] as const;
type CanvasZoom = 'fit' | (typeof canvasZoomLevels)[number];
const canvasWidthAt100Percent = 1280;
const workspaceWords = {
  en: { overview: 'Overview', grid: 'Grid', editSlide: 'Edit slide', mode: 'Editor view', actions: 'Actions', slideActions: 'Slide actions', titleTool: 'Title', textTool: 'Text', zoom: 'Canvas zoom', fit: 'Fit', rail: 'Resize slide list', inspector: 'Resize inspector' },
  ru: { overview: 'Обзор', grid: 'Сетка', editSlide: 'Редактировать слайд', mode: 'Вид редактора', actions: 'Действия', slideActions: 'Действия со слайдом', titleTool: 'Заголовок', textTool: 'Текст', zoom: 'Масштаб слайда', fit: 'Вписать', rail: 'Изменить ширину списка слайдов', inspector: 'Изменить ширину панели свойств' },
  kk: { overview: 'Шолу', grid: 'Тор', editSlide: 'Слайдты өңдеу', mode: 'Редактор көрінісі', actions: 'Әрекеттер', slideActions: 'Слайдқа арналған әрекеттер', titleTool: 'Тақырып', textTool: 'Мәтін', zoom: 'Слайд масштабы', fit: 'Сыйғызу', rail: 'Слайдтар тізімінің енін өзгерту', inspector: 'Қасиеттер панелінің енін өзгерту' },
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

const galleryWords = {
  en: { title: 'Other layouts', original: 'Original design' },
  ru: { title: 'Другие макеты', original: 'Исходный макет' },
  kk: { title: 'Басқа макеттер', original: 'Бастапқы макет' },
};

function layoutChoices(slide: Slide, initialLayout: Layout) {
  if (slide.diagram) {
    const layouts:Layout[]=['body','cover','quote',...alternateLayouts];
    return {all:layouts,gallery:layouts};
  }
  if (slide.additionalImages?.length) {
    const layouts:Layout[]=['image-grid',...alternateLayouts];
    return {all:[...new Set([slide.layout,...layouts])],gallery:layouts};
  }
  const original: Layout = slide.design?.variant === 'opening' ? 'cover' : slide.image ? 'image-right' : 'body';
  const isAlternate = (value: Layout) => alternateLayouts.some((layout) => layout === value);
  const originalStory = !isAlternate(initialLayout) ? initialLayout : original;
  const ordinary: Layout[] = ['cover', 'body', 'quote'];
  const banner:Layout[] = slide.image && !slide.chart && !slide.table ? ['image-section'] : [];
  if (slide.image) ordinary.push('image-left', 'image-right', 'image-full',...banner);
  if (slide.chart) ordinary.push('data-chart');
  if (slide.table) ordinary.push('native-table');
  ordinary.push('avatar-right');
  let bases: Layout[];
  if (slide.design?.variant) bases = [originalStory,...banner];
  else if (slide.chart || slide.table) bases = [...(slide.chart ? ['data-chart' as const] : []), ...(slide.table ? ['native-table' as const] : [])];
  else if (slide.image) bases = [initialLayout === 'cover' ? 'cover' : 'image-right', 'image-full',...banner];
  else bases = ['body', 'cover', 'quote'];
  if (!isAlternate(slide.layout) && !bases.includes(slide.layout)) bases = [slide.layout, ...bases].slice(0,3);
  return {
    all: [...new Set<Layout>([slide.layout, ...(slide.design?.variant ? [originalStory,...banner] : ordinary), ...alternateLayouts])],
    gallery: [...new Set<Layout>([...bases, ...alternateLayouts])].slice(0,6),
  };
}

function LayoutGallery({deck, slide, locale, layouts, onLayout, onClose}: {
  deck: Deck; slide: Slide; locale: Locale; layouts: Layout[]; onLayout: (layout: Layout) => void; onClose: () => void;
}) {
  const c = editorCopy[locale];
  const g = galleryWords[locale];
  return <section id="editor-layout-gallery" className="ed-layout-gallery" data-editor-motion="layout" aria-label={g.title}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header><h3>{g.title}</h3><IconButton label={c.close} onClick={onClose}><CaretDownIcon /></IconButton></header>
    <ToggleGroup className="ed-layout-options" spacing={0} aria-label={g.title} value={slide.freeLayout ? [] : [slide.layout]}
      onValueChange={(values) => { if (values[0]) onLayout(values[0] as Layout); }}>
      {layouts.map((layout) => {
        const label = slide.design?.variant && !['image-grid','image-section'].includes(layout) && !alternateLayouts.some((variant) => variant === layout) ? g.original : layoutNames[locale][layout];
        const active = !slide.freeLayout && slide.layout === layout;
        return <div key={layout} className="ed-layout-option" data-current={active}>
          <div className="ed-layout-mini" inert aria-hidden="true">
            <SlideCanvas slide={{ ...slide, layout, freeLayout:undefined }} deck={deck} lang={locale} />
          </div>
          <span aria-hidden="true">{active && <CheckIcon />}{label}</span>
          <ToggleGroupItem className="ed-layout-hit" value={layout} aria-label={label} title={label}/>
        </div>;
      })}
    </ToggleGroup>
  </section>;
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

function SlideDetails({
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
  view = 'slide',
}: EditorProps & { slide: Slide; index: number; focused: boolean; desktop: boolean; inspectorOpen: boolean; setInspectorOpen: (open: boolean) => void; zoom: CanvasZoom; onZoomChange: (zoom: CanvasZoom) => void; onToggleFocus: () => void; inspectorTab: InspectorTab; setInspectorTab: (tab: InspectorTab) => void; onCreateContent:(content:NewSlideContent)=>void; initialMediaKind?:InsertMediaKind; onMediaOpened:()=>void }) {
  const c = editorCopy[uiLocale];
  const [editing, setEditing] = useState<{ slot: TextSlot; inSheet: boolean } | null>(null);
  const proposal = useCanvasProposal();
  const [originalProposal, setOriginalProposal] = useState<string>();
  const reviewing = Boolean(proposal && inspectorTab === 'assistant' && !editing && view === 'slide');
  const proposed = reviewing && proposal && originalProposal !== proposal.id ? proposal : undefined;
  const words = {
    en: {preview:'Change preview', before:'Original', after:'Proposed', computer:'Use a computer to edit directly on the canvas.'},
    ru: {preview:'Просмотр правок', before:'Исходный', after:'С правками', computer:'Редактировать прямо на холсте можно на компьютере.'},
    kk: {preview:'Түзетулерді қарау', before:'Бастапқы', after:'Ұсынылған', computer:'Слайдты кенепте тікелей өңдеу үшін компьютерді қолданыңыз.'},
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
  const zoomOptions: { value: CanvasZoom; label: string }[] = [
    { value: 'fit', label: workspaceWords[uiLocale].fit },
    ...canvasZoomLevels.map((value) => ({ value, label: `${value}%` })),
  ];
  const [modal, setModal] = useState<DialogKind | null>(initialMediaKind ? 'edit-image' : null);
  const [imageIndex,setImageIndex]=useState(0);
  const [mediaKind,setMediaKind]=useState<InsertMediaKind|undefined>(initialMediaKind);
  useEffect(()=>{if(initialMediaKind)onMediaOpened();},[initialMediaKind,onMediaOpened]);
  const [excerpt, setExcerpt] = useState<SourceExcerpt | null>(null);
  const [url, setUrl] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const editEntry = useRef<HTMLElement>(null);
  const canEdit = slide.status === 'ready';
  function openAssistant() {
    if (focused) onToggleFocus();
    if (desktop) setInspectorOpen(true);
    setInspectorTab('assistant');
  }
  const save = (changes: SlideChanges) => onEdit(slide.id, changes);
  const offset = (direction: number) => {
    const next = deck.slides[index + direction];
    if (next) onSelectSlide(next.id);
  };
  const startEditing = (slot: TextSlot, entry: HTMLElement) => {
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
  const layoutLabel = (layout: Layout) => slide.design?.variant && !['image-grid','image-section'].includes(layout) && !alternateLayouts.some((item) => item === layout)
    ? galleryWords[uiLocale].original : layoutNames[uiLocale][layout];
  const applyLayout = (layout: Layout) => {
    if (!canEdit || layout === slide.layout && !slide.freeLayout) return;
    setEditing(null);
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
  const gallery = galleryOpen && <LayoutGallery deck={deck} slide={slide} locale={uiLocale} layouts={choices.gallery}
    onLayout={applyLayout} onClose={() => { setGalleryOpen(false); galleryTrigger.current?.focus({ preventScroll: true }); }} />;
  const insert = insertWords[uiLocale];
  const mediaNeedsSlide=Boolean(slide.importedPage || slide.diagram || slide.image && (slide.chart || slide.table || (slide.additionalImages?.length??0)>=2));
  const dataNeedsSlide=Boolean(slide.importedPage || slide.diagram || slide.additionalImages?.length);
  const canCreateSlide=Boolean(onEditOp && deck.slides.length<40);
  const openMedia = (kind:InsertMediaKind) => {
    if(mediaNeedsSlide) {if(canCreateSlide)onCreateContent({media:kind});return;}
    setMediaKind(kind);
    setImageIndex(slide.image ? (slide.additionalImages?.length??0)+1 : 0);
    setModal('edit-image');
  };
  const openArrangement = () => {
    setEditing(null);
    setInspectorTab('design');
    if (desktop) setInspectorOpen(true);
    requestAnimationFrame(()=>{
      setArrangement(captureLayout(slide,stage.current?.querySelector<HTMLElement>('.ed-slide')));
      setModal('arrange');
    });
  };
  const insertData = (kind:'table'|'chart') => {
    setEditing(null);
    const changes:SlideChanges={layout:kind==='table' ? 'native-table' : 'data-chart',freeLayout:null};
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
                <PlusIcon aria-hidden/><span>{insert.insert}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="ed-insert-menu">
                <DropdownMenuGroup>
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
                  <Button variant="ghost" size="sm" className="ed-author-tool" data-editor-tool={field} title={label} aria-label={label}
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
                <IconButton toolbar label={c.undo} onClick={onUndo} disabled={!canUndo}>
                  <ArrowCounterClockwiseIcon />
                </IconButton>
              )}
              {onRedo && <IconButton toolbar label={c.redo} onClick={onRedo} disabled={!canRedo}><ArrowClockwiseIcon/></IconButton>}
            </Toolbar>
            <Button variant="ghost" size="icon-sm" className="ed-icon ed-arrange-tool" aria-label={insert.free} title={insert.free} onClick={openArrangement} disabled={!canEdit}><LayoutIcon/></Button>
            <CanvasAssistantDropdown openReview={openAssistant} trigger={<Button variant="ghost" size="icon-sm" className="ed-icon ed-ai-tool" aria-label={canvasCopy[uiLocale].label} title={canvasCopy[uiLocale].label} disabled={!canEdit}><ChatCircleTextIcon/></Button>}/>
            {onEditOp && (
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <Button className="ed-slide-actions" variant="ghost" size="sm"
                    title={workspaceWords[uiLocale].slideActions} aria-label={workspaceWords[uiLocale].slideActions} />
                }>
                  <DotsThreeIcon aria-hidden /><span>{workspaceWords[uiLocale].actions}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="ed-slide-actions-menu">
                  <DropdownMenuGroup>
                    <DropdownMenuItem disabled={!canEdit} onClick={openAssistant}>
                      <ChatCircleTextIcon aria-hidden />{canvasCopy[uiLocale].label}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canEdit} onClick={() => onEditOp({ kind: 'duplicate', slideId: slide.id })}>
                      <CopyIcon aria-hidden />{c.duplicate}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" disabled={deck.slides.length < 2} onClick={() => setModal('remove')}>
                      <TrashIcon aria-hidden />{c.remove}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
        <div className="ed-stage" data-preview={proposed ? 'proposed' : 'original'} tabIndex={-1} role="group" aria-label={c.canvas} data-zoomed={zoom !== 'fit'}>
          <div className="ed-stage-wrap" ref={stage}
            style={zoom === 'fit' ? undefined : { width: canvasWidthAt100Percent * Number(zoom) / 100 }}>
            <SlideCanvas
              slide={proposed?.slide ?? slide}
              deck={proposed ? {...deck, theme: proposed.theme} : deck}
              lang={uiLocale}
              includeChartData
              onOverflowChange={setOverflow}
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
          </div>
        </div>
        {!desktop && canEdit && <p className="ed-canvas-note">{words.computer}</p>}
        {gallery}
        <div className="ed-stage-foot">
          <div className="ed-slide-position" data-editor-motion="slide">
            <IconButton label={c.previous} disabled={index === 0} onClick={() => offset(-1)}><CaretLeftIcon /></IconButton>
            <SlidePositionPicker slides={deck.slides} index={index} locale={uiLocale} onChange={position => onSelectSlide(deck.slides[position].id)}/>
            <IconButton label={c.next} disabled={index === deck.slides.length - 1} onClick={() => offset(1)}><CaretRightIcon /></IconButton>
          </div>
          {canEdit && <Button size="sm" variant="ghost" className="ed-layout-toggle ed-layout-footer-trigger" title={galleryWords[uiLocale].title}
            aria-label={galleryWords[uiLocale].title} aria-expanded={galleryOpen} aria-controls={galleryOpen ? 'editor-layout-gallery' : undefined}
            onClick={(event) => toggleGallery(event.currentTarget)}>
            <LayoutIcon aria-hidden /><span>{galleryWords[uiLocale].title}</span>
          </Button>}
          {slide.status !== 'ready' && (
            <span className="ed-status" data-status={slide.status}>
              {slide.status === 'failed' ? <WarningCircleIcon /> : <ClockIcon />}
              {slide.moderationNotice || statusText(slide, c)}
            </span>
          )}
          <SlideQuality deck={deck} slide={slide} locale={uiLocale}/>
          {overflow && canEdit ? (
            <Button
              className="ed-pill"
              variant="outline"
              size="sm"
              onClick={openAssistant}
            >
              <WarningCircleIcon />
              {uiLocale === 'ru' ? 'Не помещается' : uiLocale === 'kk' ? 'Сыймайды' : 'Text overflows'}
            </Button>
          ) : null}
          {onRetry && (slide.status === 'failed' || slide.status === 'cancelled') && (
            <Button className="ed-pill" variant="outline" size="sm" onClick={() => onRetry(slide.id)}>
              <ArrowCounterClockwiseIcon />
              {c.retry}
            </Button>
          )}
          <div className="ed-stage-display">
            <Select items={zoomOptions} value={zoom} onValueChange={(value) => { if (value) onZoomChange(value); }}>
              <SelectTrigger className="ed-zoom" size="sm" aria-label={workspaceWords[uiLocale].zoom}>
                <MagnifyingGlassIcon aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup align="end" side="top" alignItemWithTrigger={false}>
                {zoomOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="ed-ratio">
              <MonitorIcon aria-hidden />
              16:9
            </span>
            <IconButton
              label={focused ? c.exitFocus : c.enterFocus}
              pressed={focused}
              onClick={onToggleFocus}
            >
              {focused ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            </IconButton>
          </div>
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
            <TabsTrigger value="notes" aria-label={lectureTitle(uiLocale)}><NotePencilIcon /><span>{labels.notes}</span></TabsTrigger>
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
                  onClick={(event) => {
                    const open = !galleryOpen;
                    toggleGallery(event.currentTarget);
                    if (open && view === 'slide') requestAnimationFrame(() => {
                      stage.current?.closest('.ed-center')?.querySelector<HTMLElement>('#editor-layout-gallery [aria-pressed="true"]')?.focus();
                    });
                  }}>
                  <SquaresFourIcon aria-hidden />{galleryWords[uiLocale].title}<CaretDownIcon aria-hidden />
                </Button>}
                {view === 'overview' && gallery}
              </section>
              <SlideDataEditor slide={slide} locale={uiLocale} disabled={!canEdit} onChange={save}/>
              <section className="inspect-section inspect-elements" aria-label={labels.elements}>
                  <h3 className="inspect-label">{labels.elements}</h3>
                  <InspectorAction icon={<LayoutIcon/>} disabled={!canEdit} onClick={openArrangement}>{freeWords[uiLocale].name}</InspectorAction>
                  {slide.diagram && <InspectorAction icon={<TreeStructureIcon/>} disabled={!canEdit} onClick={()=>{
                    if(slide.diagram) {setDiagramDraft({diagram:slide.diagram,existing:true});setModal('diagram');}
                  }}>{diagramWords[uiLocale].edit}</InspectorAction>}
                  {hasStoryFields && <InspectorAction icon={<NotePencilIcon />} disabled={!canEdit} onClick={() => setModal('story')}>
                    {storyFields[uiLocale].edit}
                  </InspectorAction>}
                  {!slide.importedPage && !slide.diagram && <InspectorAction icon={<ImageIcon />} disabled={!canEdit} onClick={()=>{setMediaKind(undefined);setImageIndex(0);setModal('edit-image');}}>{slide.image ? imageWords[uiLocale].edit : imageWords[uiLocale].add}</InspectorAction>}
                  {slide.image && !slide.importedPage && !slide.diagram && !slide.chart && !slide.table &&
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
              <ThemePicker deck={deck} locale={uiLocale} value={deck.theme} onChange={(theme) => onEditOp({ kind: 'deck', theme })} />
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
      {(modal === 'image' || modal === 'table' || modal === 'chart') && (
        <DataEdit kind={modal} slide={slide} c={c} onSave={save} close={() => setModal(null)} />
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
        />
        </AssistantSession>
        </ResizablePanelGroup>
      </div>
      {groupsOpen && onEditOp && <SlideGroups deck={deck} afterId={slide.id} locale={uiLocale} submit={onEditOp} close={()=>setGroupsOpen(false)}/>}
    </section>
  );
}
export default Editor;
