import type { Layout, Locale } from '@sabaq/lesson/types';

export const slideLayoutNames: Record<Locale, Record<Layout, string>> = {
  en: {
    stacked: 'Stacked', split: 'Two columns', centered: 'Centered', cover: 'Cover', body: 'Text', quote: 'Quotation',
    'image-left': 'Image on left', 'image-right': 'Image on right', 'image-full': 'Full image',
    'image-grid': 'Image grid', 'image-section': 'Image section divider', 'native-table': 'Table',
    'data-chart': 'Chart', 'avatar-right': 'Avatar on right',
  },
  ru: {
    stacked: 'По вертикали', split: 'Две колонки', centered: 'По центру', cover: 'Обложка', body: 'Текст', quote: 'Цитата',
    'image-left': 'Изображение слева', 'image-right': 'Изображение справа', 'image-full': 'Фоновое изображение',
    'image-grid': 'Сетка изображений', 'image-section': 'Раздел с изображением', 'native-table': 'Таблица',
    'data-chart': 'Диаграмма', 'avatar-right': 'Аватар справа',
  },
  kk: {
    stacked: 'Тігінен', split: 'Екі баған', centered: 'Ортасына', cover: 'Мұқаба', body: 'Мәтін', quote: 'Дәйексөз',
    'image-left': 'Сурет сол жақта', 'image-right': 'Сурет оң жақта', 'image-full': 'Фондық сурет',
    'image-grid': 'Суреттер торы', 'image-section': 'Суретті бөлім', 'native-table': 'Кесте',
    'data-chart': 'Диаграмма', 'avatar-right': 'Аватар оң жақта',
  },
};
