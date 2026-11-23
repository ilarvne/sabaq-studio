import type { Locale } from './types';

export const diagramKinds = ['timeline', 'process', 'mind-map'] as const;
export type DiagramKind = typeof diagramKinds[number];
export type SlideDiagram = { kind: DiagramKind; nodes: string[]; alt?: string };
export const diagramLabelLimit = 140;
export const diagramAltLimit = 1000;
export const diagramNames: Record<Locale, Record<DiagramKind, string>> = {
  en: { timeline:'Timeline', process:'Process', 'mind-map':'Mind map' },
  ru: { timeline:'Хронологическая шкала', process:'Процесс', 'mind-map':'Интеллект-карта' },
  kk: { timeline:'Уақыт шкаласы', process:'Үдеріс', 'mind-map':'Ой картасы' },
};
export const mindMapLabels = {
  en: {root:'Main idea', branch:'Branch'},
  ru: {root:'Главная идея', branch:'Ветвь'},
  kk: {root:'Негізгі ой', branch:'Тармақ'},
};

export function diagramDescription(diagram: SlideDiagram, language: Locale) {
  if (diagram.alt?.trim()) return diagram.alt.trim();
  const roles = mindMapLabels[language];
  const sequence = diagram.nodes.map((node, index) => diagram.kind === 'mind-map'
    ? (index === 0 ? roles.root : roles.branch) + '. ' + node
    : (index + 1) + '. ' + node);
  return [diagramNames[language][diagram.kind], ...sequence].join('. ');
}

// Keep the author's wording and order. Prioritize explicit list boundaries over punctuation inside an item.
export function selectionNodes(text: string) {
  const selected = text.trim();
  const enumerated = selected.replace(/(?:^|\s)(?:[•▪◦]|\d{1,2}[.)](?=\s))\s*/gu, '\n');
  let items = enumerated.split(/\r?\n/u).filter(line=>line.trim().length);
  if (items.length < 3) items = enumerated.split(/[\n;]+/u).filter(line=>line.trim().length);
  if (items.length < 3) items = enumerated.split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u).filter(line=>line.trim().length);
  return items.map(item => item.replace(/^\s*[-–—]\s+/u, '').trim());
}

export type NodeBox = {x:number; y:number; w:number; h:number};
export type DiagramEdge = {x1:number; y1:number; x2:number; y2:number};
const box = (cx:number,cy:number,w:number,h:number):NodeBox => ({x:cx-w/2,y:cy-h/2,w,h});
const edge = (x1:number,y1:number,x2:number,y2:number):DiagramEdge=>({x1,y1,x2,y2});

export function diagramGeometry(kind:DiagramKind, count:number) {
  if (!Number.isInteger(count) || count < 3 || count > 7) throw new RangeError('A diagram requires 3–7 nodes.');
  const boxes:NodeBox[] = [], edges:DiagramEdge[] = [];
  if (kind === 'timeline') {
    const width = Math.min(29, 164 / count);
    const x = (i:number) => width / 2 + (100 - width) * i / (count - 1);
    edges.push(edge(x(0),50,x(count-1),50));
    for(let i=0;i<count;i++) {
      const upper = i % 2 === 0;
      boxes.push(box(x(i),upper ? 20 : 80,width,38));
      edges.push(edge(x(i),50,x(i),upper ? 39 : 61));
    }
  } else if (kind === 'process') {
    const cols = count <= 4 ? count : Math.ceil(count / 2);
    const step = 100 / cols, w = step-4, twoRows = count>cols;
    for(let i=0;i<count;i++) {
      const row = Math.floor(i/cols), col = row ? cols-1-i%cols : i%cols;
      boxes.push(box((col+.5)*step,twoRows ? (row ? 76 : 24) : 50,w,twoRows ? 40 : 60));
      if (!i) continue;
      const prev = boxes[i-1], next=boxes[i];
      if(i===cols) edges.push(edge(next.x+w/2,prev.y+prev.h,next.x+w/2,next.y));
      else if(row) edges.push(edge(prev.x,prev.y+prev.h/2,next.x+w,next.y+next.h/2));
      else edges.push(edge(prev.x+w,prev.y+prev.h/2,next.x,next.y+next.h/2));
    }
  } else {
    boxes.push(box(50,50,28,35));
    const left = Math.ceil((count-1)/2);
    for(let i=1;i<count;i++) {
      const isLeft=i<=left, total=isLeft ? left : count-1-left, idx=isLeft ? i-1 : i-left-1;
      const cy=total===1 ? 50 : 15 + 70*idx/(total-1);
      boxes.push(box(isLeft ? 14 : 86, cy,28,28));
      edges.push(edge(isLeft ? 36 : 64,50,isLeft ? 28 : 72,cy));
    }
  }
  return {boxes,edges};
}
