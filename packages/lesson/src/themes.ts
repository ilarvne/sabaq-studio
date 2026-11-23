import type { Deck, Locale, PowerPointStyle, Theme } from './types';

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
  template: { en: 'This theme belongs to the selected lesson template.', ru: 'Эта тема задана выбранным шаблоном урока.', kk: 'Бұл стиль таңдалған сабақ үлгісіне бекітілген.' },
  model: { en: 'Suggested by the lesson planner for this topic.', ru: 'Планировщик предложил эту тему для занятия.', kk: 'Сабақ жоспарын құру құралы осы стильді ұсынды.' },
  general: { en: 'A light theme for an introductory or general lesson.', ru: 'Светлая тема для вводного или обзорного занятия.', kk: 'Кіріспе немесе шолу сабағына арналған ашық стиль.' },
};
export type ThemeRecommendation = { theme: Theme; reason: keyof typeof themeReasons };
export const themeReasonText = (recommendation: ThemeRecommendation, locale: Locale) => themeReasons[recommendation.reason][locale];

const themeRules: { topic: RegExp; theme: Theme; reason: ThemeRecommendation['reason'] }[] = [
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
  if (suggested && !['midnight', 'chalkboard', 'contrast'].includes(suggested)) return { theme: suggested, reason: 'model' };
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
};
