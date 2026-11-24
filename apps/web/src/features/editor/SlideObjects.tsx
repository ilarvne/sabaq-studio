import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowRightIcon, CircleIcon, RectangleIcon, TextboxIcon } from '@phosphor-icons/react';
import { fitCanvasObject, fitFreeBox, freeBounds } from '@sabaq/lesson/free-layout';
import { lessonPalette, presentationCoverArtwork } from '@sabaq/lesson/themes';
import { maxSlideObjects, slideObjectKinds, type CanvasObject, type Deck, type Locale, type Slide, type SlideArtwork, type SlideChanges, type SlideObjectKind } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { DropdownMenuItem, DropdownMenuGroup } from '@/components/shadcn/dropdown-menu';
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Input } from '@/components/coss/input';
import { Textarea } from '@/components/coss/textarea';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import './slide-objects.css';

const icons = { text: TextboxIcon, rectangle: RectangleIcon, ellipse: CircleIcon, arrow: ArrowRightIcon };
const copy = {
  en: { text: 'Text box', rectangle: 'Rectangle', ellipse: 'Ellipse', arrow: 'Arrow', artwork: 'Cover decoration', add: 'Add', edit: 'Edit', apply: 'Apply', close: 'Close',
    color: 'Color', size: 'Font size', align: 'Alignment', bold: 'Bold', left: 'Left', center: 'Center', right: 'Right',
    positioning: 'Position and size', x: 'X (%)', y: 'Y (%)', w: 'Width (%)', h: 'Height (%)', rotation: 'Rotation (°)',
    front: 'Bring to front', back: 'Send to back', remove: 'Delete object', drag: 'Drag to move. Double-click or press Enter to edit.' },
  ru: { text: 'Текстовое поле', rectangle: 'Прямоугольник', ellipse: 'Эллипс', arrow: 'Стрелка', artwork: 'Декор обложки', add: 'Добавить', edit: 'Изменить', apply: 'Применить', close: 'Закрыть',
    color: 'Цвет', size: 'Размер шрифта', align: 'Выравнивание', bold: 'Полужирный', left: 'Слева', center: 'По центру', right: 'Справа',
    positioning: 'Положение и размер', x: 'X (%)', y: 'Y (%)', w: 'Ширина (%)', h: 'Высота (%)', rotation: 'Поворот (°)',
    front: 'На передний план', back: 'На задний план', remove: 'Удалить объект', drag: 'Перетащите объект. Двойной щелчок или Enter открывает редактор.' },
  kk: { text: 'Мәтін жолағы', rectangle: 'Тіктөртбұрыш', ellipse: 'Эллипс', arrow: 'Көрсеткі', artwork: 'Мұқаба өрнегі', add: 'Қосу', edit: 'Өңдеу', apply: 'Қолдану', close: 'Жабу',
    color: 'Түс', size: 'Қаріп өлшемі', align: 'Туралау', bold: 'Қалың', left: 'Солға', center: 'Ортаға', right: 'Оңға',
    positioning: 'Орны мен өлшемі', x: 'X (%)', y: 'Y (%)', w: 'Ені (%)', h: 'Биіктігі (%)', rotation: 'Бұрылу (°)',
    front: 'Алдыңғы қабатқа', back: 'Артқы қабатқа', remove: 'Нысанды жою', drag: 'Жылжыту үшін сүйреңіз. Өңдеу үшін екі рет басыңыз немесе Enter пернесін басыңыз.' },
};

export function SlideObjectMenuItems({ locale, disabled, onInsert }: { locale: Locale; disabled: boolean; onInsert: (kind: SlideObjectKind) => void }) {
  return <DropdownMenuGroup>{slideObjectKinds.map(kind => {
    const Icon = icons[kind];
    return <DropdownMenuItem key={kind} disabled={disabled} onClick={() => onInsert(kind)}><Icon/>{copy[locale][kind]}</DropdownMenuItem>;
  })}</DropdownMenuGroup>;
}

type Drag = { mode: 'move' | 'resize'; pointer: number; x: number; y: number; width: number; height: number; object: CanvasObject; moved?: CanvasObject };

export function useSlideObjects({ deck, slide, locale, enabled, onChange, renderActions }: {
  deck: Deck; slide: Slide; locale: Locale; enabled: boolean; onChange: (changes: SlideChanges) => void;
  renderActions?: (object: CanvasObject, close: () => void) => ReactNode;
}) {
  const t = copy[locale];
  const nativeObjects = slide.objects ?? [];
  const artwork = presentationCoverArtwork(deck, slide);
  const objects = [...artwork, ...nativeObjects];
  const [editor, setEditor] = useState<CanvasObject>();
  const [preview, setPreview] = useState<CanvasObject>();
  const drag = useRef<Drag | null>(null);
  const canInsert = enabled && nativeObjects.length < maxSlideObjects;
  const exists = editor && objects.some(object => object.id === editor.id);
  const close = () => setEditor(undefined);
  const replaceArtwork = (objects: SlideArtwork[]) => onChange({ coverArtwork: {theme:deck.theme, objects} });
  const replace = (object: CanvasObject) => object.kind === 'artwork'
    ? replaceArtwork(artwork.map(item => item.id === object.id ? object : item))
    : onChange({ objects: nativeObjects.map(item => item.id === object.id ? object : item) });
  const remove = (object: CanvasObject) => object.kind === 'artwork'
    ? replaceArtwork(artwork.filter(item => item.id !== object.id))
    : onChange({ objects: nativeObjects.filter(item => item.id !== object.id) });
  const label = (object: CanvasObject) => {
    if (object.kind === 'artwork') return `${t.artwork} ${object.id.slice(-1)}`;
    return object.kind === 'text' && object.text.trim() ? `${t.text} · ${object.text.trim().slice(0, 80)}` : t[object.kind];
  };

  function insert(kind: SlideObjectKind) {
    if (!canInsert) return;
    const palette = lessonPalette(deck, slide.powerPointLayoutId);
    const w = kind === 'text' ? 38 : 16;
    const h = 13;
    const occupied = objects.map(freeBounds);
    const textColumns = slide.image && slide.layout === 'image-left' ? [53, 8] : [8, 53];
    const columns = kind === 'text' ? textColumns : [76, 53, 30, 8];
    const candidates = [72, 54, 25].flatMap(y => columns.map(x => ({ x, y })));
    const position = candidates.find(({ x, y }) => occupied.every(box =>
      x + w < box.x || box.x + box.w < x || y + h < box.y || box.y + box.h < y)) ?? candidates[0];
    const geometry = { id: crypto.randomUUID(), ...position, w, h, rotation: 0 };
    const ink = slide.image && slide.layout === 'image-full' && !slide.importedPage ? '#ffffff' : palette.ink;
    setEditor(kind === 'text' ? { ...geometry, kind, text: '', color: ink, fontSize: 24, bold: false, align: 'left' }
      : { ...geometry, kind, color: palette.accent });
  }

  function start(event: PointerEvent<HTMLButtonElement>, object: CanvasObject, mode: Drag['mode']) {
    if (event.button !== 0) return;
    const canvas = event.currentTarget.closest('.ed-slide')?.getBoundingClientRect();
    if (!canvas?.width || !canvas.height) return;
    drag.current = { mode, pointer: event.pointerId, x: event.clientX, y: event.clientY, width: canvas.width, height: canvas.height, object };
    if (mode === 'move') event.currentTarget.focus({preventScroll:true});
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const screenX = event.clientX - gesture.x;
    const screenY = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(screenX, screenY) < 3) return;
    const dx = screenX * 100 / gesture.width;
    const dy = screenY * 100 / gesture.height;
    const { object } = gesture;
    if (gesture.mode === 'resize') {
      const minimum = object.kind === 'artwork' ? .1 : 2;
      const w = Math.min(100 - object.x, Math.max(minimum, object.w + dx));
      const h = Math.min(100 - object.y, Math.max(minimum, object.h + dy));
      gesture.moved = fitCanvasObject({ ...object, w, h });
    } else gesture.moved = fitCanvasObject({ ...object, x: object.x + dx, y: object.y + dy });
    setPreview(gesture.moved);
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (gesture?.pointer !== event.pointerId) return;
    drag.current = null;
    setPreview(undefined);
    if (event.type === 'pointerup' && gesture.moved) replace(gesture.moved);
  }

  function renderObject(object: CanvasObject, visual: ReactNode) {
    const saved = objects.find(item => item.id === object.id) ?? object;
    return <>
      {visual}
      <button type="button" className="ed-object-hit" aria-label={label(object)} aria-description={t.drag} title={t.drag}
        onPointerDown={event => start(event, saved, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onClick={event => { if (event.detail === 0) setEditor(saved); }} onDoubleClick={() => setEditor(saved)}
        onKeyDown={event => {
          if (event.key === 'Escape' && !drag.current) {
            event.stopPropagation();
            event.currentTarget.closest<HTMLElement>('.ed-stage-wrap')?.focus({preventScroll:true});
            return;
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault(); event.stopPropagation(); remove(saved); return;
          }
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 5 : 1;
          replace(fitCanvasObject({ ...saved, x: saved.x + direction[0] * step, y: saved.y + direction[1] * step }));
        }}/>
      {object.rotation === 0 && <button type="button" tabIndex={-1} aria-hidden="true" className="ed-object-resize"
        onPointerDown={event => { event.preventDefault(); start(event, saved, 'resize'); }} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}/>}
    </>;
  }

  function commit() {
    if (!enabled || !editor || (!exists && !canInsert)) return;
    if (exists) replace(fitCanvasObject(editor));
    else if (editor.kind !== 'artwork') onChange({ objects: [...nativeObjects, fitFreeBox(editor)] });
    close();
  }

  function moveLayer(front: boolean) {
    if (!editor || !exists) return;
    if (editor.kind === 'artwork') {
      const other = artwork.filter(object => object.id !== editor.id);
      const updated = fitCanvasObject(editor);
      replaceArtwork(front ? [...other, updated] : [updated, ...other]);
    } else {
      const other = nativeObjects.filter(object => object.id !== editor.id);
      const updated = fitFreeBox(editor);
      onChange({ objects: front ? [...other, updated] : [updated, ...other] });
    }
    close();
  }

  const dialog = enabled && editor && <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogPopup className="ed-object-dialog" closeProps={{ 'aria-label': t.close }}>
      <DialogHeader><DialogTitle>{exists ? t.edit : t.add} · {t[editor.kind]}</DialogTitle></DialogHeader>
      <DialogPanel className="ed-object-form">
        {editor.kind === 'text' && <label>{t.text}<Textarea value={editor.text} rows={3} maxLength={600}
          onChange={event => setEditor({ ...editor, text: event.target.value })}/></label>}
        <div className="ed-object-style">
          <label>{t.color}<Input type="color" value={editor.color} onChange={event => setEditor({ ...editor, color: event.target.value })}/></label>
          {editor.kind === 'text' && <>
            <label>{t.size}<Input type="number" min={12} max={72} defaultValue={editor.fontSize} onChange={event => {
              const value = event.target.valueAsNumber;
              if (Number.isFinite(value)) setEditor({ ...editor, fontSize: Math.max(12, Math.min(72, Math.round(value))) });
            }}/></label>
            <label>{t.align}<Select value={editor.align} onValueChange={value => { if (value) setEditor({ ...editor, align: value }); }}>
              <SelectTrigger aria-label={t.align}><SelectValue>{t[editor.align]}</SelectValue></SelectTrigger>
              <SelectPopup>{(['left', 'center', 'right'] as const).map(value => <SelectItem key={value} value={value}>{t[value]}</SelectItem>)}</SelectPopup>
            </Select></label>
            <label className="ed-object-bold"><input type="checkbox" checked={editor.bold} onChange={event => setEditor({ ...editor, bold: event.target.checked })}/>{t.bold}</label>
          </>}
        </div>
        <fieldset>
          <legend>{t.positioning}</legend>
          <div className="ed-object-coordinates">{(['x', 'y', 'w', 'h', 'rotation'] as const).map(field => <label key={field}>{t[field]}
            <Input type="number" step="0.1" defaultValue={Math.round(editor[field] * 10) / 10} onChange={event => {
              if (Number.isFinite(event.target.valueAsNumber)) setEditor({ ...editor, [field]: event.target.valueAsNumber });
            }}/>
          </label>)}</div>
        </fieldset>
        {exists && <div className="ed-object-actions">
          <Button variant="outline" size="sm" onClick={() => moveLayer(true)}>{t.front}</Button>
          <Button variant="outline" size="sm" onClick={() => moveLayer(false)}>{t.back}</Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => { remove(editor); close(); }}>{t.remove}</Button>
          {renderActions?.(editor, close)}
        </div>}
      </DialogPanel>
      <DialogFooter><Button onClick={commit} disabled={editor.kind === 'text' && !editor.text.trim()}>{exists ? t.apply : t.add}</Button></DialogFooter>
    </DialogPopup>
  </Dialog>;

  const previewSlide = !preview ? slide : preview.kind === 'artwork' ? {
    ...slide, coverArtwork: {theme:deck.theme, objects:artwork.map(item => item.id === preview.id ? preview : item)},
  } : { ...slide, objects: nativeObjects.map(item => item.id === preview.id ? preview : item) };
  return { canInsert, insert, dialog, objects, renderObject: enabled ? renderObject : undefined, label,
    open: (object: CanvasObject) => { if (enabled) setEditor(object); }, previewSlide };
}
