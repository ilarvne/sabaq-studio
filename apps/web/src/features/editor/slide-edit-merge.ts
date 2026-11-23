import type { Slide, SlideChanges } from '@sabaq/lesson/types';

type TextSlot = 'title' | 'body';
type Field = Exclude<keyof SlideChanges, 'richText' | 'bodyRuns'>;
export type ConflictField = { field: Field; yours: string; saved: string };

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value,index) => same(value,b[index]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const other = b as Record<string, unknown>;
  const entries = Object.entries(a);
  return entries.length === Object.keys(other).length &&
    entries.every(([key, value]) => Object.hasOwn(other, key) && same(value, other[key]));
}

function textField(slide: SlideChanges, slot: TextSlot) {
  return { text: slide[slot], doc: slide.richText?.[slot], runs: slot === 'body' ? slide.bodyRuns : undefined };
}

type TextField = ReturnType<typeof textField>;

export function slideEditBase(slide: Slide, changes: SlideChanges): SlideChanges {
  const keys = Object.keys(changes) as (keyof SlideChanges)[];
  if (keys.some(key => key === 'body' || key === 'title' || key === 'richText' || key === 'bodyRuns'))
    keys.push('body', 'title', 'richText', 'bodyRuns');
  return Object.fromEntries(keys.map(key => [key, slide[key]])) as SlideChanges;
}

function textForDisplay(value: unknown) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
}

export function rebaseSlideEdit(before: SlideChanges, changes: SlideChanges, saved: Slide) {
  const conflicts: ConflictField[] = [];
  const mine: SlideChanges = {};
  const merge: SlideChanges = {};
  for (const key of Object.keys(changes) as (keyof SlideChanges)[]) {
    if (key === 'title' || key === 'body' || key === 'richText' || key === 'bodyRuns') continue;
    const wanted = changes[key];
    if (wanted === undefined || same(wanted, before[key]) || same(wanted, saved[key])) continue;
    Object.assign(mine, {[key]: wanted});
    if (same(before[key], saved[key])) Object.assign(merge, {[key]: wanted});
    else conflicts.push({field:key, yours:textForDisplay(wanted), saved:textForDisplay(saved[key])});
  }

  function setText(result: SlideChanges, slot: TextSlot, value: TextField, current: TextField) {
    if (value.text !== undefined && value.text !== current.text) result[slot] = value.text;
    if (!same(value.doc, current.doc)) {
      result.richText ??= { ...saved.richText };
      if (value.doc) result.richText[slot] = value.doc;
      else delete result.richText[slot];
    } else if (current.doc && result[slot] !== undefined) {
      // The server clears old formatting when a plain-text edit supplies no replacement.
      result.richText ??= { ...saved.richText };
    }
    if (slot === 'body' && (!same(value.runs, current.runs) || (value.runs && result.body !== undefined)))
      result.bodyRuns = value.runs ?? [];
  }

  for (const slot of ['title', 'body'] as const) {
    const base = textField(before, slot);
    const text = changes[slot] ?? base.text;
    const plainChange = text !== base.text;
    const wanted: TextField = {
      text,
      doc: changes.richText?.[slot] ?? (plainChange ? undefined : base.doc),
      runs: slot === 'body' ? changes.bodyRuns ?? (plainChange ? undefined : base.runs) : undefined,
    };
    const current = textField(saved, slot);
    if (same(wanted, base) || same(wanted, current)) continue;
    setText(mine, slot, wanted, current);
    if (same(base, current)) setText(merge, slot, wanted, current);
    else if (wanted.text === current.text) {
      // Equal wording can still carry conflicting formatting.
      conflicts.push({field:slot, yours:textForDisplay(wanted), saved:textForDisplay(current)});
    } else conflicts.push({field:slot, yours:textForDisplay(wanted.text), saved:textForDisplay(current.text)});
  }
  return { conflicts, mine, merge };
}

export function describeSlideEdit(changes: SlideChanges, saved: Slide | undefined): ConflictField[] {
  return (Object.keys(changes) as (keyof SlideChanges)[]).flatMap(field =>
    field === 'richText' || field === 'bodyRuns' ? [] :
      [{field, yours:textForDisplay(changes[field]), saved:textForDisplay(saved?.[field])}]);
}
