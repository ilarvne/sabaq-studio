import type { Locale } from '@sabaq/lesson/types';

const flags: Record<Locale, string> = { kk: 'kz', ru: 'ru', en: 'gb' };

export function LanguageFlag({ locale }: { locale: Locale }) {
  return <img className="studio-language-flag" src={`/assets/flags/${flags[locale]}.svg`}
    width="20" height="15" alt="" aria-hidden="true" draggable={false}/>;
}
