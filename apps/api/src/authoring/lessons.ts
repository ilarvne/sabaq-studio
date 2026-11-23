import { isTemplate, templatePlan } from '@sabaq/lesson/lesson-templates';
import { randomUUID } from 'node:crypto';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { CreateInput, Deck, Locale, OutlineItem, Slide, SourceExcerpt } from '@sabaq/lesson/types';

const languageCopy = {
  kk: {
    parts: [
      'Сабақтың мақсаты',
      'Алдыңғы білім',
      'Жаңа ұғым',
      'Мысал',
      'Топтық жұмыс',
      'Талқылау',
      'Дәлелдер',
      'Тексеру сұрағы',
      'Қорытынды',
      'Үй тапсырмасы',
    ],
    prompt: 'Осы тақырып бойынша өз мысалыңды келтіріп, жауабыңды түсіндір.',
    notes: 'Оқушыларға ойлануға уақыт беріп, жауаптарын талқылаңыз.',
    next: 'Негізгі ойды өз сөзіңмен түсіндір.',
    question: 'Оны қандай мысалмен түсіндіре аласың?',
  },
  ru: {
    parts: [
      'Цель урока',
      'Что мы уже знаем',
      'Новое понятие',
      'Пример',
      'Работа в группах',
      'Обсуждение',
      'Доказательства',
      'Вопрос для проверки',
      'Итог урока',
      'Домашнее задание',
    ],
    prompt: 'Приведите свой пример по теме и объясните ответ.',
    notes: 'Дайте классу время подумать и обсудите ответы.',
    next: 'Объясните основную мысль своими словами.',
    question: 'Какой пример поможет это объяснить?',
  },
  en: {
    parts: [
      'Lesson objective',
      'Prior knowledge',
      'New concept',
      'Worked example',
      'Group activity',
      'Discussion',
      'Evidence',
      'Check your understanding',
      'Reflection',
      'Homework',
    ],
    prompt: 'Give an example from your experience and explain how it relates to this topic.',
    notes: 'Give learners time to think, then discuss their responses.',
    next: 'Explain the main idea in your own words.',
    question: 'Which example would help explain this?',
  },
};
function sampleFor(input: Pick<CreateInput, 'source' | 'language'>) {
  if (!input.source) return undefined;
  const fixture = makeFixtureDeck(input.language);
  return fixture.source?.text.trimEnd() === input.source.text.trimEnd() ? fixture : undefined;
}
export function fixtureOutline(
  input: Pick<CreateInput, 'topic' | 'language' | 'source' | 'template'>,
  count: number,
): OutlineItem[] {
  const plan = isTemplate(input.template) ? templatePlan(input.template,input.language,input.topic,count) : undefined;
  const sample = !plan && sampleFor(input);
  if (sample && count <= sample.outline.length) return sample.outline.slice(0, count);
  const c = languageCopy[input.language];
  if (input.source) {
    const passages = excerpts(input.source, input.language);
    if (passages.length) return Array.from({ length: count }, (_, i) => {
      const position = Math.round(i * (passages.length - 1) / Math.max(1, count - 1));
      const passage = passages[position];
      if (plan) return {...plan[i],id:randomUUID(),summary:plan[i].summary+'\n'+passage.excerpt,sourceExcerptId:passage.id};
      const words = [...passage.excerpt];
      const heading = words.length <= 85 ? passage.excerpt : words.slice(0, 84).join('').replace(/\s+\S*$/u, '') + '…';
      const title = i === 0 ? input.topic : heading;
      return { id: randomUUID(), title, summary: passage.excerpt, purpose: passage.excerpt.slice(0,400), layout: i === 0 ? 'cover' : 'body', sourceExcerptId: passage.id };
    });
  }
  if (plan) return plan.map(item=>({...item,id:randomUUID()}));
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    title: i === 0 ? input.topic : c.parts[i % c.parts.length] + (i >= c.parts.length ? ' · ' + (Math.floor(i / c.parts.length) + 1) : ''),
    summary: i === 0 ? c.parts[0] : c.prompt,
    layout: i === 0 ? 'cover' : 'body',
  }));
}
export function blankSlide(item: OutlineItem): Slide {
  return {
    id: item.id,
    title: item.title,
    body: '',
    notes: '',
    status: 'pending',
    version: 0,
    lessonPart: item.section || 'lesson',
    layout: item.layout,
  };
}
export function excerpts(source: NonNullable<Deck['source']>, language: Locale): SourceExcerpt[] {
  const passages: SourceExcerpt[] = [];
  const segmenter = new Intl.Segmenter(language, { granularity: 'sentence' });
  let offset = 0;
  for (const { segment } of segmenter.segment(source.text)) {
    const points = Array.from(segment);
    for (let index = 0; index < points.length;) {
      let end = Math.min(index + 500, points.length);
      if (end < points.length) {
        let boundary = end;
        while (boundary > index && !/\s/u.test(points[boundary])) boundary--;
        if (boundary > index) end = boundary;
      }
      const raw = points.slice(index, end).join('');
      const excerpt = raw.trim();
      if (excerpt) {
        const start = offset + index + [...raw.slice(0, raw.indexOf(excerpt))].length;
        passages.push({ id: 'source-' + (passages.length + 1), source: source.name, start, end: start + [...excerpt].length, excerpt });
      }
      index = end;
    }
    offset += points.length;
  }
  return passages;
}
export function fixtureSlide(
  deck: Deck,
  item: OutlineItem,
  index: number,
  answers?: CreateInput['answers'],
): Partial<Slide> {
  const templated = isTemplate(deck.template);
  const sample = !templated && sampleFor(deck);
  if (sample) {
    const match = sample.slides.find((s) => s.id === item.id) ?? (item.sourceExcerptId ? undefined : sample.slides[index]);
    if (match) {
      const copied = structuredClone(match);
      if ((deck.imageMode ?? answers?.image) === 'none') delete copied.image;
      return {
        ...copied,
        id: item.id,
        title: item.title,
        body: item.summary || copied.body,
        layout: item.layout,
      };
    }
  }
  const c = languageCopy[deck.language];
  const levelNotes = {
    kk: {
      middle: 'Ұғымды күнделікті мысалмен байланыстырыңыз.',
      secondary: 'Оқушылардан қорытындысын дәлелдеуді сұраңыз.',
      adult: 'Тәжірибеде қалай қолдануға болатынын талқылаңыз.',
    },
    ru: {
      middle: 'Свяжите понятие с примером из повседневной жизни.',
      secondary: 'Попросите обосновать вывод.',
      adult: 'Обсудите, как применить это на практике.',
    },
    en: {
      middle: 'Connect the concept to an everyday example.',
      secondary: 'Ask learners to justify their conclusion.',
      adult: 'Discuss how this could be applied in practice.',
    },
  };
  const level = answers?.level;
  const notes = [
    c.notes,
    level === 'middle' || level === 'secondary' || level === 'adult'
      ? levelNotes[deck.language][level]
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const fragments = deck.source ? excerpts(deck.source, deck.language) : [];
  const evidence = fragments.find(fragment => fragment.id === item.sourceExcerptId) ?? fragments[index % fragments.length];
  const body = evidence
    ? (item.summary.includes(evidence.excerpt) ? item.summary : [item.summary, evidence.excerpt].filter(Boolean).join('\n\n'))
    : [deck.topic, item.summary || (index % 2 ? c.prompt : c.next)].filter(Boolean).join('\n\n');
  return {title:item.title,body:templated && !evidence ? item.summary : body,notes,
    ...(evidence && {evidence:[evidence]})};
}

export function fixtureProposal(slide: Slide, language: Locale, instruction: string): Slide {
  const next = structuredClone(slide),
    copy = languageCopy[language];
  if (/notes|замет|сөйле|баянда|доклад/iu.test(instruction)) {
    next.notes = [next.notes, copy.notes].filter(Boolean).join(' ');
  } else if (/короч|қысқар|қысқа|short|concise|сократ/iu.test(instruction)) {
    const old = next.body.trim();
    const first = old.match(/^[^.!?\n]+[.!?]?/u)?.[0] ?? old;
    const words = first.split(/\s+/u);
    next.body =
      words.length > 5
        ? words.slice(0, Math.max(4, Math.ceil(words.length * 0.65))).join(' ') + '…'
        : first !== old
          ? first
          : copy.next;
  } else {
    next.body = [next.body, copy.question].filter(Boolean).join('\n\n');
  }
  if (next.body !== slide.body) {
    delete next.bodyRuns;
    if (next.richText) delete next.richText.body;
  }
  return next;
}
