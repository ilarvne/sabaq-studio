import { useMemo } from 'react';
import { ComposerPrimitive, defaultDirectiveFormatter, unstable_useMentionAdapter } from '@assistant-ui/react';
import type { Deck, Locale } from '@sabaq/lesson/types';

const copy = {
  en:{slides:'Mention a slide', slide:'Slide', focused:'this slide', missing:'A referenced slide was removed.'},
  ru:{slides:'Упомянуть слайд', slide:'Слайд', focused:'этот слайд', missing:'Один из упомянутых слайдов удалён.'},
  kk:{slides:'Слайдты белгілеу', slide:'Слайд', focused:'осы слайд', missing:'Белгіленген слайдтардың бірі жойылған.'},
};

export function resolveSlideMentions(text: string, deck: Deck, locale: Locale) {
  const segments = defaultDirectiveFormatter.parse(text);
  const targets = new Set(segments.flatMap(segment=>
    segment.kind==='mention' && segment.type==='slide' ? [segment.id] : [],
  ));
  if (!targets.size) return {text};
  const numbers = new Map(deck.slides.map((slide,index)=>[slide.id,index+1]));
  if ([...targets].some(id=>!numbers.has(id))) return {text,error:copy[locale].missing};
  const slideId = targets.size===1 ? targets.values().next().value : undefined;
  const normalized = segments.map(segment=>{
    if (segment.kind==='text') return segment.text;
    if (segment.type!=='slide') return segment.label;
    return slideId ? copy[locale].focused : `${copy[locale].slide} ${numbers.get(segment.id)}`;
  }).join('');
  return {text:normalized,slideId};
}

export function AssistantMentions({deck,locale}: {deck:Deck;locale:Locale}) {
  const items = useMemo(()=>deck.slides.map((slide,index)=>({
    id:slide.id, type:'slide', label:`${copy[locale].slide} ${index+1}`, description:slide.title,
  })),[deck.slides,locale]);
  const {adapter,directive} = unstable_useMentionAdapter({items,includeModelContextTools:false});
  return <ComposerPrimitive.TriggerPopover char="@" adapter={adapter} className="as-mentions" aria-label={copy[locale].slides}>
    <ComposerPrimitive.TriggerPopover.Directive {...directive}/>
    <ComposerPrimitive.TriggerPopoverItems className="as-mentions-list">
      {results=>results.map((item,index)=>(
        <ComposerPrimitive.TriggerPopoverItem type="button" className="as-mentions-option"
          key={item.id} item={item} index={index}>
          <span>{item.label}</span>
          <span lang={deck.language}>{item.description}</span>
        </ComposerPrimitive.TriggerPopoverItem>
      ))}
    </ComposerPrimitive.TriggerPopoverItems>
  </ComposerPrimitive.TriggerPopover>;
}
