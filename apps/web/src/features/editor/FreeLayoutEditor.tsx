import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { AlignBottomIcon, AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { alignFree, freeIds, groupFree, moveFree, resizeFree, selectedGroup, selectionBounds, stackFree, transformFree, type FreeId, type FreeLayout, type ResizeEdge } from '@sabaq/lesson/free-layout';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { Dialog, DialogPopup, DialogHeader, DialogPanel, DialogDescription, DialogTitle, DialogFooter } from '@/components/coss/dialog';
import { Button } from '@/components/shadcn/button';
import { captureLayout } from './capture-layout';
import './free-layout.css';

export const freeWords={
  en:{name:'Arrange elements',adaptive:'Return to adaptive layout',snap:'Snap to guides',group:'Group',ungroup:'Ungroup',front:'Bring to front',back:'Send to back',save:'Apply layout',close:'Close',pick:'Elements',x:'Left (%)',y:'Top (%)',w:'Width (%)',h:'Height (%)',angle:'Rotation (°)',move:'Move',resize:'Resize',rotate:'Rotate',help:'Drag an element to move it. Use the checkboxes to select several elements, or enter their position and size below.',parts:['Title','Body','Eyebrow','Card 1','Card 2','Card 3','Takeaway','Answer','Image','Table','Chart','Diagram']},
  ru:{name:'Расположение элементов',adaptive:'Вернуть адаптивный макет',snap:'Привязка к направляющим',group:'Сгруппировать',ungroup:'Разгруппировать',front:'На передний план',back:'На задний план',save:'Применить макет',close:'Закрыть',pick:'Элементы',x:'Слева (%)',y:'Сверху (%)',w:'Ширина (%)',h:'Высота (%)',angle:'Поворот (°)',move:'Переместить',resize:'Изменить размер',rotate:'Повернуть',help:'Перетащите элемент или задайте его положение и размер числами. Чтобы выбрать несколько элементов, отметьте их в списке.',parts:['Заголовок','Текст','Надзаголовок','Карточка 1','Карточка 2','Карточка 3','Вывод','Ответ','Изображение','Таблица','Диаграмма','Схема']},
  kk:{name:'Элементтерді орналастыру',adaptive:'Бейімделетін макетке оралу',snap:'Бағыттауыштарға туралау',group:'Топтау',ungroup:'Топты тарату',front:'Алдыңғы қабатқа',back:'Артқы қабатқа',save:'Макетті қолдану',close:'Жабу',pick:'Элементтер',x:'Сол жақ (%)',y:'Үстінен (%)',w:'Ені (%)',h:'Биіктігі (%)',angle:'Бұрылу (°)',move:'Жылжыту',resize:'Өлшемін өзгерту',rotate:'Бұру',help:'Элементті сүйреңіз немесе оның орны мен өлшемін санмен енгізіңіз. Бірнеше элементті таңдау үшін тізімде белгілеңіз.',parts:['Тақырып','Мәтін','Айдар','1-карточка','2-карточка','3-карточка','Түйін','Жауап','Сурет','Кесте','Диаграмма','Сызба']},
};
const alignmentTools=[
  {key:'left',Icon:AlignLeftIcon},{key:'center',Icon:AlignCenterHorizontalIcon},{key:'right',Icon:AlignRightIcon},
  {key:'top',Icon:AlignTopIcon},{key:'middle',Icon:AlignCenterVerticalIcon},{key:'bottom',Icon:AlignBottomIcon},
] as const;
const alignmentCopy={
  en:{group:'Align elements',labels:['Align left','Center horizontally','Align right','Align top','Center vertically','Align bottom']},
  ru:{group:'Выровнять элементы',labels:['По левому краю','По центру горизонтали','По правому краю','По верхнему краю','По центру вертикали','По нижнему краю']},
  kk:{group:'Элементтерді туралау',labels:['Сол жақ шетке туралау','Көлденең ортасына туралау','Оң жақ шетке туралау','Жоғарғы шетке туралау','Тігінен ортасына туралау','Төменгі шетке туралау']},
};
const handles=[
  {x:-1,y:-1},{x:0,y:-1},{x:1,y:-1},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:-1,y:1},{x:-1,y:0},
] as const satisfies readonly ResizeEdge[];
type Mode='move'|'resize'|'rotate';
type Drag={mode:Mode; startX:number; startY:number; ids:FreeId[]; initial:FreeLayout;pointer:number;edge?:ResizeEdge};

function MeasureAdaptiveSlide({slide,deck,onMeasure}:{slide:Slide;deck:Deck;onMeasure:(layout:FreeLayout)=>void}) {
  const container=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const slideNode=container.current?.querySelector<HTMLElement>('.ed-slide');
    if(!slideNode) return;
    const measure=()=>{
      if(!slideNode.clientWidth) return false;
      onMeasure(captureLayout(slide,slideNode));
      return true;
    };
    if(measure()) return;
    const observer=new ResizeObserver(()=>{if(measure())observer.disconnect();});
    observer.observe(slideNode);
    return ()=>observer.disconnect();
  },[slide,onMeasure]);
  return <div ref={container}><SlideCanvas slide={slide} deck={deck}/></div>;
}

export function FreeLayoutEditor({slide,deck,locale,initial,onSave,onClose}:{
  slide:Slide;deck:Deck;locale:Locale;initial:FreeLayout;onSave:(layout:FreeLayout|null)=>void;onClose:()=>void;
}) {
  const t=freeWords[locale], name=(id:FreeId)=>t.parts[freeIds.indexOf(id)];
  const [draft,setDraft]=useState<FreeLayout|null>(slide.freeLayout?initial:null);
  const layout=draft ?? initial, setLayout=setDraft;
  const [selected,setSelected]=useState<FreeId[]>([initial.items.find(item=>item.id==='title')?.id ?? initial.items[0].id]);
  const [snap,setSnap]=useState(true),[guides,setGuides]=useState<{x?:number;y?:number}>({});
  const canvas=useRef<HTMLDivElement>(null), dragging=useRef<Drag|null>(null);
  const ids=selectedGroup(layout,selected), picked=layout.items.filter(item=>ids.includes(item.id));
  const bounds=picked.length ? selectionBounds(picked) : undefined;
  const dimensions=picked.length===1 ? picked[0] : bounds;
  const rotation=picked[0]?.rotation ?? 0;
  const sameGroup=!!picked[0]?.group && picked.every(item=>item.group===picked[0].group);
  function toggle(id:FreeId) {
    const together=selectedGroup(layout,[id]);
    setSelected(ids.includes(id) ? ids.filter(el=>!together.includes(el)) : [...ids,...together]);
  }
  function point(event:PointerEvent) {
    const rect=canvas.current!.getBoundingClientRect();
    return {x:100*(event.clientX-rect.left)/rect.width,y:100*(event.clientY-rect.top)/rect.height};
  }
  function start(event:PointerEvent<HTMLButtonElement>,mode:Mode,id?:FreeId,edge?:ResizeEdge) {
    if(event.button!==0) return;
    if(id && event.shiftKey) {toggle(id);return;}
    const targets=id && !ids.includes(id) ? selectedGroup(layout,[id]) : ids;
    if(!targets.length) return;
    setSelected(targets);
    const pos=point(event);
    dragging.current={mode,startX:pos.x,startY:pos.y,ids:targets,initial:layout,pointer:event.pointerId,edge};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    const drag=dragging.current;
    if(!drag || drag.pointer!==event.pointerId) return;
    const {x,y}=point(event),dx=x-drag.startX,dy=y-drag.startY;
    const b=selectionBounds(drag.initial.items.filter(item=>drag.ids.includes(item.id)));
    if(drag.mode==='move') {
      const result=moveFree(drag.initial,drag.ids,dx,dy,snap);
      setLayout(result.layout);setGuides(result.guides);
    } else if(drag.mode==='resize' && drag.edge) {
      setLayout(resizeFree(drag.initial,drag.ids,drag.edge,dx,dy,event.shiftKey));
    } else {
      const angle=(mx:number,my:number)=>Math.atan2(my-b.y-b.h/2,(mx-b.x-b.w/2)*16/9)*180/Math.PI;
      setLayout(transformFree(drag.initial,drag.ids,{degrees:angle(x,y)-angle(drag.startX,drag.startY)}));
    }
  }
  function number(key:'x'|'y'|'w'|'h'|'angle',value:number) {
    if(!bounds || !dimensions || !Number.isFinite(value)) return;
    if(key==='x' || key==='y') setLayout(moveFree(layout,ids,key==='x'?value-bounds.x:0,key==='y'?value-bounds.y:0,false).layout);
    else if(key==='angle') setLayout(transformFree(layout,ids,{degrees:value-rotation}));
    else setLayout(transformFree(layout,ids,key==='w' ? {scaleX:value/dimensions.w} : {scaleY:value/dimensions.h}));
  }
  const stop=()=>{dragging.current=null;setGuides({});};
  return <Dialog defaultOpen onOpenChange={open=>{if(!open)onClose();}}>
    <DialogPopup className="free-layout-dialog" closeProps={{'aria-label':t.close,title:t.close}}>
      <DialogHeader><DialogTitle>{t.name}</DialogTitle></DialogHeader>
      <DialogPanel>
        <div className="free-workspace">
        <div className="free-canvas-column">
        <div ref={canvas} className="free-stage" onPointerMove={move} onPointerUp={stop} onPointerCancel={event=>{
          if(dragging.current?.pointer===event.pointerId) {setLayout(dragging.current.initial);stop();}
        }}>
          <div inert aria-hidden="true">{draft
            ? <SlideCanvas slide={{...slide,freeLayout:layout}} deck={deck}/>
            : <MeasureAdaptiveSlide slide={slide} deck={deck} onMeasure={setDraft}/>}</div>
          {layout.items.map(item=><button key={item.id} type="button" className="free-hit"
            aria-label={t.move+' · '+name(item.id)} aria-pressed={ids.includes(item.id)} title={name(item.id)}
            style={{left:item.x+'%',top:item.y+'%',width:item.w+'%',height:item.h+'%',transform:'rotate('+item.rotation+'deg)'}}
            onPointerDown={event=>start(event,'move',item.id)}
            onClick={event=>{if(event.detail===0)setSelected(selectedGroup(layout,[item.id]));}}
            onKeyDown={event=>{
              const step=event.shiftKey?5:1, directions:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
              if(!directions[event.key]) return;
              event.preventDefault();const target=ids.includes(item.id)?ids:selectedGroup(layout,[item.id]);
              setSelected(target);setLayout(moveFree(layout,target,...directions[event.key],false).layout);
            }}/>)}
          {bounds && <>
            <div className="free-selection" aria-hidden="true" style={{left:bounds.x+'%',top:bounds.y+'%',width:bounds.w+'%',height:bounds.h+'%'}}/>
            {handles.map(edge=><button key={edge.x+','+edge.y} type="button" className="free-handle handle-resize"
              title={t.resize} aria-label={t.resize} tabIndex={-1}
              style={{left:(bounds.x+(edge.x+1)*bounds.w/2)+'%',top:(bounds.y+(edge.y+1)*bounds.h/2)+'%',
                cursor:edge.x===0?'ns-resize':edge.y===0?'ew-resize':edge.x===edge.y?'nwse-resize':'nesw-resize'}}
              onPointerDown={event=>start(event,'resize',undefined,edge)}/>)}
            <button type="button" className="free-handle handle-rotate" title={t.rotate} aria-label={t.rotate} tabIndex={-1}
              style={{left:(bounds.x+bounds.w/2)+'%',top:`max(12px, calc(${bounds.y}% - 20px))`}}
              onPointerDown={event=>start(event,'rotate')}><ArrowClockwiseIcon aria-hidden/></button>
          </>}
          {guides.x!==undefined && <i aria-hidden className="free-guide free-guide-x" style={{left:guides.x+'%'}}/>}
          {guides.y!==undefined && <i aria-hidden className="free-guide free-guide-y" style={{top:guides.y+'%'}}/>}
        </div>
        <DialogDescription className="free-help">{t.help}</DialogDescription>
        <label className="free-snap"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/>{t.snap}</label>
        </div>
        <div className="free-properties">
        <fieldset className="free-options"><legend>{t.pick}</legend>{layout.items.map(item=><label key={item.id}>
          <input type="checkbox" checked={ids.includes(item.id)} onChange={()=>toggle(item.id)}/>{name(item.id)}</label>)}</fieldset>
        {bounds && dimensions && <div className="free-numbers">{(['x','y','w','h','angle'] as const).map(key=>{
          const value=Math.round((key==='angle'?rotation:key==='w' || key==='h'?dimensions[key]:bounds[key])*100)/100;
          return <label key={key}>{t[key]}<input key={String(value)+ids.join('/')} type="number" step=".1" defaultValue={value}
            onBlur={event=>{if(event.target.value && event.target.valueAsNumber!==value)number(key,event.target.valueAsNumber);}}
            onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>;
        })}</div>}
        <div className="free-align" role="group" aria-label={alignmentCopy[locale].group}>
          {alignmentTools.map(({key,Icon},index)=><Button key={key} type="button" variant="outline" size="icon-sm"
            disabled={!ids.length} aria-label={alignmentCopy[locale].labels[index]} title={alignmentCopy[locale].labels[index]}
            onClick={()=>setLayout(alignFree(layout,ids,key))}><Icon aria-hidden/></Button>)}
        </div>
        <div className="free-actions">
          <Button type="button" variant="outline" size="sm" disabled={ids.length<2 || sameGroup} onClick={()=>setLayout(groupFree(layout,ids,crypto.randomUUID()))}>{t.group}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!picked.some(item=>item.group)} onClick={()=>setLayout(groupFree(layout,ids))}>{t.ungroup}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!ids.length} onClick={()=>setLayout(stackFree(layout,ids,true))}>{t.front}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!ids.length} onClick={()=>setLayout(stackFree(layout,ids,false))}>{t.back}</Button>
        </div>
        </div>
        </div>
      </DialogPanel>
        <DialogFooter>{slide.freeLayout && <Button variant="outline" onClick={()=>onSave(null)}>{t.adaptive}</Button>}
          <Button onClick={()=>onSave(layout)}>{t.save}</Button></DialogFooter>
    </DialogPopup>
  </Dialog>;
}
