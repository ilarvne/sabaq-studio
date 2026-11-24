import { useState } from 'react';
import type { Locale, Slide, SlideChanges, SlideDesign } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { Input } from '@/components/coss/input';
import { Textarea } from '@/components/coss/textarea';
import { DialogFooter } from '@/components/coss/dialog';
import { Modal } from './EditorControls';
import { editorCopy, type EditorCopy } from './editorCopy';

export const storyFields = {
  en:{edit:'Edit slide elements', label:'Section label', card:'Card', text:'Text', answer:'Reveal answer', takeaway:'Takeaway'},
  kk:{edit:'Слайд элементтерін өңдеу',label:'Бөлім атауы',card:'Карточка',text:'Мәтін',answer:'Көрсетілетін жауап',takeaway:'Қорытынды ой'},
  ru:{edit:'Редактировать элементы слайда',label:'Название раздела',card:'Карточка',text:'Текст',answer:'Ответ для показа',takeaway:'Главная мысль'},
};

export function StoryEdit({slide,design,locale,onSave,close}: {
  slide:Slide; design:SlideDesign; locale:Locale; onSave:(changes:SlideChanges)=>void; close:()=>void;
}) {
  const copy = storyFields[locale];
  const c = editorCopy[locale];
  const [draft,setDraft] = useState(design);
  const [answer,setAnswer] = useState(slide.answer ?? '');
  const updateCard = (index:number,key:'title'|'text',value:string) => setDraft(current=>({
    ...current,
    cards:current.cards?.map((card,i)=>i===index ? {...card,[key]:value} : card),
  }));
  return <Modal title={copy.edit} c={c} close={close}>
    <form className="story-fields" onSubmit={event=>{
      event.preventDefault();
      const next = {...draft,eyebrow:draft.eyebrow?.trim(),takeaway:draft.takeaway?.trim()};
      onSave({design:next,...(slide.answer!==undefined ? {answer:answer.trim()} : {})});
      close();
    }}>
      {draft.eyebrow!==undefined && <label>{copy.label}
        <Input maxLength={60} value={draft.eyebrow} onChange={event=>setDraft({...draft,eyebrow:event.target.value})}/>
      </label>}
      {draft.cards?.map((card,index)=><fieldset key={index}>
        <legend>{copy.card} {index+1}</legend>
        <label>{c.title}<Input required maxLength={45} value={card.title} onChange={event=>updateCard(index,'title',event.target.value)}/></label>
        <label>{copy.text}<Textarea required rows={2} maxLength={140} value={card.text} onChange={event=>updateCard(index,'text',event.target.value)}/></label>
      </fieldset>)}
      {draft.takeaway!==undefined && <label>{copy.takeaway}
        <Textarea rows={2} maxLength={180} value={draft.takeaway} onChange={event=>setDraft({...draft,takeaway:event.target.value})}/>
      </label>}
      {slide.answer!==undefined && <label>{copy.answer}
        <Textarea rows={2} maxLength={160} value={answer} onChange={event=>setAnswer(event.target.value)}/>
      </label>}
      <DialogFooter variant="bare" render={<footer />}>
        <Button type="button" variant="outline" onClick={close}>{c.cancelEdit}</Button>
        <Button type="submit">{c.save}</Button>
      </DialogFooter>
    </form>
  </Modal>;
}

export function ImageAltDialog({ slide, c, onSave, close }: {
  slide: Slide;
  c: EditorCopy;
  onSave: (changes: SlideChanges) => void;
  close: () => void;
}) {
  const [alt, setAlt] = useState(() => slide.image?.alt ?? '');
  return (
    <Modal title={c.editAlt} close={close} c={c}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (slide.image) onSave({ image: { ...slide.image, alt } });
        close();
      }}>
        <label>
          {c.alt}
          <Textarea value={alt} rows={3} onChange={(event) => setAlt(event.target.value)} placeholder={c.noAlt} />
        </label>
        <DialogFooter variant="bare" render={<footer />}>
          <Button variant="outline" type="button" onClick={close}>{c.cancelEdit}</Button>
          <Button type="submit">{c.save}</Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
