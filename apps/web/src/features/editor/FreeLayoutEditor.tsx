import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AlignBottomIcon, AlignCenterHorizontalIcon, AlignCenterVerticalIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { alignFree, freeIds, freeImageIds, groupFree, isFreeImageId, moveFree, resizeFree, selectedGroup, selectionBounds, slideRatio, stackFree, transformFree, type FreeGuides, type FreeId, type FreeLayout, type ResizeEdge } from '@sabaq/lesson/free-layout';
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
const canvasLabel={en:'Slide canvas',ru:'Холст слайда',kk:'Слайд кенебі'};
const arrowDirection:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
const snapPixels=7;
type Mode='move'|'resize'|'rotate';
type Drag={mode:Mode; startX:number; startY:number; ids:FreeId[]; initial:FreeLayout;preview:FreeLayout;pointer:number;edge?:ResizeEdge;axis?:'x'|'y'};

export function elementNames(layout:FreeLayout,locale:Locale) {
  const labels=freeWords[locale].parts;
  const numberImages=layout.items.filter(item=>isFreeImageId(item.id)).length>1;
  return (id:FreeId)=>isFreeImageId(id)
    ? labels[freeIds.indexOf('image')] + (numberImages ? ' '+(freeImageIds.indexOf(id)+1) : '')
    : labels[freeIds.indexOf(id)];
}

function toggledSelection(layout:FreeLayout,ids:FreeId[],id:FreeId) {
  const together=selectedGroup(layout,[id]);
  return ids.includes(id) ? ids.filter(el=>!together.includes(el)) : [...ids,...together];
}

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
  return <div ref={container}><SlideCanvas slide={slide} deck={deck} revealAnswer/></div>;
}

export function FreeLayoutOverlay({layout,locale,selection,onSelectionChange,onChange,onCommit,onCancel,snap=true,hitTargets=true,moveGuides}:{
  layout:FreeLayout;locale:Locale;selection:FreeId[];onSelectionChange:(ids:FreeId[])=>void;
  onChange:(layout:FreeLayout)=>void;onCommit?:(layout:FreeLayout)=>void;onCancel?:()=>void;
  snap?:boolean;hitTargets?:boolean;moveGuides?:FreeGuides;
}) {
  const t=freeWords[locale],name=elementNames(layout,locale);
  const [guides,setGuides]=useState<FreeGuides>({});
  const canvas=useRef<HTMLDivElement>(null), dragging=useRef<Drag|null>(null);
  const ids=selectedGroup(layout,selection),picked=layout.items.filter(item=>ids.includes(item.id));
  const bounds=picked.length ? selectionBounds(picked) : undefined;
  function point(event:PointerEvent) {
    const rect=canvas.current!.getBoundingClientRect();
    return {x:100*(event.clientX-rect.left)/rect.width,y:100*(event.clientY-rect.top)/rect.height,width:rect.width,height:rect.height};
  }
  function start(event:PointerEvent<HTMLButtonElement>,mode:Mode,id?:FreeId,edge?:ResizeEdge) {
    if(event.button!==0 || dragging.current) return;
    if(id && event.shiftKey) {onSelectionChange(toggledSelection(layout,ids,id));return;}
    const targets=id && !ids.includes(id) ? selectedGroup(layout,[id]) : ids;
    if(!targets.length) return;
    onSelectionChange(targets);
    const pos=point(event);
    dragging.current={mode,startX:pos.x,startY:pos.y,ids:targets,initial:layout,preview:layout,pointer:event.pointerId,edge};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    const drag=dragging.current;
    if(!drag || drag.pointer!==event.pointerId) return;
    const {x,y,width,height}=point(event);
    const dx=x-drag.startX,dy=y-drag.startY;
    let next:FreeLayout;
    if(drag.mode==='move') {
      drag.axis=event.shiftKey ? drag.axis ?? (Math.abs(dx*width)>=Math.abs(dy*height)?'x':'y') : undefined;
      const activeSnap=snap && !event.altKey;
      const threshold={x:activeSnap && drag.axis!=='y' ? 100*snapPixels/width : 0,y:activeSnap && drag.axis!=='x' ? 100*snapPixels/height : 0};
      const result=moveFree(drag.initial,drag.ids,drag.axis==='y'?0:dx,drag.axis==='x'?0:dy,threshold);
      next=result.layout;
      setGuides(result.guides);
    } else if(drag.mode==='resize' && drag.edge) {
      next=resizeFree(drag.initial,drag.ids,drag.edge,dx,dy,event.shiftKey);
    } else {
      const b=selectionBounds(drag.initial.items.filter(item=>drag.ids.includes(item.id)));
      const angle=(mx:number,my:number)=>Math.atan2(my-b.y-b.h/2,(mx-b.x-b.w/2)*slideRatio)*180/Math.PI;
      next=transformFree(drag.initial,drag.ids,{degrees:angle(x,y)-angle(drag.startX,drag.startY)});
    }
    if(next!==drag.preview) {
      drag.preview=next;
      onChange(next);
    }
  }
  function end(event:PointerEvent,restore=false) {
    const drag=dragging.current;
    if(!drag || drag.pointer!==event.pointerId) return;
    dragging.current=null;
    if(restore) {
      if(onCancel) onCancel();
      else onChange(drag.initial);
    }
    else if(drag.preview!==drag.initial) onCommit?.(drag.preview);
    setGuides({});
  }
  function onCanvasKey(event:KeyboardEvent<HTMLDivElement>) {
    if(event.defaultPrevented || dragging.current) return;
    if(event.key.toLowerCase()==='a' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelectionChange(layout.items.map(item=>item.id));
      return;
    }
    const direction=arrowDirection[event.key];
    if(!direction || event.metaKey || event.ctrlKey || event.altKey) return;
    const focused=(event.target as HTMLElement).closest<HTMLElement>('[data-free-layer]')?.dataset.freeLayer as FreeId|undefined;
    const targets=focused && !ids.includes(focused) ? selectedGroup(layout,[focused]) : ids;
    if(!targets.length) return;
    event.preventDefault();
    onSelectionChange(targets);
    const step=event.shiftKey?10:1;
    const [dx,dy]=direction;
    const next=moveFree(layout,targets,100*dx*step/1280,100*dy*step/720,false).layout;
    if(next!==layout) {
      onChange(next);
      onCommit?.(next);
    }
  }
  const visibleGuides=moveGuides ?? guides;
  return <div ref={canvas} className="free-overlay" data-handles-only={!hitTargets || undefined}
          role="group" aria-label={canvasLabel[locale]} tabIndex={hitTargets ? 0 : undefined}
          onKeyDown={hitTargets ? onCanvasKey : undefined} onPointerMove={move} onPointerUp={end}
          onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}
          onPointerDown={event=>{
            if(event.button===0 && event.target===event.currentTarget) onSelectionChange([]);
          }}>
          {hitTargets && layout.items.map(item=><button key={item.id} type="button" className="free-hit" data-free-layer={item.id}
            aria-label={t.move+' · '+name(item.id)} aria-pressed={ids.includes(item.id)} title={name(item.id)}
            style={{left:item.x+'%',top:item.y+'%',width:item.w+'%',height:item.h+'%',transform:'rotate('+item.rotation+'deg)'}}
            onPointerDown={event=>start(event,'move',item.id)}
            onClick={event=>{
              if(event.detail!==0) return;
              if(event.shiftKey) onSelectionChange(toggledSelection(layout,ids,item.id));
              else onSelectionChange(selectedGroup(layout,[item.id]));
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
          {visibleGuides.x && <i aria-hidden className="free-guide free-guide-x" style={{
            left:visibleGuides.x.position+'%',top:visibleGuides.x.start+'%',height:(visibleGuides.x.end-visibleGuides.x.start)+'%',
          }}/>}
          {visibleGuides.y && <i aria-hidden className="free-guide free-guide-y" style={{
            top:visibleGuides.y.position+'%',left:visibleGuides.y.start+'%',width:(visibleGuides.y.end-visibleGuides.y.start)+'%',
          }}/>}
    </div>;
}

export function FreeLayoutEditor({slide,deck,locale,initial,onSave,onClose}:{
  slide:Slide;deck:Deck;locale:Locale;initial:FreeLayout;onSave:(layout:FreeLayout|null)=>void;onClose:()=>void;
}) {
  const t=freeWords[locale];
  const [draft,setLayout]=useState<FreeLayout|null>(slide.freeLayout?initial:null);
  const layout=draft ?? initial,name=elementNames(layout,locale);
  const [selected,setSelected]=useState<FreeId[]>(()=>{
    const element=initial.items.find(item=>item.id==='title') ?? initial.items[0];
    return element ? [element.id] : [];
  });
  const [snap,setSnap]=useState(true);
  const ids=selectedGroup(layout,selected),picked=layout.items.filter(item=>ids.includes(item.id));
  const bounds=picked.length ? selectionBounds(picked) : undefined;
  const dimensions=picked.length===1 ? picked[0] : bounds;
  const rotation=picked[0]?.rotation ?? 0;
  const sameGroup=!!picked[0]?.group && picked.every(item=>item.group===picked[0].group);
  function number(key:'x'|'y'|'w'|'h'|'angle',value:number) {
    if(!bounds || !dimensions || !Number.isFinite(value)) return;
    if(key==='x' || key==='y') setLayout(moveFree(layout,ids,key==='x'?value-bounds.x:0,key==='y'?value-bounds.y:0,false).layout);
    else if(key==='angle') setLayout(transformFree(layout,ids,{degrees:value-rotation}));
    else setLayout(transformFree(layout,ids,key==='w' ? {scaleX:value/dimensions.w} : {scaleY:value/dimensions.h}));
  }
  return <Dialog defaultOpen onOpenChange={open=>{if(!open)onClose();}}>
    <DialogPopup className="free-layout-dialog" closeProps={{'aria-label':t.close,title:t.close}}>
      <DialogHeader><DialogTitle>{t.name}</DialogTitle></DialogHeader>
      <DialogPanel>
        <div className="free-workspace">
        <div className="free-canvas-column">
        <div className="free-stage">
          <div inert aria-hidden="true">{draft
            ? <SlideCanvas slide={{...slide,freeLayout:layout}} deck={deck} revealAnswer/>
            : <MeasureAdaptiveSlide slide={slide} deck={deck} onMeasure={setLayout}/>}</div>
          <FreeLayoutOverlay layout={layout} locale={locale} selection={selected} onSelectionChange={setSelected}
            onChange={setLayout} snap={snap}/>
        </div>
        <DialogDescription className="free-help">{t.help}</DialogDescription>
        <label className="free-snap"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/>{t.snap}</label>
        </div>
        <div className="free-properties">
        <fieldset className="free-options"><legend>{t.pick}</legend>{layout.items.map(item=><label key={item.id}>
          <input type="checkbox" checked={ids.includes(item.id)} onChange={()=>setSelected(toggledSelection(layout,ids,item.id))}/>{name(item.id)}</label>)}</fieldset>
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
