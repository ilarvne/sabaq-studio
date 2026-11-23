import { useCallback, useEffect, useRef, useState } from 'react';
import type { Deck, EditOp, Slide, SlideChanges } from '@sabaq/lesson/types';
import { ApiError, request } from '@/lib/api';
import { describeSlideEdit, rebaseSlideEdit, slideEditBase } from './slide-edit-merge';

type Pending = { id: string; op: EditOp; at: number; sent?: boolean; baseRevision?: number; before?: SlideChanges };
type Direction = 'undo' | 'redo';
type HistoryRequest = { direction: Direction; revision: number; baseRevision: number; operationId: string };
const historyLimit = 100;
const prefix = (id: string) => 'sabaq:edit:' + id + ':';

function readJournal(id: string): Pending[] {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(prefix(id))).flatMap(key => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? [JSON.parse(raw) as Pending] : [];
      } catch { return []; }
    }).sort((a, b) => a.at - b.at);
  } catch { return []; }
}

function writeBackup(run: (store: IDBObjectStore) => void) {
  if (!globalThis.indexedDB) return;
  const open = indexedDB.open('sabaq-studio', 2);
  open.onupgradeneeded = () => open.result.createObjectStore('operations');
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('operations', 'readwrite');
    run(tx.objectStore('operations'));
    tx.oncomplete = tx.onabort = () => db.close();
  };
}

function persist(id: string, item: Pending) {
  const key = prefix(id) + item.id;
  // One small synchronous record survives immediate tab close and cannot replace another tab's edit.
  try { localStorage.setItem(key, JSON.stringify(item)); } catch { /* IndexedDB can still succeed. */ }
  writeBackup(store => store.put(item, key));
}

function discard(id: string, operationId: string) {
  const key = prefix(id) + operationId;
  try { localStorage.removeItem(key); } catch { /* Also remove the indexed copy. */ }
  writeBackup(store => store.delete(key));
}

function readBackup(id: string): Promise<Pending[]> {
  return new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve([]); return; }
    const open = indexedDB.open('sabaq-studio', 2);
    open.onupgradeneeded = () => open.result.createObjectStore('operations');
    open.onerror = () => resolve([]);
    open.onblocked = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      const start = prefix(id);
      const request = db.transaction('operations').objectStore('operations').getAll(IDBKeyRange.bound(start,start+'\uffff'));
      request.onsuccess = () => {
        resolve((request.result as Pending[]).sort((a,b)=>a.at-b.at));
        db.close();
      };
      request.onerror = () => { resolve([]); db.close(); };
    };
  });
}

function applySlideDraft(slide: Slide, changes: SlideChanges): Slide {
  const next = { ...slide, ...changes };
  if(changes.powerPointLayoutId===null || (changes.layout && !changes.powerPointLayoutId)) delete next.powerPointLayoutId;
  const bodyChanged = changes.body !== undefined && changes.body !== slide.body;
  const titleChanged = changes.title !== undefined && changes.title !== slide.title;
  if (bodyChanged && !changes.bodyRuns) delete next.bodyRuns;
  if (next.richText && !changes.richText && (bodyChanged || titleChanged)) {
    next.richText = { ...next.richText };
    if (bodyChanged) delete next.richText.body;
    if (titleChanged) delete next.richText.title;
  }
  return next;
}

function applyLocal(deck: Deck, op: EditOp): Deck {
  if (op.kind === 'slide') return { ...deck, slides: deck.slides.map(s => s.id === op.slideId ? applySlideDraft(s,op.changes) : s) };
  if (op.kind === 'outline') return { ...deck, outline: op.outline };
  if (op.kind === 'deck') return { ...deck, title: op.title ?? deck.title, theme: op.theme ?? deck.theme,
    imageStyle:op.imageStyle===null ? undefined : op.imageStyle ?? deck.imageStyle,
    ...(op.theme && op.theme!==deck.theme && {brand:undefined,powerPointStyle:undefined}) };
  if (op.kind === 'reorder') {
    const slides = op.slideIds.map(id => deck.slides.find(s => s.id === id)).filter(s => s !== undefined);
    return slides.length === deck.slides.length ? { ...deck, slides } : deck;
  }
  return deck;
}

export function useDeck(initial: Deck) {
  const source = useRef(initial);
  const queue = useRef<Pending[]>(readJournal(initial.id));
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(false);
  const undo = useRef<EditOp[]>([]);
  const history = useRef({head: initial.revision, undo: [] as number[], redo: [] as number[]});
  const restoring = useRef(false);
  const pendingRestore = useRef<HistoryRequest | undefined>(undefined);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState(0);
  const localOps = useRef(new Set<string>());
  const rememberRevision = useCallback((revision:number) => {
    const h = history.current;
    if (revision <= h.head) return;
    if (h.head !== revision - 1) h.undo = [];
    h.redo = [];
    h.undo.push(revision - 1);
    if (h.undo.length > historyLimit) h.undo.shift();
    h.head = revision;
  },[]);
  const [deck, setDeck] = useState(() => queue.current.reduce((value, item) => applyLocal(value, item.op), initial));
  const [status, setStatus] = useState<'saved'|'saving'|'offline'|'conflict'>(queue.current.length ? 'saving' : 'saved');
  const conflicted = useRef(false);
  const refresh = useCallback(() => {
    if (mounted.current) setDeck(queue.current.reduce((value, item) => applyLocal(value, item.op), source.current));
  }, []);

  const receive = useCallback((next: Deck) => {
    if (next.revision >= source.current.revision) {
      source.current = next;
      refresh();
    }
  }, [refresh]);

  const removeHead = useCallback((item: Pending) => {
    queue.current.shift();
    discard(initial.id,item.id);
    return localOps.current.delete(item.id);
  }, [initial.id]);

  const replaceHead = useCallback((item: Pending, op: EditOp, base: Pick<Pending, 'before'|'baseRevision'>) => {
    // A sent operation may already have a receipt. Never send different content under that id.
    const id = item.sent ? crypto.randomUUID() : item.id;
    const next = { ...item, ...base, id, op, sent:false };
    queue.current[0] = next;
    persist(initial.id,next);
    if (id !== item.id) {
      if (localOps.current.delete(item.id)) localOps.current.add(id);
      discard(initial.id,item.id);
    }
  }, [initial.id]);

  const rebaseDisjointSlide = useCallback((item: Pending) => {
    const {op,before} = item;
    if (op.kind !== 'slide' || before === undefined) return false;
    const saved = source.current.slides.find(slide => slide.id === op.slideId);
    if (saved?.status !== 'ready' || saved.version === op.baseVersion) return false;
    const {merge,conflicts} = rebaseSlideEdit(before,op.changes,saved);
    if (conflicts.length) return false;
    if (Object.keys(merge).length) {
      replaceHead(item,{...op,baseVersion:saved.version,changes:merge},{before:slideEditBase(saved,merge)});
    } else removeHead(item);
    refresh();
    return true;
  }, [removeHead,replaceHead,refresh]);

  const flush = useCallback(function flushQueue(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (conflicted.current) return Promise.resolve(false);
    if (!queue.current.length) {
      if (mounted.current) setStatus('saved');
      return Promise.resolve(true);
    }
    const delivery = async () => {
      try {
        while (queue.current.length) {
          const item = queue.current[0];
          const {id, op} = item;
          if (!item.sent && rebaseDisjointSlide(item)) continue;
          if (!item.sent) {
            item.sent = true;
            persist(initial.id,item);
          }
          if (mounted.current) setStatus('saving');
          let editRevision: number | undefined;
          let delivered: Deck;
          try {
            delivered = await request<Deck>('/decks/' + initial.id, {
              method: 'PATCH', body: { operationId: id, op, baseRevision: item.baseRevision },
              onSuccess(headers) {
                const revision = headers.get('X-Sabaq-Edit-Revision');
                if (revision && /^\d+$/.test(revision)) editRevision = Number(revision);
              },
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 409 && error.body.deck) {
              receive(error.body.deck);
              if (rebaseDisjointSlide(item)) continue;
            }
            throw error;
          }
          const wasLocal = removeHead(item);
          if (wasLocal && editRevision !== undefined) rememberRevision(editRevision);
          const nextOutline = queue.current.find(pending=>pending.op.kind==='outline');
          if (wasLocal && nextOutline && localOps.current.has(nextOutline.id) && !nextOutline.sent && nextOutline.baseRevision === item.baseRevision &&
              item.baseRevision !== undefined && delivered.revision === item.baseRevision + 1) {
            nextOutline.baseRevision=delivered.revision;
            persist(initial.id,nextOutline);
          }
          receive(delivered);
          refresh();
        }
        if (mounted.current) setStatus('saved');
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          if (error.body.deck) receive(error.body.deck);
          conflicted.current = true;
          if (mounted.current) setStatus('conflict');
        } else {
          if (mounted.current) {
            setStatus('offline');
            timer.current = window.setTimeout(flushQueue, 2500);
          }
        }
        return false;
      }
    };
    saving.current=delivery().finally(()=>{saving.current=null;});
    return saving.current;
  }, [initial.id, rebaseDisjointSlide, receive, refresh, rememberRevision, removeHead]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readBackup(initial.id).then(items => {
      if (!active) return;
      const journal = new Map([...items,...readJournal(initial.id),...queue.current].map(item => [item.id,item]));
      queue.current = [...journal.values()].sort((a,b) => a.at-b.at);
      refresh();
      void flush();
    }).catch(() => { if (active) void flush(); });
    const events = new EventSource('/api/decks/' + initial.id + '/events');
    const sync = () => void request<Deck>('/decks/' + initial.id).then(receive).catch(() => undefined);
    // Re-read on both refresh and replay. The persisted revision prevents an older request from winning.
    events.onopen = sync;
    events.onmessage = sync;
    const online = () => { sync(); void flush(); };
    window.addEventListener('online', online);
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(timer.current);
      events.close();
      window.removeEventListener('online', online);
      if (queue.current.length) void flush();
    };
  }, [flush, initial.id, receive, refresh]);

  const submit = useCallback((op: EditOp) => {
    const last = queue.current.at(-1);
    const canCombine = last && !last.sent && localOps.current.has(last.id);
    const lastSlide = last?.op.kind === 'slide' ? last.op : undefined;
    if (canCombine && op.kind === 'outline' && last.op.kind === 'outline') {
      last.op = op;
      persist(initial.id,last);
    } else if (canCombine && last.before && op.kind === 'slide' && lastSlide?.slideId === op.slideId &&
      Object.keys(op.changes).every(key => Object.hasOwn(lastSlide.changes,key))) {
      lastSlide.changes = { ...lastSlide.changes, ...op.changes };
      persist(initial.id,last);
    } else {
      let before: SlideChanges | undefined;
      if (op.kind==='slide') {
        let draft=source.current.slides.find(slide => slide.id === op.slideId);
        if (draft) {
          for (const item of queue.current)
            if (item.op.kind==='slide' && item.op.slideId===op.slideId) draft=applySlideDraft(draft,item.op.changes);
          before=slideEditBase(draft,op.changes);
        }
      }
      const item: Pending = {id: crypto.randomUUID(), op, at: Date.now(),
        ...(before && {before}),
        ...(op.kind==='outline' ? {baseRevision:source.current.revision} : {})};
      localOps.current.add(item.id);
      queue.current.push(item);
      persist(initial.id,item);
    }
    refresh();
    if (!conflicted.current) setStatus('saving');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 250);
  }, [flush, initial.id, refresh]);

  const remember = (id: string, changes: SlideChanges) => {
    const version = source.current.slides.find(slide => slide.id === id)?.version;
    if (version === undefined) return;
    undo.current.push({kind: 'slide', slideId: id, baseVersion: version, changes});
    if (undo.current.length > historyLimit) undo.current.shift();
  };
  const edit = (id: string, changes: SlideChanges) => {
    const before = deck.slides.find(slide => slide.id === id);
    const version = source.current.slides.find(slide => slide.id === id)?.version;
    if (!before || version === undefined) return;
    const previous = Object.fromEntries(Object.keys(changes).map(field => [field, before[field as keyof SlideChanges]])) as SlideChanges;
    if (deck.phase !== 'editing') remember(id, previous);
    submit({ kind: 'slide', slideId: id, baseVersion: version, changes });
  };
  const restoreStep = async (direction:Direction) => {
    if (restoring.current) return;
    const previous = pendingRestore.current;
    if (previous && previous.direction !== direction) return;
    restoring.current = true;
    setHistoryBusy(true);
    try {
      if (!(await flush())) return;
      const h = history.current;
      let step = previous;
      if (!step) {
        const revision = h[direction].at(-1);
        if (revision === undefined) return;
        if (source.current.revision !== h.head) {
          h.undo = [];
          h.redo = [];
          setHistoryError((count) => count + 1);
          return;
        }
        step = { direction, revision, baseRevision: h.head, operationId: crypto.randomUUID() };
        pendingRestore.current = step;
      }
      const next = await request<Deck>('/decks/' + initial.id + '/revisions/' + step.revision + '/restore', {
        method: 'POST',
        body: { baseRevision: step.baseRevision, intent: direction, operationId: step.operationId },
      });
      pendingRestore.current = undefined;
      if (h.head === step.baseRevision) {
        h[direction].pop();
        h[direction === 'undo' ? 'redo' : 'undo'].push(h.head);
        h.head = next.revision;
      }
      receive(next);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        pendingRestore.current = undefined;
        if (err.body.deck) receive(err.body.deck);
        history.current.undo = [];
        history.current.redo = [];
      }
      setHistoryError((count) => count + 1);
    } finally {
      restoring.current = false;
      setHistoryBusy(false);
    }
  };
  const receiveAssistant = (next:Deck, appliedRevision?:number, restoredRevision?:number) => {
    if (restoredRevision !== undefined && restoredRevision === next.revision && restoredRevision > history.current.head) {
      const h = history.current;
      if (h.head === restoredRevision - 1 && h.undo.at(-1) === restoredRevision - 2) h.undo.pop();
      else h.undo = [];
      h.redo = [restoredRevision - 1];
      h.head = restoredRevision;
    }
    if (appliedRevision !== undefined && next.phase === 'editing') rememberRevision(appliedRevision);
    receive(next);
  };
  const undoLast = () => {
    if (source.current.phase==='editing') { void restoreStep('undo'); return; }
    const op = undo.current.pop();
    if (!op || op.kind !== 'slide') return;
    const version = source.current.slides.find(slide => slide.id === op.slideId)?.version;
    if (version !== undefined) submit({ ...op, baseVersion: version });
  };
  const resolve = (keep: boolean) => {
    const item = queue.current[0];
    if (item) {
      const itemOp = item.op;
      const current = itemOp.kind === 'slide' && source.current.slides.find(slide => slide.id === itemOp.slideId);
      if (itemOp.kind === 'slide' && current && current.status === 'ready') {
        const planned = item.before && rebaseSlideEdit(item.before,itemOp.changes,current);
        const changes = planned ? (keep ? planned.mine : planned.merge) : keep ? itemOp.changes : {};
        if (Object.keys(changes).length)
          replaceHead(item,{...itemOp,baseVersion:current.version,changes},{before:slideEditBase(current,changes)});
        else removeHead(item);
      } else if (keep && itemOp.kind === 'outline' && source.current.phase === 'outline') {
        replaceHead(item,itemOp,{baseRevision:source.current.revision});
      } else {
        removeHead(item);
      }
    }
    conflicted.current = false;
    refresh();
    void flush();
  };

  const currentHistory = history.current.head === source.current.revision;
  const sessionRestore = pendingRestore.current?.direction;
  const canRestore = !historyBusy && !conflicted.current;
  const canUndo = canRestore && (source.current.phase !== 'editing' ? undo.current.length > 0 :
    sessionRestore === 'undo' || !sessionRestore && (localOps.current.size > 0 || currentHistory && history.current.undo.length > 0));
  const canRedo = canRestore && source.current.phase === 'editing' &&
    (sessionRestore === 'redo' || !sessionRestore && localOps.current.size === 0 && currentHistory && history.current.redo.length > 0);

  const pending = conflicted.current ? queue.current[0] : undefined;
  const pendingOp = pending?.op;
  const saved = pendingOp?.kind === 'slide' ? source.current.slides.find(slide => slide.id === pendingOp.slideId) : undefined;
  const slideConflict = saved && pending?.before && pendingOp?.kind === 'slide' && saved.version !== pendingOp.baseVersion
    ? rebaseSlideEdit(pending.before,pendingOp.changes,saved) : undefined;
  const conflictFields = pendingOp?.kind === 'slide'
    ? (slideConflict?.conflicts.length ? slideConflict.conflicts : describeSlideEdit(pendingOp.changes,saved)) : [];
  const canKeepConflict = saved?.status === 'ready' || pendingOp?.kind === 'outline' && source.current.phase === 'outline';
  return {
    deck, status, receive, receiveAssistant, submit, edit, undoLast, redoLast: () => void restoreStep('redo'),
    resolve, flush, canUndo, canRedo, historyError, conflictFields, canKeepConflict,
  };
}
