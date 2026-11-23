import { deckThemes, type Deck, type Locale, type Slide } from '@sabaq/lesson/types';
import { themePresets } from '@sabaq/lesson/themes';
import { numericTableValues } from '@sabaq/lesson/chart-data';
import type { AssistantTool } from './tools';

const copy = {
  en: {
    prepared:'I prepared these changes for your review.', help:'I can list slides, show speaker notes, shorten slide text, add a check question, move or duplicate slides, and change the theme. For example, try “Use the Editorial theme” or “Move slide 2 to position 4.”', theme:'Available themes', quiz:'Quick check', question:'Explain the main idea in your own words. Give one example.', notes:'This slide has no speaker notes yet.', noImage:'I found no catalog illustration for this subject. Try a different scene or add an image in the editor.', loading:'Reading the lesson…', checking:'Preparing the proposed changes…', stopped:'Response stopped.', error:'I couldn’t complete this request. You can try again.', empty:'The lesson already matches the requested change.',
  },
  ru: {
    prepared:'Я подготовил изменения. Проверьте их перед применением.', help:'Я могу показать список слайдов и заметки, сократить текст, добавить вопрос, переместить или дублировать слайд и сменить тему. Попробуйте «Используй тему Editorial» или «Перемести слайд 2 на позицию 4».', theme:'Доступные темы', quiz:'Проверим себя', question:'Объясните основную мысль своими словами. Приведите один пример.', notes:'К этому слайду пока нет заметок.', noImage:'В каталоге нет подходящей иллюстрации. Попробуйте другую сцену или добавьте изображение в редакторе.', loading:'Изучаю урок…', checking:'Готовлю предложенные изменения…', stopped:'Ответ остановлен.', error:'Не удалось выполнить запрос. Попробуйте ещё раз.', empty:'Урок уже соответствует запросу.',
  },
  kk: {
    prepared:'Өзгерістерді дайындадым. Қолданар алдында қарап шығыңыз.', help:'Слайдтар тізімі мен жазбаларды көрсете аламын. Мәтінді қысқартып, сұрақ қосып, слайдты жылжытып, көшіріп немесе стильді ауыстыра аламын. «Editorial стилін қолдан» немесе «2-слайдты 4-орынға жылжыт» деп жазыңыз.', theme:'Қолжетімді стильдер', quiz:'Өзіңді тексер', question:'Негізгі ойды өз сөзіңмен түсіндір. Бір мысал келтір.', notes:'Бұл слайдта әзірге жазба жоқ.', noImage:'Каталогта сәйкес сурет жоқ. Басқа көріністі сұраңыз немесе суретті редакторда қосыңыз.', loading:'Сабақты қарап жатырмын…', checking:'Ұсынылған өзгерістерді дайындап жатырмын…', stopped:'Жауап тоқтатылды.', error:'Сұрауды орындай алмадым. Қайталап көріңіз.', empty:'Сабақ сұралған өзгеріске сай.',
  },
};

export const assistantCopy = copy;

const chartCopy = {
  en:'Chart of the values shown in the slide table.',
  ru:'Диаграмма значений из таблицы на слайде.',
  kk:'Слайдтағы кесте мәндерінің диаграммасы.',
};

export function chartFromSlideTable(slide: Slide | undefined, message: string, locale: Locale, language: Locale) {
  const table=slide?.table;
  if (!slide || slide.status!=='ready' || !table || table.headers.length<2 || table.headers.length>13 || !table.rows.length
    || !/^(?:(?:convert|turn) the (?:numeric data on the selected slide|slide table) into a chart|преобразуй(?:те)? (?:числовые данные выбранного слайда|таблицу) в диаграмму|таңдалған слайдтағы сандық деректерді диаграммаға айналдыр)(?:[.!?]|$)/iu.test(message)) return;
  const values=numericTableValues(table);
  if (!values) return;
  const chart={
    categories:table.rows.map(row=>String(row[0])),
    series:table.headers.slice(1).map((name,index)=>({name,values:values.map(row=>row[index])})),
    alt:chartCopy[language],
  };
  const actions:AssistantTool[]=[{tool:'edit_slide',slideId:slide.id,changes:{chart,table}}];
  return {reply:copy[locale].prepared,actions};
}

const shorteningCopy = {
  en: { select:'Select a ready slide or give its slide number.', empty:'There’s no text to shorten in the body of this slide.', short:'I couldn’t make this text shorter while keeping its details.' },
  ru: { select:'Выберите готовый слайд или укажите его номер.', empty:'В основной части этого слайда нет текста, который можно сократить.', short:'Сократить текст без потери деталей не получилось.' },
  kk: { select:'Дайын слайдты таңдаңыз немесе нөмірін көрсетіңіз.', empty:'Слайдтың негізгі бөлігінде қысқартатын мәтін жоқ.', short:'Мәтінді мағынасын сақтап қысқарта алмадым.' },
};

export function mentionedSlideNumber(message: string) {
  const references = [...message.matchAll(/(?:\bslide\s*|слайд(?:а|е|у|ом)?\s*|№\s*)(\d+)|(\d+)\s*-\s*слайд/giu)];
  const numbers = new Set(references.map(match=>Number(match[1] ?? match[2])));
  return numbers.size === 1 ? [...numbers][0] : undefined;
}

const simpleShortening = [
  /^(?:please )?(?:shorten (?:the )?(?:text|(?:text (?:on|of) )?(?:this |the )?(?:selected |current )?slide(?: \d+)?)|make (?:(?:the )?text (?:on |of )?)?(?:(?:this |the )?(?:selected |current )?slide(?: \d+)?|(?:this |the )?text) (?:shorter|more concise))(?: please)?$/iu,
  /^(?:(?:пожалуйста,? )?(?:сократи(?:те)?(?: текст)?|сделай(?:те)? (?:текст )?короче) (?:на )?(?:этом |этот |выбранном |выбранный )?слайд(?:е|а)?(?: \d+)?|сократи(?:те)? текст)$/iu,
  /^(?:(?:бұл|осы|\d+\s*-\s*)\s*слайдтың мәтінін|мәтінді) қысқарт(?:ыңыз|шы)?$/iu,
];

export function isSimpleShortening(message: string) {
  return simpleShortening.some(pattern=>pattern.test(message.trim().replace(/[.!?。]+$/u,'')));
}

export function shorteningProposal(slide:Slide, body:string, locale:Locale) {
  const actions: AssistantTool[] = [{tool:'edit_slide',slideId:slide.id,changes:{body}}];
  return {reply:copy[locale].prepared,actions};
}

const discussionReminder = /^(?:repeat|revisit) (?:this|the) (?:explanation|idea|topic) (?:in|during) (?:the )?(?:group |class )?discussion[.!]?$/iu;

export function shortenSlide(slide: Slide | undefined, locale: Locale, language: Locale) {
  const actions: AssistantTool[] = [];
  const labels = shorteningCopy[locale];
  if (!slide || slide.status !== 'ready') return { reply:labels.select,actions };
  if (!slide.body.trim()) return {reply:labels.empty,actions};
  const segmenter = new Intl.Segmenter(language,{granularity:'sentence'});
  const paragraphs = slide.body.trim().split(/\n\s*\n/u);
  const units = paragraphs.flatMap((paragraph, index)=>[...segmenter.segment(paragraph)]
    .map(({segment})=>({text:segment.trim(),paragraph:index})).filter(({text})=>text));
  const seen = new Set<string>();
  const kept = units.filter(({text}, index)=>{
    const normalized = text.normalize('NFKC').replace(/\s+/gu,' ');
    if (seen.has(normalized) || (index>0 && discussionReminder.test(normalized))) return false;
    seen.add(normalized);
    return true;
  });
  const body = kept.map((unit,index)=>{
    const previous = kept[index-1];
    const separator = previous ? (previous.paragraph===unit.paragraph ? ' ' : '\n\n') : '';
    return separator + unit.text;
  }).join('');
  if (!body || kept.length===units.length || body.length>=slide.body.trim().length)
    return { reply:labels.short,actions };
  return shorteningProposal(slide,body,locale);
}

export function namedThemeRequest(message: string) {
  const command = message.trim().replace(/[.!?。]+$/u, '').trim();
  const match = command.match(/^(?:please )?(?:(?:use|apply) (?:the )?|(?:change|switch|set) (?:the )?(?:(?:deck|lesson|presentation) )?theme(?: of (?:the |this )?(?:deck|lesson|presentation))? (?:to|as) )(.+?)(?: theme)?$/iu)
    ?? command.match(/^(?:(?:смени(?:те)?|измени(?:те)?|поменяй(?:те)?|установи(?:те)?) тему(?: (?:всей )?(?:презентации|урока))? на|(?:используй(?:те)?|примени(?:те)?) тему) (.+)$/iu)
    ?? command.match(/^(.+?) стилі(?:н|не) (?:қолдан(?:ыңыз)?|ауыс(?:тыр(?:ыңыз)?)?)$/iu);
  if (!match) return;
  const target = match[1].replace(/^[«“"']/u, '').replace(/[»”"']$/u, '').toLocaleLowerCase();
  return deckThemes.find((id) => [id, ...Object.values(themePresets[id].name)]
    .some((name) => name.toLocaleLowerCase() === target));
}

export function localAssistant(deck: Deck, selected: Slide | undefined, message: string, locale: Locale) {
  const t = copy[locale];
  const actions: AssistantTool[] = [];
  const input = message.toLocaleLowerCase();
  const number = mentionedSlideNumber(input);
  const slide = number === undefined ? selected : deck.slides[number-1];
  const theme = deckThemes.find((name) => [name, ...Object.values(themePresets[name].name)]
    .some((label) => input.includes(label.toLocaleLowerCase())));
  if (theme && /theme|preset|use |switch|apply|стил|тем|қолдан|ауыс/iu.test(input)) {
    actions.push({tool:'edit_deck',theme});
  } else if (/themes|presets|темы|пресеты|стильдер/iu.test(input)) {
    return {reply:`${t.theme}\n\n${deckThemes.map((name) => `- ${themePresets[name].name[locale]}`).join('\n')}`,actions};
  } else if (/list slides|overview|outline|список слайдов|структур|слайдтар тізімі|слайдтардың тізімі/iu.test(input)) {
    return {reply:deck.slides.map(({title},i)=>`${i+1}. ${title}`).join('\n') || t.help,actions};
  } else if (slide && /show.*notes|read.*notes|покажи.*замет|көрсет.*жазба|жазба.*көрсет/iu.test(input)) {
    return {reply:slide.notes || t.notes,actions};
  } else if (slide && /duplicate|copy slide|дублир|копи.*слайд|көшір/iu.test(input)) {
    actions.push({tool:'duplicate_slide',slideId:slide.id});
  } else if (slide && /delete slide|remove slide|удали.*слайд|слайд.*жой/iu.test(input)) {
    actions.push({tool:'remove_slide',slideId:slide.id});
  } else if (slide && /move |перемест|жылжыт/iu.test(input)) {
    const end = input.match(/(?:position|позици[юи]|место|to)\s*(\d+)|(\d+)\s*-\s*орын/iu);
    const position = Number(end?.[1] ?? end?.[2]);
    if (position >= 1 && position <= deck.slides.length) {
      const slideIds=deck.slides.filter(({id})=>id!==slide.id).map(({id})=>id);
      slideIds.splice(position-1,0,slide.id);
      actions.push({tool:'reorder_slides',slideIds});
    }
  } else if (/add.*quiz|add.*question|добав.*(вопрос|тест)|сұрақ.*қос/iu.test(input)) {
    const lesson = copy[deck.language];
    actions.push({tool:'add_slide',afterId:slide?.id,changes:{title:lesson.quiz,body:lesson.question,layout:'body'}});
  } else if (isSimpleShortening(message)) {
    return shortenSlide(slide,locale,deck.language);
  } else if (slide && /illustrat|add.*image|иллюстрац|добав.*изображ|сурет.*қос/iu.test(input)) {
    const topic=`${deck.topic} ${slide.title} ${input}`;
    const choices = [
      ['seedling-growth', /seedling|bean plant|фасол|үрмебұршақ/iu],
      ['kindness-notebooks', /kindness|notebooks|доброта|доброте|тетрад|мейірім|дәптер/iu],
      ['water-lab', /water.*measur|measur.*water|объ[её]м.*вод|су көлем/iu],
    ] as const;
    const match = choices.find(([,test])=>test.test(topic));
    if (match) actions.push({tool:'illustrate_slide',slideId:slide.id,illustration:{asset:match[0]}});
    else return {reply:t.noImage,actions};
  }
  return {reply:actions.length ? t.prepared : t.help,actions};
}
