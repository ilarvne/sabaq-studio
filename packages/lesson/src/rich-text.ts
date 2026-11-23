import type { JSONContent } from '@tiptap/core';
import type { RichRun } from './types';

export function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch {
    /* Incomplete addresses are displayed as plain text. */
  }
}

export function documentRuns(doc: JSONContent): RichRun[] {
  const runs: RichRun[] = [];
  function visit(node: JSONContent) {
    if (node.type === 'text' && node.text) {
      const marks = node.marks ?? [];
      const href = safeHref(marks.find((m) => m.type === 'link')?.attrs?.href);
      runs.push({
        text: node.text,
        ...(marks.some((m) => m.type === 'bold') ? { bold: true } : {}),
        ...(marks.some((m) => m.type === 'italic') ? { italic: true } : {}),
        ...(href ? { href } : {}),
      });
    } else if (node.type === 'hardBreak') {
      runs.push({ text: '\n' });
    } else {
      node.content?.forEach((child, i) => {
        if (i > 0 && ['doc', 'bulletList', 'orderedList', 'listItem'].includes(node.type || ''))
          runs.push({ text: '\n' });
        visit(child);
      });
    }
  }
  visit(doc);
  return runs;
}
