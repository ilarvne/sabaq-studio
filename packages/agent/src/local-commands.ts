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
  if (!slide || slide.status!=='ready'
    || !/^(?:(?:convert|turn) the (?:numeric data on the selected slide|slide table) into a chart|преобразуй(?:те)? (?:числовые данные выбранного слайда|таблицу) в диаграмму|таңдалған слайдтағы сандық деректерді диаграммаға айналдыр)(?:[.!?]|$)/iu.test(message)) return;
  const data = chartChanges(slide,language);
  if (!data) return;
  const actions:AssistantTool[]=[{tool:'edit_slide',slideId:slide.id,changes:data}];
  return {reply:copy[locale].prepared,actions};
}

function chartChanges(slide: Slide, language: Locale) {
  const table=slide.table;
  const values=numericTableValues(table);
  if (!table || !values) return;
  const chart={
    categories:table.rows.map(row=>String(row[0])),
    series:table.headers.slice(1).map((name,index)=>({name,values:values.map(row=>row[index])})),
    alt:chartCopy[language],
  };
  return {chart,table};
}

const sideImageRequests = [
  /(?:^(?:please )?|[\s,;])(?:(?:(?:move|put|place|position|keep|show)\s+)(?:(?:the|this|existing)\s+)?(?:image|picture|photo|illustration)|(?:the\s+)?(?:image|picture|photo|illustration)(?:\s+(?:should be|goes|belongs))?)(?:\s+(?:instead of\s+the\s+background|not\s+(?:as\s+)?(?:the\s+)?background)\s*[,–—]?\s*(?:but)?\s*)?\s*(?<side>beside|next to|(?:to|on|at)\s+(?:the\s+)?(?:left|right|side))(?:\W|$)/iu,
  /(?:^|[\s,;])(?:(?:(?:перемести|поставь|размести|покажи|оставь)(?:те)?\s+)(?:эту\s+)?(?:картинку|изображение|фото|иллюстрацию)|(?:картинка|картинку|изображение|фото|иллюстрация|иллюстрацию)(?:\s+(?:должн[ао]\s+быть|пусть\s+будет))?)(?:\s+не\s+(?:на\s+)?фон(?:ом|е)?(?:\s*,?\s*а)?)?\s+(?<side>сбоку|справа|слева|рядом|с\s+(?:правой|левой)\s+стороны)(?:[^\p{L}]|$)/iu,
  /(?:^|[\s,;])(?:суретті|сурет)\s+(?<side>оң\s+жаққа|сол\s+жаққа|жанына|қатарына)\s+(?:қой|орналастыр|жылжыт)(?:ыңыз|ыңызшы|шы)?(?:[^\p{L}]|$)/iu,
];

const requestChart = /(?:\b(?:add|create|draw|make|include) (?:a\s+)?(?:chart|graph)s?\b|(?:добав(?:ь|ьте|ить)|построй(?:те)?|сделай(?:те)?)\s+(?:(?:ещ[её]|также)\s+)?(?:графики?|диаграмм[уы])(?:[^\p{L}]|$)|(?:диаграмма|график)\s+(?:қос|сал|жаса))/iu;
const imagePositionCopy = {
  en:{data:'For the chart, send the category labels and numerical values, or add a numeric table to the slide.', gallery:'Which picture in the gallery should go beside the text?'},
  ru:{data:'Для диаграммы укажите категории и числовые значения или добавьте на слайд таблицу с данными.', gallery:'Какую картинку из галереи поместить рядом с текстом?'},
  kk:{data:'Диаграмма үшін санаттар мен сандық мәндерді жіберіңіз немесе слайдқа деректер кестесін қосыңыз.', gallery:'Галереядағы қай суретті мәтіннің жанына орналастырайын?'},
};

export function moveSlideImageBesideText(slide: Slide | undefined, message: string, locale: Locale, language: Locale) {
  const text = message.trim().replace(/\s+/gu,' ');
  const match = sideImageRequests.map(pattern=>pattern.exec(text)).find(Boolean);
  const direction = match?.groups?.side;
  if (!direction) return;
  const prefix = text.slice(0,match.index).trim();
  if (/^(?:(?:why|where)\b|(?:почему|где|зачем|неге|неліктен)\s)/iu.test(text)
    || /(?:\b(?:do not|don['’]t|never|remove|delete|replace)|(?:^|\s)(?:не|не надо|не нужно|убери|удали|замени))$/iu.test(prefix)) return;
  const actions:AssistantTool[]=[];
  const t = imagePositionCopy[locale];
  const image = imageRemovalCopy[locale];
  if (!slide || slide.status !== 'ready') return {reply:image.select,actions};
  const needsChart = requestChart.test(text) && !slide.chart;
  const data = needsChart ? chartChanges(slide,language) : undefined;
  const imageProblem = slide.importedPage ? image.imported : !slide.image ? image.empty : slide.additionalImages?.length ? t.gallery : undefined;
  const side = /left|лев|слева|сол/iu.test(direction) ? 'left'
    : /right|прав|справа|оң/iu.test(direction) ? 'right'
    : slide.layout === 'image-left' ? 'left' : 'right';
  if (!imageProblem) {
    if (slide.layout !== `image-${side}` || slide.freeLayout || slide.design?.variant || data)
      actions.push({tool:'edit_slide',slideId:slide.id,changes:data ?? {},imageSide:side});
  } else if (data && !slide.importedPage) {
    actions.push({tool:'edit_slide',slideId:slide.id,changes:data});
  }
  const reply = [imageProblem, needsChart && !data ? t.data : undefined].filter(Boolean).join(' ');
  return {reply:reply || (actions.length ? copy[locale].prepared : copy[locale].empty),actions};
}

const shorteningCopy = {
  en: { select:'Select a ready slide or give its slide number.', empty:'There’s no text to shorten in the body of this slide.', short:'I couldn’t make this text shorter while keeping its details.' },
  ru: { select:'Выберите готовый слайд или укажите его номер.', empty:'В основной части этого слайда нет текста, который можно сократить.', short:'Сократить текст без потери деталей не получилось.' },
  kk: { select:'Дайын слайдты таңдаңыз немесе нөмірін көрсетіңіз.', empty:'Слайдтың негізгі бөлігінде қысқартатын мәтін жоқ.', short:'Мәтінді мағынасын сақтап қысқарта алмадым.' },
};

const imageRemovalCopy = {
  en:{select:'Select a ready slide or give its slide number.', empty:'There’s no separate image to remove from this slide.', imported:'This image contains the entire imported slide. Use an editable slide to remove individual images.', multiple:'Which image should I remove? For example, say “Remove image 2”.', invalid:'There’s no image with that number on this slide.'},
  ru:{select:'Выберите готовый слайд или укажите его номер.', empty:'На этом слайде нет отдельного изображения для удаления.', imported:'Это изображение содержит весь импортированный слайд. Отдельные изображения можно удалять на редактируемом слайде.', multiple:'Какое изображение удалить? Например, напишите «Удали картинку № 2».', invalid:'На этом слайде нет изображения с таким номером.'},
  kk:{select:'Дайын слайдты таңдаңыз немесе нөмірін көрсетіңіз.', empty:'Бұл слайдта алып тастайтын бөлек сурет жоқ.', imported:'Бұл суретте импортталған слайд толығымен сақталған. Жеке суреттерді өңделетін слайдтан алып тастауға болады.', multiple:'Қай суретті алып тастайын? Мысалы, «2-суретті алып таста» деп жазыңыз.', invalid:'Бұл слайдта мұндай нөмірлі сурет жоқ.'},
};

const imageRemovals = [
  /^(?:please )?(?:remove|delete) (?:(?:the|this|that) )?(?:image|picture|photo|illustration)(?: (?:number |#\s*)?(?<imageNumber>\d+))?(?: (?:from|on) (?:(?:the|this) )?(?:(?:selected|current) )?slide(?: (?<slideNumber>\d+))?)?(?: please)?$/iu,
  /^(?:пожалуйста,? )?(?:убери(?:те)?|удали(?:те)?) (?:(?:эту|это) )?(?:картинку|изображение|фото|иллюстрацию)(?: (?:номер |№\s*)?(?<imageNumber>\d+))?(?: (?:с|со|на) (?:(?:этого|этом|текущего|выбранного) )?слайд(?:а|е)?(?: (?:№\s*)?(?<slideNumber>\d+))?)?(?:,? пожалуйста)?$/iu,
  /^(?:(?:(?:осы|бұл) |(?<slideNumber>\d+)\s*-\s*)?слайдтағы )?(?:(?<imageNumber>\d+)\s*-\s*)?суретті (?:алып таста(?:ңыз)?|жой(?:ыңыз)?)$/iu,
];

export function imageRemovalRequest(message:string) {
  const command=message.trim().replace(/[.!?。]+$/u,'').replace(/\s+/gu,' ');
  for (const pattern of imageRemovals) {
    const groups=command.match(pattern)?.groups;
    if (groups) return {
      index:groups.imageNumber===undefined ? undefined : Number(groups.imageNumber),
      slideNumber:groups.slideNumber===undefined ? undefined : Number(groups.slideNumber),
    };
  }
}

export function removeSlideImage(slide:Slide|undefined, index:number|undefined, locale:Locale) {
  const actions:AssistantTool[]=[];
  const t=imageRemovalCopy[locale];
  if (!slide || slide.status!=='ready') return {reply:t.select,actions};
  if (!slide.image) return {reply:t.empty,actions};
  if (slide.importedPage) return {reply:t.imported,actions};
  const imageCount=1+(slide.additionalImages?.length ?? 0);
  if (index===undefined && imageCount>1) return {reply:t.multiple,actions};
  const position=index ?? 1;
  if (position<1 || position>imageCount) return {reply:t.invalid,actions};
  actions.push({tool:'remove_image',slideId:slide.id,index:position});
  return {reply:copy[locale].prepared,actions};
}

export function mentionedSlideNumber(message: string) {
  const imageRemoval=imageRemovalRequest(message);
  if (imageRemoval) return imageRemoval.slideNumber;
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
  } else if (slide && /(?:delete|remove) (?:(?:the|this|selected|current) )?slide(?:\s|[.!?]|$)|удали(?:те)? (?:(?:этот|текущий|выбранный) )?слайд(?:\s|[.!?]|$)|слайд(?:ты)? жой/iu.test(input)) {
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
