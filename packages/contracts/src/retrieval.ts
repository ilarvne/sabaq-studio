/** Offsets count Unicode code points in the named source or slide field, with an exclusive end. */
export type LessonCitation = {
  id: string;
  kind: 'source' | 'slide';
  label: string;
  field: string;
  excerpt: string;
  start: number;
  end: number;
  slideId?: string;
  sourceFileId?: string;
  url?: string;
};

export type LessonSearchResult = { mode: 'lexical' | 'hybrid'; hits: LessonCitation[] };
