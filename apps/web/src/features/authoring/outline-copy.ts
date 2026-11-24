const russianSlideCount = new Intl.PluralRules('ru');
const russianSlideForms: Partial<Record<Intl.LDMLPluralRule, string>> = { one: 'слайд', few: 'слайда' };

export const planCopy = {
  en: {
    title: 'Lesson plan', layout: 'Layout', visual: 'Image description', scene: 'Gallery image', narration: 'Draft narration',
    purpose: 'Purpose', details: 'Slide details', own: 'Own images', check: 'Check question',
    slides: (count: number) => `${count} ${count === 1 ? 'slide' : 'slides'}`,
  },
  ru: {
    title: 'План урока', layout: 'Макет', visual: 'Описание изображения', scene: 'Изображение в галерее', narration: 'Черновик озвучивания',
    purpose: 'Цель слайда', details: 'Детали слайда', own: 'Свои изображения', check: 'Контрольный вопрос',
    slides: (count: number) => `${count} ${russianSlideForms[russianSlideCount.select(count)] ?? 'слайдов'}`,
  },
  kk: {
    title: 'Сабақ жоспары', layout: 'Макет', visual: 'Суреттің сипаттамасы', scene: 'Галереядағы сурет', narration: 'Баяндау нобайы',
    purpose: 'Слайд мақсаты', details: 'Слайд мәліметтері', own: 'Өз суреттері', check: 'Бақылау сұрағы',
    slides: (count: number) => `${count} слайд`,
  },
};
