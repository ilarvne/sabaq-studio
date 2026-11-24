import type { DiagramKind } from '@sabaq/lesson/diagram';
import type { Layout, OutlineItem, Slide, SlideRole } from '@sabaq/lesson/types';

const layoutGuide = {
  cover: { purpose: 'Lesson opening or section conclusion with a short subtitle', words: 30 },
  body: { purpose: 'Definition, explanation, or classroom prompt with optional short cards', words: 65 },
  quote: { purpose: 'A sourced quotation or a short takeaway that deserves emphasis', words: 30 },
  centered: { purpose: 'Single question, instruction, or headline with a short description', words: 40 },
  stacked: { purpose: 'Longer explanation with full-width text above supporting material', words: 80 },
  split: { purpose: 'Comparison or explanation alongside cards, a visual, or a worked example', words: 45 },
  'native-table': { purpose: 'Rows and columns whose exact labels or values need to be read', words: 24 },
  'data-chart': { purpose: 'Compare supplied measurements with shared categories and numeric series', words: 24 },
  'image-left': { purpose: 'Explain a subject with a focused image on the left', words: 40 },
  'image-right': { purpose: 'Explain a subject with a focused image on the right', words: 40 },
  'image-full': { purpose: 'Full-frame scene with a brief title and one short line', words: 20 },
  'image-section': { purpose: 'Start a new section with one wide supporting image', words: 28 },
  'image-grid': { purpose: 'Compare two or three distinct scenes or specimens the student needs to see together', words: 28 },
} satisfies Partial<Record<Layout, { purpose: string; words: number }>>;

export const generationRoleGuide = {
  opening: { purpose: 'Introduce the lesson question or open a new section', layout: 'cover' },
  definition: { purpose: 'Name and explain one concept', layout: 'body' },
  examples: { purpose: 'Compare cases or show a worked example', layout: 'split' },
  reflection: { purpose: 'Ask one question for students to think about', layout: 'centered' },
  activity: { purpose: 'Explain a task or sequence of steps', layout: 'stacked' },
  recap: { purpose: 'Highlight the key finding or lesson takeaway', layout: 'quote' },
  closing: { purpose: 'End with one memorable conclusion', layout: 'quote' },
} as const satisfies Record<SlideRole, { purpose: string; layout: Layout }>;

export function isImageLayout(layout: Layout) {
  return layout.startsWith('image-') || layout === 'avatar-right';
}

export function generationLayoutChoices(allowImages: boolean) {
  return Object.fromEntries(Object.entries(layoutGuide).filter(([layout]) =>
    allowImages || !isImageLayout(layout as Layout),
  ));
}

export function layoutWordBudget(layout: Layout) {
  return layoutGuide[layout as keyof typeof layoutGuide]?.words ?? layoutGuide.body.words;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function fitsFullBleedCopy(title: string, body: string) {
  const text = body.trim();
  return title.trim().length <= 90 && text.length <= 140 &&
    text.split(/\r?\n/u).filter(line => line.trim()).length <= 2 && wordCount(text) <= layoutWordBudget('image-full');
}

export function retainRequestedChart<T extends Pick<OutlineItem, 'layout' | 'title' | 'summary' | 'assessment' | 'diagramKind'>>(items: T[], topic: string): T[] {
  const chart = /\b(?:bar|column) (?:chart|graph)\b|столбчат\p{L}*\s+диаграмм|баған\p{L}*\s+диаграмм/iu;
  const imperative = /\b(?:add|include|make|create|show|plot|compare|display|visuali[sz]e)\b|покаж|сравнит|добав|построй|салыстыр|көрсет|қосыңыз|құрыңыз/iu;
  const excludesChart = /\b(?:without|no|omit|skip|never|don't|do not)\b.{0,32}(?:chart|graph)|(?:без|не\s+используйте).{0,32}диаграмм|диаграмм.{0,24}(?:қоспа|қолданба)|диаграммасыз/iu;
  const quantities = topic.match(/[+−-]?\d+(?:[.,]\d+)?/gu) ?? [];
  if (!chart.test(topic) || !imperative.test(topic) || excludesChart.test(topic) || quantities.length < 2 ||
      items.some(item => item.layout === 'data-chart')) return items;

  const candidates = items.map((item,index) => ({item,index})).filter(({item,index}) => !item.assessment && !item.diagramKind && (index > 0 || items.length === 1));
  const candidate = candidates.find(({item}) => chart.test(`${item.title} ${item.summary}`)) ??
    candidates.find(({item}) => item.layout === 'split' || item.layout === 'native-table') ?? candidates[0];
  return candidate ? items.map((item,index) => index === candidate.index ? {...item,layout:'data-chart'} : item) : items;
}

const diagramWords = /(?<!\p{L})(?:diagrams?|flowcharts?|mind[ -]maps?|timelines?|схем\p{L}*|блок-схем\p{L}*|ментальн\p{L}*\s+карт\p{L}*|интеллект-карт\p{L}*|(?:временн|хронологическ)\p{L}*\s+шкал\p{L}*|сызба\p{L}*|уақыт\s+(?:сызығ|шкал)\p{L}*|ой\s+карт\p{L}*)(?!\p{L})/iu;

export function retainRequestedDiagram<T extends Pick<OutlineItem,'title' | 'summary' | 'assessment' | 'layout' | 'role' | 'diagramKind'>>(items:T[], topic:string, closingCheck = false):T[] {
  const withoutDiagram = /\b(?:no|without|omit|skip|don't|do not)\b[^.!?;,]{0,35}(?:diagram|flowchart|mind[ -]map|timeline)|(?:без|не\s+используйте)[^.!?;,]{0,35}(?:схем|карт|шкал)|сызбасыз|сызба[^.!?;,]{0,25}(?:қоспа|қолданба)/iu;
  if (withoutDiagram.test(topic)) return items.map(item => item.diagramKind ? {...item,diagramKind:undefined} : item);
  const requested = diagramWords.test(topic);
  const kind:DiagramKind = /timeline|(?:временн|хронологическ)\p{L}*\s+шкал|уақыт\s+(?:сызығ|шкал)/iu.test(topic) ? 'timeline'
    : /mind[ -]map|ментальн\p{L}*\s+карт|интеллект-карт|ой\s+карт/iu.test(topic) ? 'mind-map' : 'process';
  const reserved = closingCheck && items.length > 1 ? items.length - 1 : undefined;
  const alreadyPlanned = items.some((item,index) => index !== reserved && item.diagramKind && (kind === 'process' || item.diagramKind === kind));
  const candidates = items.map((item,index) => ({item,index})).filter(({item,index}) =>
    index !== reserved && item.layout !== 'data-chart' && item.layout !== 'native-table' &&
    (items.length <= 2 || index > 0 && !item.assessment));
  const selected = requested && !alreadyPlanned && (candidates.find(({item}) => diagramWords.test(`${item.title} ${item.summary}`)) ??
    candidates.find(({item}) => item.role === 'activity') ?? candidates.find(({item}) => item.layout === 'split' || item.layout === 'stacked') ?? candidates[0]);

  return items.map((item,index) => {
    if (index === reserved) return item.diagramKind ? {...item,diagramKind:undefined} : item;
    const diagramKind = selected && selected.index === index ? kind : item.diagramKind;
    if (!diagramKind) return item;
    return {...item,diagramKind,layout:item.layout === 'split' ? 'split' : 'stacked'};
  });
}

export function planOutlineLayouts(items: OutlineItem[], allowImage: (index: number) => boolean, allowFullBleed = true) {
  const planned = items.reduce<OutlineItem[]>((planned, item, index) => {
    let layout = item.layout;
    if ((layout === 'image-grid' && !item.imageScenes?.length) || layout === 'avatar-right') layout = 'image-right';
    if (isImageLayout(layout) && !allowImage(index)) layout = 'body';

    const previous = planned.at(-1);
    const repeated = layout === previous?.layout && layout === planned.at(-2)?.layout;
    if (repeated && !item.diagramKind && (layout === 'body' || layout === 'centered' || layout === 'stacked' || layout === 'split')) {
      layout = layout === 'stacked' ? 'body' : 'stacked';
    } else if (repeated && (layout === 'image-left' || layout === 'image-right')) {
      layout = layout === 'image-left' ? 'image-right' : 'image-left';
    } else if (repeated && allowFullBleed && (layout === 'image-full' || layout === 'image-section')) {
      layout = 'image-right';
    }
    planned.push(layout === item.layout ? item : { ...item, layout });
    return planned;
  }, []);
  if (allowFullBleed && !planned.some(item => item.layout === 'image-full')) {
    const photo = planned.findIndex((item, index) => {
      if (!allowImage(index) || item.assessment || !item.visualDescription?.trim() ||
        (item.layout !== 'image-left' && item.layout !== 'image-right')) return false;
      const startsSection = Boolean(item.section && item.section !== planned[index - 1]?.section);
      const standalone = item.role === 'opening' || (!item.role && !item.section) || startsSection;
      return standalone && fitsFullBleedCopy(item.title,item.summary);
    });
    if (photo !== -1) planned[photo] = { ...planned[photo], layout: 'image-full' };
  }
  if (!planned.some(item => item.layout === 'quote')) {
    const conclusion = /\b(?:summary|recap|conclusion|takeaway)\b|итог|вывод|қорытынды|тұжырым/iu;
    const focus = planned.findLastIndex((item,index) => index > 0 && !item.assessment && !item.diagramKind &&
      (item.layout === 'body' || item.layout === 'stacked' || item.layout === 'centered') &&
      conclusion.test([item.title,item.section].filter(Boolean).join(' ')));
    if (focus !== -1) planned[focus] = { ...planned[focus], layout: 'quote' };
  }
  return planned;
}

type SlideContent = Pick<Slide, 'title' | 'body' | 'chart' | 'table' | 'diagram' | 'image' | 'additionalImages'>;

export function fitGeneratedLayout(preferred: Layout, content: SlideContent): Layout {
  if (content.chart || content.table) {
    return content.table && (preferred === 'native-table' || !content.chart) ? 'native-table' : 'data-chart';
  }
  if (content.diagram) return preferred === 'split' ? preferred : 'stacked';

  const words = wordCount(content.body);
  if (preferred === 'native-table' || preferred === 'data-chart') {
    return content.image ? 'image-right' : words > layoutWordBudget('body') ? 'stacked' : 'body';
  }
  if (isImageLayout(preferred)) {
    if (!content.image) return words > layoutWordBudget('body') ? 'stacked' : 'body';
    if (words > layoutWordBudget('image-right') ||
      (preferred === 'image-full' && !fitsFullBleedCopy(content.title,content.body))) return 'split';
    if ((preferred === 'image-grid' && !content.additionalImages?.length) || preferred === 'avatar-right') return 'image-right';
  }
  if ((preferred === 'body' || preferred === 'quote' || preferred === 'centered' || preferred === 'image-section') &&
      words > layoutWordBudget(preferred)) {
    return content.image ? 'image-right' : 'stacked';
  }
  return preferred;
}
