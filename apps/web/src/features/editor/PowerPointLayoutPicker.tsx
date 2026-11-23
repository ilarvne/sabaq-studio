import type { Locale, PowerPointStyle, Slide, SlideChanges } from '@sabaq/lesson/types';
import { OptionSelect } from '@/components/OptionSelect';

const labels={
  en:{name:'PowerPoint layout',default:'Default design'},
  ru:{name:'Макет PowerPoint',default:'Основное оформление'},
  kk:{name:'PowerPoint макеті',default:'Негізгі безендіру'},
};

export function PowerPointLayoutPicker({style,slide,locale,disabled,onChange}:{
  style:PowerPointStyle;slide:Slide;locale:Locale;disabled?:boolean;onChange:(changes:SlideChanges)=>void;
}) {
  const c=labels[locale];
  const layouts=style.layouts.flatMap(layout=>layout.id ? [{...layout,id:layout.id}] : []);
  if(!layouts.length) return null;
  const masters=new Map(style.masters?.map(master=>[master.id,master.name]));
  const options=[{value:'default',label:c.default},...layouts.map(layout=>{
    const master=layout.masterId ? masters.get(layout.masterId) : undefined;
    return {value:layout.id,label:masters.size>1 && master ? layout.name+' · '+master : layout.name};
  })];
  return <OptionSelect label={c.name} value={slide.powerPointLayoutId ?? 'default'} options={options} disabled={disabled}
    onChange={value=>{
      if(value==='default') onChange({powerPointLayoutId:null});
      else {
        const layout=layouts.find(entry=>entry.id===value);
        if(layout) onChange({layout:layout.layout,powerPointLayoutId:layout.id});
      }
    }}/>;
}
