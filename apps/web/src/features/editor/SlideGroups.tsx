import { useEffect, useState } from 'react';
import type { SlideSource } from '@sabaq/contracts/library';
import { maxLessonSlides, type Deck, type EditOp, type Locale } from '@sabaq/lesson/types';
import { request } from '@/lib/api';
import { Button } from '@/components/shadcn/button';
import { Dialog, DialogPopup, DialogHeader, DialogPanel, DialogTitle, DialogFooter } from '@/components/coss/dialog';

export const groupWords = {
  en:{open:'Select multiple slides',source:'Select slides from',here:'This lesson',copy:'Copy after current slide',move:'Move after current slide',remove:'Remove selected',local:'Copying these slides switches this lesson to local generation.',shared:'Copied slides include their images and speaker notes.',failed:'Other lessons could not be loaded.',close:'Close'},
  ru:{open:'Выбрать несколько слайдов',source:'Выбрать слайды из',here:'Этот урок',copy:'Копировать после текущего слайда',move:'Переместить после текущего слайда',remove:'Удалить выбранные',local:'Копирование этих слайдов переключит урок на локальную генерацию.',shared:'В копию входят изображения и заметки докладчика.',failed:'Не удалось загрузить другие уроки.',close:'Закрыть'},
  kk:{open:'Бірнеше слайдты таңдау',source:'Слайдтарды таңдайтын сабақ',here:'Осы сабақ',copy:'Ағымдағы слайдтан кейін көшіру',move:'Ағымдағы слайдтан кейін жылжыту',remove:'Таңдалғандарын жою',local:'Бұл слайдтарды көшіру сабақты жергілікті генерацияға ауыстырады.',shared:'Суреттер мен баяндамашы жазбалары да көшіріледі.',failed:'Басқа сабақтарды жүктеу мүмкін болмады.',close:'Жабу'},
};

export function SlideGroups({deck,locale,afterId,submit,close}:{deck:Deck;locale:Locale;afterId:string;submit:(op:EditOp)=>void;close:()=>void}) {
  const t=groupWords[locale];
  const [sources,setSources]=useState<SlideSource[]>([]);
  const [failed,setFailed]=useState(false);
  const [sourceId,setSourceId]=useState(deck.id);
  const [marked,setMarked]=useState<string[]>([]);
  useEffect(()=>{
    const controller=new AbortController();
    request<SlideSource[]>('/library/slide-sources',{signal:controller.signal}).then(setSources)
      .catch(()=>{if (!controller.signal.aborted) setFailed(true);});
    return ()=>controller.abort();
  },[]);
  const current=sourceId===deck.id;
  const source=current ? deck : sources.find(item=>item.id===sourceId);
  const slides=(source?.slides ?? []).filter(slide=>!('status' in slide) || slide.status==='ready');
  const selected=slides.filter(slide=>marked.includes(slide.id)).map(slide=>slide.id);
  const apply=(op:EditOp)=>{submit(op);close();};
  function move() {
    const rest=deck.slides.map(slide=>slide.id).filter(id=>!selected.includes(id));
    rest.splice(rest.indexOf(afterId)+1,0,...selected);
    apply({kind:'reorder',slideIds:rest});
  }
  return <Dialog defaultOpen onOpenChange={open=>{if(!open)close();}}>
    <DialogPopup className="inspector-dialog" closeProps={{'aria-label':t.close,title:t.close}}>
      <DialogHeader><DialogTitle>{t.open}</DialogTitle></DialogHeader>
      <DialogPanel className="ed-diagram-form">
        <label>{t.source}<select value={sourceId} onChange={event=>{setSourceId(event.target.value);setMarked([]);}}>
          <option value={deck.id}>{t.here}</option>
          {sources.filter(item=>item.id!==deck.id).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {failed && <p role="status">{t.failed}</p>}
        {!current && <p>{t.shared} {source && 'local' in source && source.local && deck.provider!=='local' && t.local}</p>}
        <div className="ed-group-choices">{slides.map((slide,index)=><label key={slide.id}>
          <input type="checkbox" checked={marked.includes(slide.id)} onChange={event=>setMarked(event.target.checked ? [...marked,slide.id] : marked.filter(id=>id!==slide.id))}/>
          <span>{index+1}. {slide.title}</span>
        </label>)}</div>
        <DialogFooter variant="bare" className="ed-group-buttons">
          {current && <Button variant="outline" size="sm" disabled={!selected.length || selected.length===deck.slides.length}
            onClick={()=>apply({kind:'removeSlides',slideIds:selected})}>{t.remove}</Button>}
          {current && <Button variant="outline" size="sm" disabled={!selected.length || selected.includes(afterId)} onClick={move}>{t.move}</Button>}
          <Button size="sm" disabled={!source || !selected.length || selected.length+deck.slides.length>maxLessonSlides}
            onClick={()=>{if (source) apply({kind:'copySlides',sourceDeckId:source.id,sourceRevision:source.revision,afterId,slideIds:selected});}}>{t.copy}</Button>
        </DialogFooter>
      </DialogPanel>
    </DialogPopup>
  </Dialog>;
}
