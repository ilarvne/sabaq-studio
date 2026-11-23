import { useMemo, useRef, type RefObject } from 'react';
import { Accessibility } from '@dnd-kit/dom';
import { DragDropProvider, type DragEndEvent, type DragOverEvent } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { DotsSixVerticalIcon } from '@phosphor-icons/react';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { editorCopy } from './editorCopy';
import { Button } from '@/components/coss/button';
import './slide-navigator.css';

const dragCopy = {
  en: {
    reorder: 'Reorder slide',
    openHint: 'Press Enter or double-click to edit.',
    instructions:
      'Press Space to pick up a slide. Use the arrow keys to move it. Press Space to drop it or Escape to cancel.',
    cancelled: 'Slide move cancelled.',
    moved: (title: string, position: number, count: number) =>
      `${title}. Moved to slide ${position} of ${count}.`,
  },
  ru: {
    reorder: 'Переместить слайд',
    openHint: 'Нажмите Enter или дважды щёлкните, чтобы редактировать.',
    instructions:
      'Нажмите пробел, чтобы взять слайд. Перемещайте его стрелками. Пробел завершает перемещение, Escape отменяет.',
    cancelled: 'Перемещение слайда отменено.',
    moved: (title: string, position: number, count: number) =>
      `${title}. Новая позиция — ${position} из ${count}.`,
  },
  kk: {
    reorder: 'Слайдты жылжыту',
    openHint: 'Өңдеу үшін Enter пернесін басыңыз немесе екі рет басыңыз.',
    instructions:
      'Слайдты алу үшін бос орын пернесін басыңыз. Оны көрсеткі пернелерімен жылжытыңыз. Орналастыру үшін бос орын пернесін, бас тарту үшін Escape пернесін басыңыз.',
    cancelled: 'Слайдты жылжыту тоқтатылды.',
    moved: (title: string, position: number, count: number) =>
      `${title}. Слайд орны — ${position} / ${count}.`,
  },
};

export function slideOrderMessage(locale: Locale, slide: Slide, index: number, count: number) {
  return dragCopy[locale].moved(slide.title || editorCopy[locale].slide, index + 1, count);
}

interface NavigatorProps {
  deck: Deck;
  locale: Locale;
  selectedId: string;
  outline: boolean;
  overview?: boolean;
  onOpen?: (id: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onMove?: (id: string, index: number) => void;
  announcement: string;
}

function Thumbnail({
  deck,
  locale,
  slide,
  index,
  selectedId,
  outline,
  overview,
  listRef,
  onSelect,
  onOpen,
  onMove,
  sortable,
}: Omit<NavigatorProps, 'announcement'> & {
  slide: Slide;
  index: number;
  sortable: boolean;
}) {
  const active = slide.id === selectedId;
  const { ref, handleRef, isDragSource } = useSortable({ id: slide.id, index, disabled: !sortable });
  const c = editorCopy[locale];
  const title = slide.title || c[slide.status === 'cancelled' ? 'canceled' : slide.status];
  return (
    <div
      ref={ref}
      className="ed-thumb"
      aria-current={active || undefined}
      data-dragging={isDragSource || undefined}
    >
      <span className="ed-thumb-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      {!outline && (
        <div className="ed-thumb-visual" inert aria-hidden="true">
          <SlideCanvas
            slide={slide}
            deck={deck}
            lang={locale}
            revealAnswer={slide.design?.variant !== 'reflection'}
          />
        </div>
      )}
      <div className="ed-thumb-caption" aria-hidden="true">
        <span lang={slide.title ? deck.language : locale}>{title}</span>
      </div>
      <Button
        variant="ghost"
        type="button"
        className="ed-thumb-hit"
        data-editor-motion="slide"
        aria-current={active || undefined}
        aria-label={`${c.slide} ${index + 1} · ${title}`}
        title={onOpen ? `${title} · ${dragCopy[locale].openHint}` : title}
        aria-description={onOpen ? dragCopy[locale].openHint : undefined}
        aria-keyshortcuts={onMove ? 'Control+[ Control+] Meta+[ Meta+]' : undefined}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(slide.id)}
        onDoubleClick={onOpen ? () => onOpen(slide.id) : undefined}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && onMove &&
            (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
            event.preventDefault();
            onMove(slide.id, index + (event.code === 'BracketRight' ? 1 : -1));
            return;
          }
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === 'Enter' && onOpen) {
            event.preventDefault();
            onOpen(slide.id);
            return;
          }
          const columns = overview && listRef.current
            ? getComputedStyle(listRef.current).gridTemplateColumns.split(' ').length : 1;
          const destination = {
            ArrowUp: index - columns,
            ArrowLeft: index - 1,
            ArrowDown: index + columns,
            ArrowRight: index + 1,
            Home: 0,
            End: deck.slides.length - 1,
          }[event.key];
          if (destination === undefined) return;
          event.preventDefault();
          const next = deck.slides[destination];
          if (!next) return;
          listRef.current
            ?.querySelectorAll<HTMLButtonElement>('.ed-thumb-hit')
            [destination]?.focus({ preventScroll: !overview });
          onSelect(next.id);
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        ref={handleRef}
        type="button"
        className="ed-slide-grip"
        hidden={!sortable}
        disabled={!sortable}
        tabIndex={active && sortable ? 0 : -1}
        aria-label={`${dragCopy[locale].reorder} · ${title}`}
        title={dragCopy[locale].reorder}
      >
        <DotsSixVerticalIcon size={17} aria-hidden="true" />
      </Button>
    </div>
  );
}

export function SlideNavigator({
  deck,
  locale,
  selectedId,
  outline,
  overview = false,
  listRef,
  onSelect,
  onOpen,
  onMove,
  announcement,
}: NavigatorProps) {
  const startingOrder = useRef<string[]>([]);
  const c = dragCopy[locale];
  const accessibility = useMemo(
    () =>
      Accessibility.configure({
        screenReaderInstructions: { draggable: c.instructions },
        announcements: {
          dragstart: () => c.instructions,
          dragover: ({ operation }: DragOverEvent) => {
            const source = operation.source;
            return isSortable(source) ? `${editorCopy[locale].slide} ${source.index + 1}` : undefined;
          },
          dragend: (event: DragEndEvent) => (event.canceled ? c.cancelled : undefined),
        },
      }),
    [c, locale],
  );

  return (
    <DragDropProvider
      plugins={(defaults) =>
        defaults.map((plugin) => (plugin === Accessibility ? accessibility : plugin))
      }
      onDragStart={() => {
        startingOrder.current = deck.slides.map((slide) => slide.id);
      }}
      onDragEnd={(event) => {
        if (event.canceled || !onMove) return;
        const { source, target, activatorEvent, position } = event.operation;
        if (!target || !isSortable(source) || source.index === source.initialIndex) return;
        if (
          startingOrder.current.length !== deck.slides.length ||
          startingOrder.current.some((id, index) => id !== deck.slides[index].id)
        )
          return;
        const bounds = listRef.current?.getBoundingClientRect();
        if (activatorEvent instanceof PointerEvent && bounds) {
          const { x, y } = position.current;
          if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
        }
        onMove(String(source.id), source.index);
      }}
    >
      <div id={overview ? 'editor-overview-navigator' : 'editor-slide-navigator'}
        className={overview ? 'ed-thumb-list ed-overview-list' : 'ed-thumb-list'}
        role="group" aria-label={editorCopy[locale].slides} ref={listRef} data-outline={outline}>
        {deck.slides.map((slide, index) => (
          <Thumbnail
            key={slide.id}
            {...{ deck, locale, outline, overview, selectedId, listRef, onSelect, onOpen, onMove, slide, index }}
            sortable={Boolean(onMove) && deck.slides.length > 1}
          />
        ))}
      </div>
      <span className="ed-sr" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </DragDropProvider>
  );
}
