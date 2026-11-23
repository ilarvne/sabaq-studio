import type { Locale } from '@sabaq/lesson/types';

const months: Record<Locale, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  kk: ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'],
};

export function formatStudioDate(
  value: string | number | Date,
  locale: Locale,
  options: { utc?: boolean; time?: boolean } = {},
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = options.utc ? date.getUTCDate() : date.getDate();
  const month = months[locale][options.utc ? date.getUTCMonth() : date.getMonth()];
  const label = locale === 'en' ? `${month} ${day}` : `${day} ${month}`;
  if (!options.time) return label;
  const hours = options.utc ? date.getUTCHours() : date.getHours();
  const minutes = options.utc ? date.getUTCMinutes() : date.getMinutes();
  return `${label}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
