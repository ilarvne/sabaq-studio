import { useState, type FormEvent } from 'react';
import { Button } from '@/components/shadcn/button';
import { Input } from '@/components/coss/input';
import { Dialog, DialogPopup, DialogHeader, DialogPanel, DialogTitle, DialogFooter } from '@/components/coss/dialog';
import { diagramNames, diagramKinds, diagramAltLimit, diagramLabelLimit, type SlideDiagram } from '@sabaq/lesson/diagram';
import type { Locale } from '@sabaq/lesson/types';

export const diagramWords = {
  en:{make:'Diagram from selection',edit:'Edit diagram',type:'Diagram type',node:'Node',add:'Add node',remove:'Remove',save:'Save diagram',create:'Add diagram slide',close:'Close',help:'Use 3–7 items, one per line. The first item is the main idea in a mind map.',count:'Enter 3–7 items.',length:'Each node needs 1–140 characters.'},
  ru:{make:'Схема из выделенного текста',edit:'Изменить схему',type:'Вид схемы',node:'Узел',add:'Добавить узел',remove:'Удалить',save:'Сохранить схему',create:'Добавить слайд со схемой',close:'Закрыть',help:'Введите 3–7 пунктов, по одному на строку. Для интеллект-карты первый пункт — главная идея.',count:'Введите от 3 до 7 пунктов.',length:'В узле должно быть от 1 до 140 символов.'},
  kk:{make:'Белгіленген мәтіннен сызба',edit:'Сызбаны өңдеу',type:'Сызба түрі',node:'Түйін',add:'Түйін қосу',remove:'Жою',save:'Сызбаны сақтау',create:'Сызбасы бар слайд қосу',close:'Жабу',help:'Әр жолға бір тармақтан, барлығы 3–7 тармақ енгізіңіз. Ой картасында бірінші тармақ негізгі ойды білдіреді.',count:'3–7 тармақ енгізіңіз.',length:'Әр түйінде 1–140 таңба болуы керек.'},
};
const descriptions = {
  en:{label:'Diagram description',automatic:'Use an automatic description'},
  ru:{label:'Описание схемы',automatic:'Использовать автоматическое описание'},
  kk:{label:'Сызба сипаттамасы',automatic:'Автоматты сипаттаманы пайдалану'},
};

export function DiagramEditor({initial,editing,locale,language,onSave,onClose}:{
  initial:SlideDiagram; editing:boolean; locale:Locale; language:Locale;
  onSave:(diagram:SlideDiagram)=>void; onClose:()=>void;
}) {
  const t=diagramWords[locale];
  const description=descriptions[locale];
  const [kind,setKind]=useState(initial.kind);
  const [nodes,setNodes]=useState(initial.nodes);
  const [raw,setRaw]=useState(initial.nodes.length<3 || initial.nodes.length>7);
  const [alt,setAlt]=useState(initial.alt ?? '');
  const values=nodes.map(value=>value.trim());
  const countValid=values.length>=3 && values.length<=7;
  const error=!countValid ? t.count : values.some(node=>!node || node.length>diagramLabelLimit) ? t.length : '';
  function save(event:FormEvent) {
    event.preventDefault();
    if(!error) onSave({kind,nodes:values,...(alt.trim() && {alt:alt.trim()})});
  }
  return <Dialog defaultOpen onOpenChange={open=>{if(!open)onClose();}}>
    <DialogPopup className="inspector-dialog" closeProps={{'aria-label':t.close,title:t.close}}>
      <DialogHeader><DialogTitle>{editing ? t.edit : t.make}</DialogTitle></DialogHeader>
      <DialogPanel><form className="ed-diagram-form" onSubmit={save}>
        <label>{t.type}<select value={kind} onChange={event=>setKind(event.target.value as SlideDiagram['kind'])}>
          {diagramKinds.map(type=><option key={type} value={type}>{diagramNames[locale][type]}</option>)}
        </select></label>
        <p>{t.help}</p>
        {raw ? <label>{t.node}<textarea lang={language} rows={7} value={nodes.join('\n')}
          onChange={event=>setNodes(event.target.value.split('\n'))}/></label> :
          nodes.map((node,i)=><div className="ed-diagram-field" key={i}>
            <label>{t.node} {i+1}<Input lang={language} value={node}
              onChange={event=>setNodes(nodes.map((v,j)=>j===i ? event.target.value : v))}/></label>
            <Button type="button" variant="ghost" size="sm" disabled={nodes.length<=3} aria-label={t.remove+' · '+t.node+' '+(i+1)}
              onClick={()=>setNodes(nodes.filter((_,j)=>j!==i))}>{t.remove}</Button>
          </div>)}
        {raw && countValid && <Button variant="outline" type="button" onClick={()=>setRaw(false)}>{t.edit}</Button>}
        {!raw && nodes.length<7 && <Button variant="outline" type="button" onClick={()=>setNodes([...nodes,''])}>{t.add}</Button>}
        <label>{description.label}<textarea rows={2} lang={language} maxLength={diagramAltLimit}
          placeholder={description.automatic} value={alt} onChange={event=>setAlt(event.target.value)}/></label>
        {error && <p role="status">{error}</p>}
        <DialogFooter variant="bare"><Button type="submit" disabled={Boolean(error)}>{editing ? t.save : t.create}</Button></DialogFooter>
      </form></DialogPanel>
    </DialogPopup>
  </Dialog>;
}
