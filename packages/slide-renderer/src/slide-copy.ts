import type { Locale } from '@sabaq/lesson/types';

export const slideCopy = {
  en: {
    slide: 'Slide',
    chart: 'Chart',
    table: 'Table',
    answer: 'Answer',
    pendingText: 'The slide will appear here when it is ready.',
    errorText: 'Generation stopped for this slide.',
    cancelledText: 'Generation was cancelled for this slide.',
  },
  ru: {
    slide: 'Слайд',
    chart: 'Диаграмма',
    table: 'Таблица',
    answer: 'Ответ',
    pendingText: 'Слайд появится здесь, когда будет готов.',
    errorText: 'Не удалось сформировать этот слайд.',
    cancelledText: 'Формирование этого слайда отменено.',
  },
  kk: {
    slide: 'Слайд',
    chart: 'Диаграмма',
    table: 'Кесте',
    answer: 'Жауап',
    pendingText: 'Слайд дайын болғанда осында пайда болады.',
    errorText: 'Бұл слайдты жасау мүмкін болмады.',
    cancelledText: 'Бұл слайдты жасау тоқтатылды.',
  },
};

const lessonParts: Record<string, Record<Locale, string>> = {
  goal: { kk: 'Сабақтың мақсаты', ru: 'Цель урока', en: 'Lesson objective' },
  recall: { kk: 'Алдыңғы білім', ru: 'Актуализация знаний', en: 'Prior knowledge' },
  'new-material': { kk: 'Жаңа материал', ru: 'Новый материал', en: 'New material' },
  example: { kk: 'Мысал', ru: 'Пример', en: 'Worked example' },
  practice: { kk: 'Жаттығу', ru: 'Практика', en: 'Practice' },
  check: { kk: 'Тексеру сұрағы', ru: 'Проверка знаний', en: 'Knowledge check' },
  summary: { kk: 'Қорытынды', ru: 'Итог урока', en: 'Summary' },
  homework: { kk: 'Үй тапсырмасы', ru: 'Домашнее задание', en: 'Homework' },
};
export function lessonPartLabel(part: string, locale: Locale) {
  return lessonParts[part]?.[locale] || part;
}
