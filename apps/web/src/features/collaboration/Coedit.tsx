import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { coeditFields,coeditLimits,type CoeditField,type CoeditPeer,type CoeditState } from '@sabaq/lesson/coedit';
import type { Deck,Locale,Slide } from '@sabaq/lesson/types';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { ApiError, request } from '@/lib/api';
import { Button } from '@/components/coss/button';
import { CollaborationHeader } from './CollaborationHeader';
import { reviewText } from '@/features/presentation/review-copy';
import './coedit.css';

const words={
  en:{join:'Edit together',back:'Return to lesson',title:'Title',body:'Slide text',notes:'Speaker notes',connecting:'Connecting…',saved:'Shared changes saved',saving:'Saving changes…',retry:'Connection interrupted. Reconnecting…',locked:'The current editor must open shared editing first.',lost:'Editing stopped. Copy any unsaved text before leaving.',readonly:'Use the slide editor for rich text or imported content.',undo:'Undo my edit',redo:'Redo my edit',members:'Other participants',slide:'Slide'},
  ru:{join:'Редактировать вместе',back:'Вернуться к уроку',title:'Заголовок',body:'Текст слайда',notes:'Заметки докладчика',connecting:'Подключение…',saved:'Совместные изменения сохранены',saving:'Сохранение…',retry:'Связь прервана. Повторное подключение…',locked:'Текущему редактору нужно открыть совместную правку.',lost:'Правка остановлена. Скопируйте несохранённый текст перед выходом.',readonly:'Форматированный или импортированный текст доступен в основном редакторе.',undo:'Отменить мою правку',redo:'Повторить мою правку',members:'Другие участники',slide:'Слайд'},
  kk:{join:'Бірге өңдеу',back:'Сабаққа оралу',title:'Тақырып',body:'Слайд мәтіні',notes:'Баяндамашы жазбалары',connecting:'Қосылуда…',saved:'Ортақ өзгерістер сақталды',saving:'Сақталуда…',retry:'Байланыс үзілді. Қайта қосылуда…',locked:'Қазіргі редактор алдымен бірлесіп өңдеуді ашуы керек.',lost:'Өңдеу тоқтатылды. Шықпас бұрын сақталмаған мәтінді көшіріңіз.',readonly:'Пішімделген немесе импортталған мәтінді негізгі редакторда өңдеңіз.',undo:'Өз өзгерісімді болдырмау',redo:'Өз өзгерісімді қайталау',members:'Басқа қатысушылар',slide:'Слайд'},
};
const from64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
function to64(bytes:Uint8Array) {
  let raw='';
  for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
const localOrigin=Symbol('keyboard');
const palette=['#a1314a','#2865a9','#3b7950','#7848aa','#8b5a23'];
function peerColor(id:string){return palette[id.split('').reduce((n,c)=>n+c.charCodeAt(0),0)%palette.length];}

type Status='connecting'|'saved'|'saving'|'retry'|'locked'|'lost';
type Texts=Record<CoeditField,string>;
class SharedSession {
  readonly doc=new Y.Doc();
  readonly id=crypto.randomUUID();
  readonly undo=new Y.UndoManager(coeditFields.map(key=>this.doc.getText(key)),{trackedOrigins:new Set([localOrigin])});
  readonly pending:Uint8Array[]=[];
  readonly controller=new AbortController();
  room?:string;
  sequence?:number;
  editable:CoeditField[]=[];
  peers:CoeditPeer[]=[];
  cursor?:{field:CoeditField;position:string};
  status:Status='connecting';
  timer?:number;
  constructor(readonly path:string,readonly changed:()=>void) {
    this.doc.on('update',(bytes:Uint8Array,origin:unknown)=>{
      if(origin===localOrigin || origin===this.undo){this.pending.push(bytes);this.status='saving';this.changed();}
    });
  }
  replace(field:CoeditField,next:string) {
    if(!this.editable.includes(field))return;
    const text=this.doc.getText(field),before=text.toString();
    let start=0,end=0;
    while(start<before.length && start<next.length && before[start]===next[start])start++;
    while(end<before.length-start && end<next.length-start && before[before.length-1-end]===next[next.length-1-end])end++;
    this.doc.transact(()=>{
      const drop=before.length-end-start;if(drop)text.delete(start,drop);
      const insert=next.slice(start,next.length-end);if(insert)text.insert(start,insert);
    },localOrigin);
  }
  position(field:CoeditField,index:number) {
    const pos=Y.createRelativePositionFromTypeIndex(this.doc.getText(field),index);
    this.cursor={field,position:to64(Y.encodeRelativePosition(pos))};
  }
  text():Texts {return {title:this.doc.getText('title').toString(),body:this.doc.getText('body').toString(),notes:this.doc.getText('notes').toString()};}
  async tick() {
    const count=this.pending.length;
    try {
      const response=await request<CoeditState>(this.path+'/sync',{method:'POST',signal:this.controller.signal,
        body:{session:this.id,room:this.room,sequence:this.sequence,vector:to64(Y.encodeStateVector(this.doc)),
          update:count ? to64(Y.mergeUpdates(this.pending.slice(0,count))) : undefined,cursor:this.cursor}});
      if(this.controller.signal.aborted)return;
      if(response.update)Y.applyUpdate(this.doc,from64(response.update),'remote');
      this.pending.splice(0,count);this.room=response.room;this.sequence=response.sequence;this.editable=response.editable;
      this.peers=response.peers;this.status=this.pending.length?'saving':'saved';
    }catch(e){
      if(this.controller.signal.aborted)return;
      if(e instanceof ApiError && [400,403,404,409,413,422].includes(e.status)){this.status='lost';this.editable=[];}
      else this.status=e instanceof ApiError && e.status===423?'locked':'retry';
    }
    this.changed();
    if(this.status!=='lost')this.timer=window.setTimeout(()=>void this.tick(),this.status==='retry'||this.status==='locked'?1000:200);
  }
  leave() {return fetch('/api'+this.path+'/leave',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({session:this.id})}).catch(()=>undefined);}
  close() {
    this.controller.abort();clearTimeout(this.timer);
    if(this.room && this.pending.length && this.status!=='lost'){
      // Tab navigation can unmount between syncs. Resending an in-flight Yjs update is idempotent.
      const body=JSON.stringify({session:this.id,room:this.room,sequence:this.sequence,update:to64(Y.mergeUpdates(this.pending))});
      void fetch('/api'+this.path+'/sync',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:body.length<64000})
        .catch(()=>undefined).finally(()=>void this.leave());
    }else void this.leave();
    this.undo.destroy();this.doc.destroy();
  }
}

function LiveField({field,session,value,locale}:{field:CoeditField;session?:SharedSession;value:string;locale:Locale}) {
  const input=useRef<HTMLTextAreaElement>(null),mirror=useRef<HTMLDivElement>(null);
  const selection=useRef<{start:Y.RelativePosition;end:Y.RelativePosition}|undefined>(undefined);
  const t=words[locale], active=session?.editable.includes(field);
  function remember() {
    const el=input.current;
    if(!el || !session || !active)return;
    const text=session.doc.getText(field);
    selection.current={start:Y.createRelativePositionFromTypeIndex(text,el.selectionStart),end:Y.createRelativePositionFromTypeIndex(text,el.selectionEnd)};
    session.position(field,el.selectionEnd);
  }
  useLayoutEffect(()=>{
    const el=input.current,pos=selection.current;
    if(!session || !pos || !el || document.activeElement!==el)return;
    const start=Y.createAbsolutePositionFromRelativePosition(pos.start,session.doc),end=Y.createAbsolutePositionFromRelativePosition(pos.end,session.doc);
    if(start && end)el.setSelectionRange(start.index,end.index);
  },[value,session]);
  const peers=(session?.peers ?? []).flatMap(peer=>{
    if(!session || peer.field!==field || !peer.position)return [];
    const pos=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(from64(peer.position)),session.doc);
    return pos?[{...peer,index:pos.index}]:[];
  }).sort((a,b)=>a.index-b.index);
  const fragments:React.ReactNode[]=[];
  let last=0;
  for(const p of peers){fragments.push(value.slice(last,p.index),<i key={p.id} title={p.name} style={{color:peerColor(p.id)}}><b>{p.name}</b></i>);last=p.index;}
  fragments.push(value.slice(last),'\u200b');
  return <label className="co-field">{t[field]}<span className="co-box">
    <textarea ref={input} rows={field==='title'?2:4} maxLength={coeditLimits[field]} value={value} readOnly={!active}
      onChange={e=>{session?.replace(field,e.target.value);remember();}} onSelect={remember} onFocus={remember}
      onScroll={e=>{if(mirror.current)mirror.current.scrollTop=e.currentTarget.scrollTop;}}
      onKeyDown={e=>{
        if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){e.preventDefault();if(active && session){if(e.shiftKey)session.undo.redo();else session.undo.undo();}}
      }}/>
    <span ref={mirror} className="co-mirror" aria-hidden="true">{fragments}</span>
  </span>{session?.room && !active && <small>{t.readonly}</small>}</label>;
}

function SlideRoom({deck,slide,locale,choose}:{deck:Deck;slide:Slide;locale:Locale;choose:(id:string)=>void}) {
  const live=useRef<SharedSession|undefined>(undefined),[,redraw]=useState(0);
  const path='/coedit/'+encodeURIComponent(deck.id)+'/'+encodeURIComponent(slide.id);
  useEffect(()=>{
    const room=new SharedSession(path,()=>redraw(n=>n+1));live.current=room;void room.tick();
    const closing=(event:BeforeUnloadEvent)=>{if(room.pending.length){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',closing);
    return ()=>{live.current=undefined;room.close();window.removeEventListener('beforeunload',closing);};
  },[path]);
  const session=live.current,t=words[locale],content=session?.room?session.text():{title:slide.title,body:slide.body,notes:slide.notes};
  const pending=!!session?.pending.length && session.status!=='lost';
  const preview={...slide,...content};
  if(slide.title!==content.title || slide.body!==content.body){
    preview.richText={...slide.richText};
    if(slide.title!==content.title)delete preview.richText.title;
    if(slide.body!==content.body){delete preview.richText.body;delete preview.bodyRuns;}
  }
  async function exit(next?:string) {
    if(session){clearTimeout(session.timer);session.controller.abort();await session.leave();}
    if(next)choose(next);else location.hash='/deck/'+deck.id;
  }
  return <div className="collaboration-page">
    <CollaborationHeader title={deck.title} language={deck.language} locale={locale} mode="edit"
      action={<Button size="sm" variant="outline" disabled={pending} onClick={()=>void exit()}>{t.back}</Button>}/>
    <main className="co-room">
    <label>{t.slide} <select disabled={pending} value={slide.id} onChange={e=>void exit(e.target.value)}>{deck.slides.filter(s=>s.status==='ready').map((s,i)=><option key={s.id} value={s.id}>{i+1} · {s.title}</option>)}</select></label>
    <p role="status">{t[session?.status ?? 'connecting']}</p>
    <div className="co-grid"><section>{coeditFields.map(field=><LiveField key={field} field={field} session={session} locale={locale} value={content[field]}/>)}
      <div className="flex gap-2"><Button variant="outline" disabled={!session?.editable.length || !session.undo.canUndo()} onClick={()=>session?.undo.undo()}>{t.undo}</Button>
        <Button variant="outline" disabled={!session?.editable.length || !session.undo.canRedo()} onClick={()=>session?.undo.redo()}>{t.redo}</Button></div></section>
      <section><SlideCanvas deck={deck} slide={preview}/>{Boolean(session?.peers.length) && <p>{t.members} · {session?.peers.map(p=>p.name).join(', ')}</p>}</section></div>
  </main></div>;
}

export default function Coedit({deck,locale}:{deck:Deck;locale:Locale}) {
  const [selected,choose]=useState(()=>sessionStorage.getItem('sabaq:slide:'+deck.id));
  const slide=deck.slides.find(s=>s.id===selected && s.status==='ready') ?? deck.slides.find(s=>s.status==='ready');
  if (slide) return <SlideRoom key={slide.id} deck={deck} slide={slide} locale={locale} choose={choose}/>;
  return <div className="collaboration-page">
    <CollaborationHeader title={deck.title} language={deck.language} locale={locale} mode="edit"
      action={<a className="co-return" href={'#/deck/'+deck.id}>{words[locale].back}</a>}/>
    <main className="co-room"><p role="status">{reviewText(locale,'none')}</p></main>
  </div>;
}
