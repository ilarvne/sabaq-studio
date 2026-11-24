import type { AssistantCanvasScope } from '@sabaq/contracts/assistant';

const normalizeSpaces = (text:string) => text.replace(/[\u00a0\u202f]/gu,' ');

export function canvasTextSelection(element:HTMLElement, text:string):AssistantCanvasScope['selection'] {
  const selection=element.ownerDocument.getSelection();
  if(!selection || selection.isCollapsed || selection.rangeCount!==1) return;
  const range=selection.getRangeAt(0);
  if(!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
  const selected=normalizeSpaces(range.toString());
  if(!selected.trim()) return;
  const source=normalizeSpaces(text);
  const prefix=range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer,range.startOffset);
  const preceding=normalizeSpaces(prefix.toString());
  const prefixMatches=source.startsWith(preceding+selected);
  const start=prefixMatches ? preceding.length : source.indexOf(selected);
  if(start<0 || (!prefixMatches && source.indexOf(selected,start+1)!==-1)) return;
  const end=start+selected.length;
  return {start,end,text:text.slice(start,end)};
}
