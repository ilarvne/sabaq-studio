import { brandContrast, lessonPalette } from './themes';
import type { Deck, ImageStyle, Locale, Theme } from './types';

const defaults: Record<Theme,ImageStyle> = {
  notebook:'watercolor',laboratory:'schematic',steppe:'watercolor',contrast:'photograph',
  editorial:'illustration',minimal:'schematic',blueprint:'schematic',midnight:'illustration',
  museum:'photograph',atlas:'watercolor',chalkboard:'schematic',newsprint:'photograph',
  'field-notes':'photograph',collage:'illustration',spotlight:'photograph',strategy:'illustration',signal:'schematic',
};

export const imageStyleNames: Record<Locale,Record<ImageStyle,string>> = {
  en:{illustration:'Illustration',schematic:'Diagram',watercolor:'Watercolor',photograph:'Photograph'},
  ru:{illustration:'Иллюстрация',schematic:'Схема',watercolor:'Акварель',photograph:'Фотография'},
  kk:{illustration:'Иллюстрация',schematic:'Сызба',watercolor:'Акварель',photograph:'Фотосурет'},
};

export function defaultImageStyle(theme:Theme):ImageStyle {
  return defaults[theme] ?? 'illustration';
}

export function lessonImageGuidance(deck:Pick<Deck,'imageStyle'|'theme'|'brand'|'powerPointStyle'>) {
  const {paper}=lessonPalette(deck);
  const dark=brandContrast(paper,'#ffffff')>=4.5;
  return {
    style:deck.imageStyle ?? defaultImageStyle(deck.theme),
    avoidCatalog:dark || Boolean(deck.imageStyle && deck.imageStyle!=='illustration'),
    ...(dark && {darkPaper:paper}),
  };
}
