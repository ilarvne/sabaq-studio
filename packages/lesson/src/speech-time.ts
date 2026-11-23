import type { Locale } from './types';

export function speechSeconds(text: string, wordsPerMinute = 126) {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(6, Math.ceil(words * 60 / wordsPerMinute));
}

export function formatTimeUnit(amount: number, locale: Locale, unit: 'minute' | 'second') {
  return new Intl.NumberFormat(locale, {style:'unit', unit, unitDisplay:'short'}).format(amount);
}

export function formatSpeechTime(seconds: number, locale: Locale) {
  if (seconds < 60) return formatTimeUnit(seconds,locale,'second');
  const minutes = formatTimeUnit(Math.floor(seconds / 60),locale,'minute');
  const remainder = seconds % 60;
  return remainder ? `${minutes} ${formatTimeUnit(remainder,locale,'second')}` : minutes;
}
