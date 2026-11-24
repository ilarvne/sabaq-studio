import type { Locale, Slide, Theme } from '@sabaq/lesson/types';

export type DemoLesson = {
  key: string;
  language: Locale;
  theme: Theme;
  template: string;
  topic: string;
  sourceText: string;
  slides: Omit<Slide, 'id' | 'status' | 'version'>[];
};
