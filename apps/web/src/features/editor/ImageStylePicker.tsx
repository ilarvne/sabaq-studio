import { defaultImageStyle, imageStyleNames } from '@sabaq/lesson/image-style';
import { imageStyles, type Deck, type ImageStyle, type Locale } from '@sabaq/lesson/types';
import { OptionSelect } from '@/components/OptionSelect';

const labels={
  en:{name:'Image style',theme:'Theme default',details:'Applies when generating new images.'},
  ru:{name:'Стиль изображений',theme:'По теме',details:'Применяется при создании новых изображений.'},
  kk:{name:'Сурет стилі',theme:'Тақырып бойынша',details:'Жаңа суреттер жасағанда қолданылады.'},
};

export function ImageStylePicker({deck,locale,disabled,onChange}:{
  deck:Pick<Deck,'theme'|'imageStyle'>;locale:Locale;disabled?:boolean;onChange:(style:ImageStyle|null)=>void;
}) {
  const c=labels[locale],names=imageStyleNames[locale];
  const options=[{value:'theme' as const,label:c.theme+' · '+names[defaultImageStyle(deck.theme)]},
    ...imageStyles.map(value=>({value,label:names[value]}))];
  return <div className="grid justify-items-start gap-2">
    <span className="inspect-label">{c.name}</span>
    <OptionSelect label={c.name} value={deck.imageStyle ?? 'theme'} options={options} disabled={disabled}
      onChange={value=>onChange(value==='theme' ? null : value)}/>
    <small className="text-muted-foreground">{c.details}</small>
  </div>;
}
