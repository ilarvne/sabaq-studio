import { slideImages, type Deck, type Locale, type PowerPointStyle, type Slide, type SlideArtwork, type Theme } from './types';

export function templateFont(source:string,target:'canvas'|'office') {
  const name=source.trim().toLowerCase();
  const serif=/serif|cambria|times|georgia|garamond|baskerville|book antiqua/i.test(name) && !name.includes('sans');
  if (target==='canvas') return serif ? 'Noto Serif' : name.includes('golos') ? 'Golos Text Variable' : 'IBM Plex Sans';
  const portable=['Arial','Calibri','Cambria','Times New Roman'].find(font=>font.toLowerCase()===name);
  return portable ?? (serif ? 'Cambria' : 'Arial');
}

export function powerPointVisualStyle(style:PowerPointStyle|undefined,layoutId?:string|null) {
  const masterId=layoutId && style?.layouts.find(layout=>layout.id===layoutId)?.masterId;
  return (masterId && style?.masters?.find(master=>master.id===masterId)) || style;
}

export function lessonPalette(deck: Pick<Deck,'theme'|'brand'|'powerPointStyle'>,layoutId?:string|null) {
  const preset = themePresets[deck.theme] ?? themePresets.notebook;
  const template=powerPointVisualStyle(deck.powerPointStyle,layoutId);
  if (template) {
    const {paper,ink,accent,tint} = template;
    return {...preset,paper,ink,accent,tint};
  }
  return deck.brand ? {...preset, paper:deck.brand.paper, ink:deck.brand.ink, accent:deck.brand.ink, tint:deck.brand.paper} : preset;
}

export function brandContrast(paper:string, ink:string) {
  const luminance = (hex:string) => {
    const [r,g,b] = [1,3,5].map(offset => {
      const channel = parseInt(hex.slice(offset,offset+2),16)/255;
      return channel <= 0.04045 ? channel/12.92 : ((channel+0.055)/1.055)**2.4;
    });
    return 0.2126*r+0.7152*g+0.0722*b;
  };
  const a=luminance(paper), b=luminance(ink);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

export type ThemePreset = {
  name: Record<Locale, string>;
  paper: string;
  ink: string;
  accent: string;
  tint: string;
  heading: 'sans' | 'serif';
  use: string;
};

const themeReasons = {
  reading: { en: 'Serif headings suit close reading and discussion.', ru: 'Заголовки с засечками подходят для чтения и обсуждения.', kk: 'Кертікті тақырыптар мәтінді оқып, талқылауға ыңғайлы.' },
  history: { en: 'A light palette suits historical sources and cultural topics.', ru: 'Светлая палитра подходит для исторических источников и тем о культуре.', kk: 'Ашық реңктер тарихи деректер мен мәдени тақырыптарға сай.' },
  arts: { en: 'A light background leaves room for artworks and captions.', ru: 'Светлый фон подходит для произведений искусства и подписей.', kk: 'Ашық фон өнер туындылары мен түсіндірмелерге сай.' },
  experiment: { en: 'A clear grid supports measurements, experiments, and diagrams.', ru: 'Чёткая сетка подходит для измерений, опытов и схем.', kk: 'Анық тор өлшеулерге, тәжірибелерге және сызбаларға ыңғайлы.' },
  geography: { en: 'The palette suits maps and observations from field studies.', ru: 'Палитра подходит для карт и полевых наблюдений.', kk: 'Реңктер карта мен далалық бақылауларға сай.' },
  worked: { en: 'A quiet palette keeps calculations and examples easy to follow.', ru: 'Спокойная палитра помогает следить за вычислениями и примерами.', kk: 'Ұстамды реңктер есептеулер мен мысалдарды түсінуді жеңілдетеді.' },
  night: { en: 'A dark palette supports night-sky imagery.', ru: 'Тёмная палитра подходит для изображений ночного неба.', kk: 'Қою реңктер түнгі аспан суреттеріне сай.' },
  strategy: { en: 'A high-contrast palette suits chess notation and worked tactics.', ru: 'Контрастная палитра подходит для шахматной нотации и разбора тактики.', kk: 'Жоғары контраст шахмат жүрістері мен тактиканы талдауға сай.' },
  data: { en: 'A clear palette gives charts and comparisons room.', ru: 'Светлая палитра подходит для диаграмм и сравнений.', kk: 'Ашық реңктер диаграммалар мен салыстыруларға сай.' },
  template: { en: 'This theme belongs to the selected lesson template.', ru: 'Эта тема задана выбранным шаблоном урока.', kk: 'Бұл стиль таңдалған сабақ үлгісіне бекітілген.' },
  model: { en: 'Suggested by the lesson planner for this topic.', ru: 'Планировщик предложил эту тему для занятия.', kk: 'Сабақ жоспарын құру құралы осы стильді ұсынды.' },
  general: { en: 'A light theme for an introductory or general lesson.', ru: 'Светлая тема для вводного или обзорного занятия.', kk: 'Кіріспе немесе шолу сабағына арналған ашық стиль.' },
};
export type ThemeRecommendation = { theme: Theme; reason: keyof typeof themeReasons };
export const themeReasonText = (recommendation: ThemeRecommendation, locale: Locale) => themeReasons[recommendation.reason][locale];

const themeRules: { topic: RegExp; theme: Theme; reason: ThemeRecommendation['reason'] }[] = [
  { topic: /\b(chess|gambits?|checkmate|game strategy)\b|шахмат|гамбит|тоғызқұмалақ|ойын стратегия/iu, theme: 'strategy', reason: 'strategy' },
  { topic: /\b(statistics|data literacy|data analysis|survey results)\b|статистик|анализ данных|нәтиже.*сауалнама|деректерді талдау/iu, theme: 'signal', reason: 'data' },
  { topic: /\b(literature|poetry|poem|novel|grammar|linguistics|close reading)\b|литератур|поэзи|грамматик|әдебиет|өлең|тіл білімі/iu, theme: 'editorial', reason: 'reading' },
  { topic: /\b(history|civics|heritage|culture|philosophy|silk road)\b|истори|обществознани|культур|философ|тарих|мәдениет|жібек жол/iu, theme: 'steppe', reason: 'history' },
  { topic: /\b(art|painting|sculpture|music)\b|искусств|живопис|музык|өнер|кескіндеме/iu, theme: 'museum', reason: 'arts' },
  { topic: /\b(astronomy|night sky|constellations?|solar system)\b|астроном|ночн.*неб|солнечн.*систем|күн жүйесі|шоқжұлдыз/iu, theme: 'midnight', reason: 'night' },
  { topic: /\b(geography|ecosystem|field study|maps?)\b|географ|экосистем|полевое наблюдени|география|экожүйе|карта/iu, theme: 'atlas', reason: 'geography' },
  { topic: /\b(mathematics|algebra|geometry|proof|programming|worked example)\b|математ|алгебр|геометри|программирован|есептеу|бағдарламалау/iu, theme: 'blueprint', reason: 'worked' },
  { topic: /\b(physics|chemistry|biology|experiment|laboratory|measurements?)\b|физик|хими|биологи|эксперимент|лаборатор|зертхан|тәжірибе|өлшеу/iu, theme: 'laboratory', reason: 'experiment' },
];

export function recommendLessonTheme(topic: string, template?: Theme, suggested?: Theme): ThemeRecommendation {
  if (template) return { theme: template, reason: 'template' };
  const match = themeRules.find(rule => rule.topic.test(topic));
  if (match) return { theme: match.theme, reason: match.reason };
  if (suggested && brandContrast(themePresets[suggested].paper, themePresets[suggested].ink) >= 4.5) return { theme: suggested, reason: 'model' };
  return { theme: 'notebook', reason: 'general' };
}

export const themePresets: Record<Theme, ThemePreset> = {
  notebook: {
    name: { en: 'Notebook', ru: 'Тетрадь', kk: 'Дәптер' },
    paper: '#f1f4e7',
    ink: '#173e32',
    accent: '#426d3c',
    tint: '#dce7cd',
    heading: 'sans',
    use: 'general and introductory lessons',
  },
  laboratory: {
    name: { en: 'Laboratory', ru: 'Лаборатория', kk: 'Зертхана' },
    paper: '#e9f2f3',
    ink: '#143643',
    accent: '#247789',
    tint: '#c9e1e3',
    heading: 'sans',
    use: 'experiments and measurement',
  },
  steppe: {
    name: { en: 'Steppe', ru: 'Степь', kk: 'Дала' },
    paper: '#faf0d9',
    ink: '#4a3520',
    accent: '#935d29',
    tint: '#ebd7af',
    heading: 'sans',
    use: 'land, heritage and culture',
  },
  contrast: {
    name: { en: 'High contrast', ru: 'Высокий контраст', kk: 'Жоғары контраст' },
    paper: '#18251f',
    ink: '#ffffff',
    accent: '#c5e698',
    tint: '#344c3d',
    heading: 'sans',
    use: 'high-contrast projection',
  },
  editorial: {
    name: { en: 'Editorial', ru: 'Редакция', kk: 'Редакция' },
    paper: '#faf3e7',
    ink: '#392e2a',
    accent: '#943e30',
    tint: '#f0ddcc',
    heading: 'serif',
    use: 'literature, discussion and close reading',
  },
  minimal: {
    name: { en: 'Minimal', ru: 'Минимализм', kk: 'Минимализм' },
    paper: '#f8f9f8',
    ink: '#222c2c',
    accent: '#445451',
    tint: '#e0e6e3',
    heading: 'sans',
    use: 'clean, visually quiet lessons',
  },
  blueprint: {
    name: { en: 'Blueprint', ru: 'Чертёж', kk: 'Сызба' },
    paper: '#edf5fc',
    ink: '#192f4e',
    accent: '#255d92',
    tint: '#d1e5f5',
    heading: 'sans',
    use: 'engineering, geometry and technical explanations',
  },
  midnight: {
    name: { en: 'Night sky', ru: 'Ночное небо', kk: 'Түнгі аспан' },
    paper: '#20243c',
    ink: '#f6f1ff',
    accent: '#c9bcff',
    tint: '#343b58',
    heading: 'sans',
    use: 'astronomy and dark-room presentations',
  },
  museum: {
    name: { en: 'Museum', ru: 'Музей', kk: 'Мұражай' },
    paper: '#f6eef2',
    ink: '#3d273c',
    accent: '#774369',
    tint: '#ead9e4',
    heading: 'serif',
    use: 'art, artefacts and exhibition-style lessons',
  },
  atlas: {
    name: { en: 'Atlas', ru: 'Атлас', kk: 'Атлас' },
    paper: '#eaf4ef',
    ink: '#173b39',
    accent: '#24685c',
    tint: '#cde4d6',
    heading: 'serif',
    use: 'geography, ecosystems and field studies',
  },
  chalkboard: {
    name: { en:'Chalkboard',ru:'Доска',kk:'Тақта' },
    paper: '#152b29',
    ink: '#faf6e9',
    accent: '#f8ce83',
    tint: '#294844',
    heading: 'sans',
    use: 'classroom projection and worked examples',
  },
  newsprint: {
    name: { en:'Newsprint',ru:'Газетная полоса',kk:'Газет беті' },
    paper: '#f7f3eb',
    ink: '#232128',
    accent: '#514479',
    tint: '#e8e0ef',
    heading: 'serif',
    use: 'source excerpts, history and print-friendly reading',
  },
  'field-notes': {
    name: { en:'Field Notes', ru:'Полевые заметки', kk:'Дала жазбалары' },
    paper:'#1D242D', ink:'#FFFFFF', accent:'#9DCAEA', tint:'#155F99',
    heading:'serif',
    use:'field reports, evidence and illustrated explanations',
  },
  collage: {
    name: { en:'Collage', ru:'Коллаж', kk:'Коллаж' },
    paper:'#5143AF', ink:'#FFFFFF', accent:'#EBD167', tint:'#6C59DD',
    heading:'sans',
    use:'visual comparison, design and art studies',
  },
  spotlight: {
    name: { en:'Spotlight', ru:'В фокусе', kk:'Назарда' },
    paper:'#1D1311', ink:'#E1BB80', accent:'#FBC43D', tint:'#58423D',
    heading:'sans',
    use:'project briefs, presentations and key findings',
  },
  strategy: {
    name: { en:'Strategy', ru:'Стратегия', kk:'Стратегия' },
    paper:'#19272D', ink:'#FAF3E1', accent:'#EBC17C', tint:'#354952',
    heading:'serif',
    use:'chess tactics, logic puzzles and decision making',
  },
  signal: {
    name: { en:'Signal', ru:'Сигнал', kk:'Сигнал' },
    paper:'#F2F6FF', ink:'#142449', accent:'#244CB1', tint:'#DAE6FF',
    heading:'sans',
    use:'data literacy, charts and structured comparisons',
  },
};

type DecorationColor = keyof Pick<ThemePreset, 'paper' | 'ink' | 'accent' | 'tint'>;
type CoverDecoration = {
  shape: SlideArtwork['motif'];
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  fill?: DecorationColor;
  stroke?: DecorationColor;
};

// Geometry is expressed as slide percentages for the browser and editable PowerPoint.
// See research.md for the Presenton layouts used as references.
const coverArtwork: Partial<Record<Theme, readonly CoverDecoration[]>> = {
  'field-notes': [
    {shape:'roundRect', x:54, y:43, w:41, h:49, stroke:'accent'},
    {shape:'roundRect', x:69, y:9, w:26, h:53, stroke:'accent'},
  ],
  collage: [
    {shape:'roundRect', x:58, y:10, w:34, h:26, fill:'tint'},
    {shape:'roundRect', x:64, y:40, w:17, h:25, fill:'accent'},
    {shape:'roundRect', x:83, y:40, w:13, h:45, fill:'tint'},
    {shape:'roundRect', x:58, y:69, w:23, h:16, fill:'tint'},
  ],
  spotlight: [
    {shape:'roundRect', x:1.85, y:3.25, w:96.3, h:93.5, stroke:'ink'},
    {shape:'rect', x:6, y:85.5, w:10, h:.55, fill:'accent'},
  ],
  strategy: [
    {shape:'rect', x:81, y:66, w:6, h:10.67, fill:'tint'},
    {shape:'rect', x:87, y:76.67, w:6, h:10.67, fill:'tint'},
    {shape:'rect', x:93, y:66, w:6, h:10.67, stroke:'accent'},
    {shape:'rect', x:81, y:87.34, w:6, h:10.67, stroke:'accent'},
  ],
  signal: [
    {shape:'rect', x:6, y:85, w:17, h:.65, fill:'accent'},
    {shape:'roundRect', x:86, y:65, w:3.1, h:23, fill:'tint'},
    {shape:'roundRect', x:90.4, y:56, w:3.1, h:32, fill:'accent'},
    {shape:'roundRect', x:94.8, y:43, w:3.1, h:45, fill:'tint'},
  ],
};

const ringCover: readonly CoverDecoration[] = [
  {shape:'rings-top', x:70, y:0, w:30, h:52, fill:'tint', stroke:'accent'},
  {shape:'rings-bottom', x:70, y:52, w:30, h:48, stroke:'accent'},
];
const framedCover: Partial<Record<Theme, readonly CoverDecoration[]>> = {
  minimal: [{shape:'rect', x:81, y:88.76, w:13, h:.57, fill:'accent'}],
  blueprint: [
    {shape:'grid', x:70, y:0, w:30, h:100, stroke:'tint'},
    {shape:'ellipse', x:77, y:55, w:18, h:32, stroke:'accent'},
  ],
  editorial: [
    {shape:'rect', x:78, y:10, w:17, h:80, fill:'tint'},
    {shape:'rect', x:75, y:82.87, w:21, h:2.13, fill:'accent'},
  ],
  museum: [
    {shape:'rect', x:78, y:10, w:17, h:80, fill:'tint'},
    {shape:'arch', x:75, y:29, w:17, h:54, stroke:'accent'},
  ],
  midnight: [
    {shape:'ellipse', x:75, y:-9, w:29, h:51.56, fill:'tint'},
    {shape:'ellipse', x:75, y:29, w:29, h:61, rotation:-30, stroke:'accent'},
  ],
  atlas: [
    {shape:'rings-atlas', x:78, y:-7, w:24, h:78.22, rotation:29, fill:'tint', stroke:'accent'},
    {shape:'rings-bottom', x:70, y:65, w:30, h:35, stroke:'accent'},
  ],
};

export function usesFramedCover(theme: Theme) {
  return !coverArtwork[theme];
}

export function presentationCoverArtwork(
  deck: Pick<Deck, 'theme' | 'brand' | 'powerPointStyle'>,
  slide: Pick<Slide, 'layout' | 'status' | 'importedPage' | 'importedArtwork' | 'design' | 'title' | 'body' |
    'image' | 'additionalImages' | 'table' | 'chart' | 'diagram' | 'coverArtwork' | 'powerPointLayoutId'>,
): SlideArtwork[] {
  if (slide.layout !== 'cover' || slide.status !== 'ready' || slide.importedPage || slide.importedArtwork) return [];
  if (slide.coverArtwork?.theme === deck.theme) return slide.coverArtwork.objects;
  const structured = coverArtwork[deck.theme];
  if (structured) {
    if (deck.brand || deck.powerPointStyle || slide.design?.variant && slide.design.theme !== 'deck') return [];
    if (deck.theme !== 'spotlight' && (slide.title.length > 74 || slide.body.length > 160)) return [];
  } else if (slide.design?.variant || slide.diagram || slide.table || slide.chart || slideImages(slide).length ||
    slide.title.length > 64 || slide.body.length > 135) {
    return [];
  }
  const palette = lessonPalette(deck, slide.powerPointLayoutId);
  return (structured ?? framedCover[deck.theme] ?? ringCover).map(({shape,x,y,w,h,rotation,stroke,fill}, index) => ({
    id: 'cover-art-' + (index + 1), kind:'artwork', motif:shape, x, y, w, h, rotation:rotation ?? 0,
    paint: stroke ? 'stroke' : 'fill', color:palette[stroke ?? fill ?? 'accent'],
    ...(stroke && fill && {backdrop:palette[fill]}),
  }));
}
