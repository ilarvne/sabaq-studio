import type { Locale } from '@sabaq/lesson/types';

export type ClassroomQuestion = {
  kind: 'poll' | 'quiz' | 'words';
  question: string;
  options: string[];
  language: Locale;
};
export type ClassroomPoll = ClassroomQuestion & {
  code: string; expires: number; counts: number[]; correct?: number;
};
