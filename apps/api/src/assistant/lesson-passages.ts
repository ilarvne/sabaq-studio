import { createHash } from 'node:crypto';
import type { LessonCitation } from '@sabaq/contracts/retrieval';
import type { Deck, Slide } from '@sabaq/lesson/types';

const chunkSize = 640;
const overlap = 80;
const space = /\s/u;
type Location = Pick<LessonCitation,'kind' | 'field' | 'label' | 'slideId' | 'url' | 'sourceFileId'>;

function passages(deckId: string, location: Location, text?: string, offset = 0): LessonCitation[] {
  if (!text?.trim()) return [];
  const characters = Array.from(text);
  const chunks: LessonCitation[] = [];
  let cursor = 0;
  while (cursor < characters.length) {
    let end = Math.min(cursor + chunkSize, characters.length);
    if (end < characters.length) {
      let boundary = end;
      while (boundary > end - overlap && !space.test(characters[boundary])) boundary--;
      if (space.test(characters[boundary])) end = boundary;
    }
    let first = cursor;
    let last = end;
    while (first < last && space.test(characters[first])) first++;
    while (last > first && space.test(characters[last - 1])) last--;
    if (first < last) {
      const excerpt = characters.slice(first,last).join('');
      const start = first + offset, end = last + offset;
      const identity = [deckId,location.slideId ?? null,location.field,start,end,excerpt];
      const id = 'ref-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,24);
      chunks.push({ ...location, id, start, end, excerpt });
    }
    if (end === characters.length) break;
    cursor = end - overlap;
    // Start overlapping passages on a word boundary when one is available.
    let boundary = cursor;
    while (boundary < end && !space.test(characters[boundary])) boundary++;
    if (boundary < end) cursor = boundary + 1;
  }
  return chunks;
}

function slidePassages(deck: Deck, slide: Slide, index: number, includeAccessibility = false) {
  const prefix = {en:'Slide',ru:'Слайд',kk:'Слайд'}[deck.language];
  const label = `${prefix} ${index + 1} · ${slide.title}`;
  const from = (field: string, text?: string) => passages(deck.id,{kind:'slide',slideId:slide.id,label,field},text);
  const groups = [
    from('title',slide.title), from('body',slide.body), from('notes',slide.notes), from('answer',slide.answer),
    from('diagram',slide.diagram?.nodes.join('\n')),
    from('table',slide.table && [slide.table.headers,...slide.table.rows].map(row=>row.join(' | ')).join('\n')),
    from('chart',slide.chart && [slide.chart.alt,...slide.chart.series.map(series=>`${series.name}: ` +
      slide.chart!.categories.map((category,i)=>`${category} ${series.values[i]}`).join(', '))].join('\n')),
    from('design',[slide.design?.eyebrow,slide.design?.takeaway,...(slide.design?.cards ?? []).map(card=>`${card.title}\n${card.text}`)].filter(Boolean).join('\n')),
    from('image.alt',slide.image?.alt),
  ];
  if (includeAccessibility) {
    const imageText = {
      en:{decorative:'Decorative image',meaningful:'Meaningful image'},
      ru:{decorative:'Декоративное изображение',meaningful:'Значимое изображение'},
      kk:{decorative:'Сәндік сурет',meaningful:'Мазмұнды сурет'},
    }[deck.language];
    if (slide.image) {
      const accessibility = imageText[slide.image.decorative ? 'decorative' : 'meaningful'];
      groups.push(from('image.accessibility',[accessibility,slide.image.alt].filter(Boolean).join(' · ')));
    }
    groups.push(from('chart.alt',slide.chart?.alt));
  }
  return groups;
}

export function lessonPassages(deck: Deck): LessonCitation[] {
  const research = deck.research?.sources;
  let source: LessonCitation[] = [];
  if (deck.source && research?.length && research.map(s=>s.excerpt).join('\n\n') === deck.source.text) {
    let offset = 0;
    for (const item of research) {
      source.push(...passages(deck.id,{kind:'source',field:'source.text',label:item.title,url:item.url},item.excerpt,offset));
      offset += Array.from(item.excerpt).length + 2;
    }
  } else if (deck.source) {
    source = passages(deck.id,{kind:'source',field:'source.text',label:deck.source.name},deck.source.text);
  }
  return source.concat(deck.slides.flatMap((slide,index)=>slidePassages(deck,slide,index).flat()));
}

export function libraryFilePassages(file: {id:string;name:string;text:string}) {
  return passages(file.id,{kind:'source',field:'attachment.text',label:file.name,sourceFileId:file.id},file.text);
}

export function readLessonSlide(deck: Deck, slideId: string, fields?: readonly string[]): LessonCitation[] {
  const index = deck.slides.findIndex(slide=>slide.id === slideId);
  if (index < 0) return [];
  const groups = slidePassages(deck,deck.slides[index],index,Boolean(fields?.includes('image.accessibility')))
    .filter(group => group.length && (!fields || fields.includes(group[0].field)));
  return [...groups.map(group=>group[0]),...groups.flatMap(group=>group.slice(1))].slice(0,8);
}

export function readLessonOutline(deck: Deck, start: number, count: number): LessonCitation[] {
  const label = {en:'Lesson outline',ru:'План урока',kk:'Сабақ жоспары'}[deck.language];
  const length = {en:'Outline items',ru:'Пункты плана',kk:'Жоспар тармақтары'}[deck.language];
  const overview = `${length}: ${deck.outline.length}`;
  const rows = deck.outline.map((item,index) => `${index+1}. ${item.title} · ${item.summary}`);
  let offset = Array.from(overview).length + 1;
  const result = passages(deck.id,{kind:'slide',field:'outline',label},overview);
  for (let index=0; index<rows.length; index++) {
    const row = rows[index];
    if (index >= start - 1 && index < start - 1 + count) {
      const slideId = deck.slides.find(slide => slide.id === deck.outline[index].id)?.id;
      result.push(...passages(deck.id,{kind:'slide',field:'outline',label,slideId},row,offset).slice(0,1));
    }
    offset += Array.from(row).length + 1;
  }
  return result;
}
