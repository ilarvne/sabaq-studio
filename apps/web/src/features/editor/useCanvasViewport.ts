import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const canvasZoomLevels = ['10', '25', '50', '75', '100', '125', '150', '200', '250'] as const;
export type CanvasZoom = 'fit' | `${number}`;
export const canvasWidthAt100Percent = 1280;

type Point = { x: number; y: number };
type ZoomAnchor = { pointer: Point; slide: Point; zoom: CanvasZoom };
const origin = { x: 0, y: 0 };

export function useCanvasViewport(zoom: CanvasZoom, onZoomChange: (zoom: CanvasZoom) => void) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pan = useRef<Point>(origin);
  const anchor = useRef<ZoomAnchor | null>(null);

  const setPan = useCallback((point: Point) => {
    pan.current = point;
    stage.current?.style.setProperty('translate', `${point.x}px ${point.y}px`);
  }, []);

  const resetPan = useCallback(() => {
    anchor.current = null;
    setPan(origin);
    viewport.current?.scrollTo(0, 0);
  }, [setPan]);

  const zoomAt = useCallback((next: CanvasZoom, pointer: Point) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    anchor.current = {
      pointer,
      slide: { x: (pointer.x - rect.left) / rect.width, y: (pointer.y - rect.top) / rect.height },
      zoom: next,
    };
    onZoomChange(next);
  }, [onZoomChange]);

  useLayoutEffect(() => {
    const target = anchor.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!target || !rect || target.zoom !== zoom) return;
    anchor.current = null;
    // Reflow changes the slide's dimensions and can also move its flex alignment.
    setPan({
      x: pan.current.x + target.pointer.x - (rect.left + rect.width * target.slide.x),
      y: pan.current.y + target.pointer.y - (rect.top + rect.height * target.slide.y),
    });
  }, [setPan, zoom]);

  const changeZoom = useCallback((next: CanvasZoom) => {
    if (next === 'fit') {
      resetPan();
      onZoomChange(next);
    } else if (next !== zoom) {
      const rect = viewport.current?.getBoundingClientRect();
      if (rect) zoomAt(next, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  }, [onZoomChange, resetPan, zoom, zoomAt]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let drag: { id: number; pointer: Point } | null = null;

    function startPan(event: PointerEvent) {
      if (event.button !== 1) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLDivElement;
      target.setPointerCapture(event.pointerId);
      target.dataset.panning = 'true';
      drag = { id: event.pointerId, pointer: { x: event.clientX, y: event.clientY } };
    }

    function movePan(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return;
      if (!(event.buttons & 4)) {
        endPan(event);
        return;
      }
      setPan({
        x: pan.current.x + event.clientX - drag.pointer.x,
        y: pan.current.y + event.clientY - drag.pointer.y,
      });
      drag.pointer = { x: event.clientX, y: event.clientY };
    }

    function endPan(event: PointerEvent) {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      const target = event.currentTarget as HTMLDivElement;
      delete target.dataset.panning;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }

    function preventMiddleClick(event: MouseEvent) {
      if (event.button === 1) event.preventDefault();
    }

    node.addEventListener('pointerdown', startPan, true);
    node.addEventListener('pointermove', movePan);
    node.addEventListener('pointerup', endPan);
    node.addEventListener('pointercancel', endPan);
    node.addEventListener('lostpointercapture', endPan);
    node.addEventListener('auxclick', preventMiddleClick, true);
    return () => {
      node.removeEventListener('pointerdown', startPan, true);
      node.removeEventListener('pointermove', movePan);
      node.removeEventListener('pointerup', endPan);
      node.removeEventListener('pointercancel', endPan);
      node.removeEventListener('lostpointercapture', endPan);
      node.removeEventListener('auxclick', preventMiddleClick, true);
      delete node.dataset.panning;
    };
  }, [setPan]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;

    function handleWheel(event: WheelEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const activeZoom = anchor.current?.zoom ?? zoom;
      const current = activeZoom === 'fit'
        ? (stage.current?.getBoundingClientRect().width ?? canvasWidthAt100Percent) / canvasWidthAt100Percent * 100
        : Number(activeZoom);
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.current?.clientHeight ?? 1 : 1;
      const scaled = current * Math.exp(-event.deltaY * unit / 350);
      const next = Math.min(Number(canvasZoomLevels.at(-1)), Math.max(Number(canvasZoomLevels[0]), Math.round(scaled * 10) / 10));
      if (next !== current) zoomAt(`${next}`, { x: event.clientX, y: event.clientY });
    }

    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [zoom, zoomAt]);

  return { viewport, stage, changeZoom, resetPan };
}
