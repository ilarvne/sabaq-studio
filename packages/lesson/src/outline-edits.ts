import type { Locale, OutlineItem } from './types';

export function splitSummary(summary: string, locale: Locale): [string,string] {
  const sentences = [...new Intl.Segmenter(locale,{granularity:'sentence'}).segment(summary)].map(s=>s.segment.trim()).filter(Boolean);
  const parts = sentences.length > 1 ? sentences : summary.trim().split(/\s+/u);
  const half = Math.ceil(parts.length/2);
  return [parts.slice(0,half).join(' '), parts.slice(half).join(' ')];
}
export function presentationTitle(topic: string, locale: Locale, outline: OutlineItem[]) {
  const heading = outline[0]?.title;
  const label = {en:'Exploring',ru:'Изучаем',kk:'Зерттеу'}[locale];
  const candidate = heading && heading.trim().toLowerCase() !== topic.trim().toLowerCase() ? heading : label+' · '+topic;
  const chars = [...candidate.replace(/\s+/gu,' ').trim()];
  return chars.length <= 60 ? chars.join('') : chars.slice(0,59).join('').trimEnd()+'…';
}
