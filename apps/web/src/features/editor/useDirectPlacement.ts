import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { effectiveFreeLayout, moveFree, selectedGroup, type FreeGuides, type FreeId, type FreeLayout } from '@sabaq/lesson/free-layout';
import type { Slide } from '@sabaq/lesson/types';
import { canvasPlacementElement, captureLayout } from './capture-layout';

const arrowSteps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const;
const noLayer = '[contenteditable], input, textarea, select, button, a[href], .ed-slide-object';
type Pointer = { id: FreeId; pointerId: number; x: number; y: number };
type Drag = {
  initial: FreeLayout;
  preview: FreeLayout;
  ids: FreeId[];
  axis?: 'x' | 'y';
};

export function useDirectPlacement({ enabled, slide, stage, onCommit }: {
  enabled: boolean;
  slide: Slide;
  stage: RefObject<HTMLDivElement | null>;
  onCommit(layout: FreeLayout): void;
}) {
  const [ids, setIds] = useState<FreeId[]>([]);
  const [captured, setCaptured] = useState<FreeLayout>();
  const [preview, setPreview] = useState<FreeLayout>();
  const [guides, setGuides] = useState<FreeGuides>({});
  const pointer = useRef<Pointer>(null);
  const drag = useRef<Drag>(null);
  const root = () => stage.current?.querySelector<HTMLElement>(':scope > .ed-slide');
  const read = () => captureLayout(slide, root());
  const layout = preview ?? (slide.freeLayout ? effectiveFreeLayout(slide) : captured);
  const selection = layout ? selectedGroup(layout, ids) : [];

  function layer(target: EventTarget | null) {
    const canvas = root();
    return canvas && target instanceof Element && !target.closest(noLayer)
      ? canvasPlacementElement(slide, canvas, target)
      : undefined;
  }

  function select(next: FreeId[], geometry = read()) {
    setIds(next);
    setCaptured(next.length ? geometry : undefined);
  }

  function commit(next: FreeLayout) {
    setPreview(undefined);
    setCaptured(next);
    onCommit(next);
  }

  function stop() {
    const active = drag.current;
    const pointerId = pointer.current?.pointerId;
    pointer.current = null;
    drag.current = null;
    if (pointerId !== undefined && stage.current?.hasPointerCapture(pointerId)) {
      stage.current.releasePointerCapture(pointerId);
    }
    if (active) {
      setPreview(undefined);
      setGuides({});
    }
    return active;
  }

  function clear() {
    stop();
    setIds([]);
    setCaptured(undefined);
    setPreview(undefined);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.button !== 0 || !event.isPrimary || drag.current) return;
    if (!(event.target instanceof Element) || event.target.closest(noLayer)) return;
    const id = layer(event.target);
    pointer.current = id ? {id, pointerId: event.pointerId, x: event.clientX, y: event.clientY} : null;
    if (!id) clear();
    else if (event.shiftKey) {
      const current = read();
      const together = selectedGroup(current, [id]);
      select(selection.includes(id)
        ? selection.filter(item => !together.includes(item))
        : [...selection, ...together], current);
      pointer.current = null;
      event.preventDefault();
      event.currentTarget.focus({preventScroll:true});
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = pointer.current;
    if (!enabled || origin?.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) { stop(); return; }
    const x = event.clientX - origin.x, y = event.clientY - origin.y;
    if (!drag.current && Math.hypot(x, y) < 4) return;
    const rect = root()?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    if (!drag.current) {
      const initial = read();
      const targets = selectedGroup(initial, selection.includes(origin.id) ? selection : [origin.id]);
      if (!targets.length) return;
      drag.current = {initial, preview:initial, ids:targets};
      select(targets, initial);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({preventScroll:true});
      window.getSelection()?.removeAllRanges();
    }
    const current = drag.current;
    current.axis = event.shiftKey ? current.axis ?? (Math.abs(x) >= Math.abs(y) ? 'x' : 'y') : undefined;
    const snap = event.altKey ? false : {
      x: current.axis === 'y' ? 0 : 700 / rect.width,
      y: current.axis === 'x' ? 0 : 700 / rect.height,
    };
    const next = moveFree(current.initial, current.ids,
      current.axis === 'y' ? 0 : 100 * x / rect.width,
      current.axis === 'x' ? 0 : 100 * y / rect.height, snap);
    current.preview = next.layout;
    setPreview(next.layout === current.initial ? undefined : next.layout);
    setGuides(next.guides);
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || pointer.current?.pointerId !== event.pointerId) return;
    const origin = pointer.current;
    const active = stop();
    if (active) {
      if (active.preview !== active.initial) commit(active.preview);
    } else if (!(event.target instanceof Element && event.target.closest('[data-slot-entry]'))) {
      const current = read();
      select(selectedGroup(current, [origin.id]), current);
      event.currentTarget.focus({preventScroll:true});
    }
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current?.pointerId === event.pointerId) stop();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(noLayer)) return;
    if (event.key === 'Escape' && (selection.length || pointer.current)) {
      event.preventDefault();
      event.stopPropagation();
      clear();
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey || drag.current) return;
    const step = arrowSteps[event.key as keyof typeof arrowSteps];
    if (!step) return;
    const focused = layer(event.target);
    const current = read();
    const targets = selectedGroup(current, focused && !selection.includes(focused) ? [focused] : selection);
    if (!targets.length) return;
    event.preventDefault();
    select(targets, current);
    const amount = event.shiftKey ? 10 : 1;
    const next = moveFree(current,targets,100 * step[0] * amount / 1280,100 * step[1] * amount / 720,false).layout;
    if (next !== current) commit(next);
  }

  return {
    layout: enabled ? layout : undefined, preview: enabled ? preview : undefined,
    selection: enabled ? selection : [], guides, read, select, clear, commit, setPreview,
    events: {
      onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onPointerCancel(event);
      },
      onKeyDown,
    },
  };
}
