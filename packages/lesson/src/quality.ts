import type { Locale, Theme } from './types';

const wording = {
  overflow: ['Мәтін шекарадан шығады', 'Текст выходит за границу', 'Text extends beyond the slide or its container'],
  overlap: ['Элементтер қабаттасады', 'Элементы перекрываются', 'Text or content overlaps another element'],
  'repeated-layout': ['Үш не одан көп слайдта бір макет қатарынан қолданылған', 'Один макет используется на трёх или более слайдах подряд', 'Three or more consecutive slides use the same layout'],
  contrast: ['Мәтін контрасты төмен', 'Низкий контраст текста', 'Text has insufficient contrast'],
  'graphic-contrast': ['Диаграмма контрасты төмен', 'Низкий контраст графики диаграммы', 'Chart or diagram graphics have insufficient contrast'],
  'graphic-contrast-review': ['Графиканың фонмен контрастын тексеріңіз', 'Проверьте контраст графики на фоне', 'Check the graphics against the background'],
  'contrast-review': ['Фон үстіндегі контрастты тексеріңіз', 'Проверьте контраст на сложном фоне', 'Check contrast against the image or gradient'],
  'small-type': ['Мәтін ұсақ', 'Размер текста ниже порога', 'Text is below the presentation size threshold'],
  'image-crop': ['Суреттің қиылған жерін тексеріңіз', 'Проверьте кадрирование изображения', 'Check the cropped area of the image'],
  'missing-title': ['Тақырыпты қосыңыз', 'Добавьте заголовок', 'Add a slide title'],
  'empty-content': ['Слайд мазмұнын толтырыңыз', 'Заполните содержимое слайда', 'Add the missing slide content'],
  'missing-alt': ['Суретті немесе диаграмманы сипаттаңыз', 'Опишите изображение или диаграмму', 'Describe the image or chart'],
} as const;
export type QualityIssue = keyof typeof wording;
export type QualityReport = { version: number; issues: QualityIssue[] };
export type QualityReview =
  | { state: 'pending'; key: string; repair: Record<string, number> }
  | { state: 'reviewed' | 'unavailable'; theme: Theme; slides: Record<string, QualityReport> };
export const issueLabel = (issue: QualityIssue, locale: Locale) => wording[issue][{ kk: 0, ru: 1, en: 2 }[locale]];
