import fixture from './sample-lesson.json';
import type { Deck, Layout, Locale, Slide, SourceExcerpt } from './types';

const sourceText = "[kk.measurements]\nМектеп ауласындағы тәжірибеде А ыдысына 24 мл, B ыдысына 36 мл, C ыдысына 48 мл су жиналды.\n\n[kk.teacher]\nСалыстырмас бұрын өлшем бірлігін тексеріңдер.\n\n[kk.procedure]\nӘр топ өз ыдысындағы судың көлемін өлшеп, бақылау парағына жазады. Өлшеуді аяқтаған соң оқушылар нәтижелерін көрші топпен салыстырады. Қай ыдыста көбірек су жиналғанын түсіндіргенде, әр мәннің қасына өлшем бірлігін жазыңдар.\n\n[ru.measurements]\nВо время опыта во дворе школы в сосуд A собрали 24 мл, в сосуд B — 36 мл, в сосуд C — 48 мл.\n\n[ru.teacher]\nПеред сравнением проверьте единицу измерения.\n\n[ru.procedure]\nКаждая группа измеряет объём воды в своём сосуде и записывает его в лист наблюдений. Затем группы сверяют записи. Объясните, в каком сосуде собралось больше воды, и укажите единицу измерения рядом с каждым значением.\n\n[en.measurements]\nIn the schoolyard trial, container A collected 24 mL, B collected 36 mL and C collected 48 mL.\n\n[en.teacher]\nCheck the unit before comparing the readings.\n\n[en.procedure]\nEach group measures the water in its container and records the result. Groups then compare their entries. Explain which container collected the most water and write the unit next to every value.\n\n";

const images: Record<string, string> = {
  s01: '/assets/water-lab.webp',
  s02: '/assets/water-lab.webp',
  s04: '/assets/water-lab.webp',
  s08: '/assets/water-lab.webp',
  s10: '/assets/water-lab.webp',
};

export function makeFixtureDeck(language: Locale): Deck {
  const slides = fixture.slides.map((item): Slide => {
    const evidence = (item.evidence?.[language] ?? []).map((id): SourceExcerpt => ({
      id, source: fixture.sourceFile,
      ...fixture.sourceAnchors[id as keyof typeof fixture.sourceAnchors],
    }));
    return {
      id: item.id, layout: item.layout as Layout, lessonPart: item.lessonPart,
      status: 'ready', version: 0, title: item.title[language], body: item.body[language], notes: item.notes[language],
      ...(item.image && { image: { src: images[item.id], alt: item.image.alt[language] } }),
      ...(item.table && { table: { headers: item.table.headers[language], rows: item.table.rows } }),
      ...(item.chart && { chart: {
        categories: item.chart.categories,
        series: item.chart.series.map(series => ({ name: series.name[language], values: series.values })),
        alt: item.chart.alt[language],
      } }),
      ...(item.revealAnswer && { answer: item.revealAnswer[language] }),
      ...(evidence.length > 0 && { evidence }),
    };
  });
  return {
    id: 'schoolyard-' + language, title: slides[0].title, topic: slides[0].body, language,
    theme: language === 'kk' ? 'notebook' : language === 'ru' ? 'laboratory' : 'steppe',
    revision: 0, updatedAt: '2026-11-21T12:00:00.000Z', provider: 'fixture', phase: 'editing',
    outline: slides.map(slide => ({ id: slide.id, title: slide.title, summary: slide.body, layout: slide.layout })),
    slides, source: {name: fixture.sourceFile, text: sourceText}, template: 'measurement',
  };
}
