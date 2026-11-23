import { useEffect, useMemo, useState } from 'react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { request } from '@/lib/api';
import { Button } from '@/components/coss/button';
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Input } from '@/components/coss/input';
import { Textarea } from '@/components/coss/textarea';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { usePresentationMedia } from '@/features/presentation/usePresentationMedia';
import { reviewText } from '@/features/presentation/review-copy';
import { coeditLabels } from '@sabaq/lesson/coedit';
import { CollaborationHeader } from './CollaborationHeader';
import { OptionSelect } from '@/components/OptionSelect';
import { words } from '@/copy';
import './lesson-dialogs.css';

const labels = {
  en: ['Lesson access', 'Account in your organization', 'View', 'Edit', 'Grant access', 'Revoke', 'Comments', 'Add comment', 'Copy invitation link', 'Copied', 'Unable to save or load changes.', 'Back to library', 'Previous', 'Next'],
  ru: ['Доступ к уроку', 'Аккаунт в вашей организации', 'Просмотр', 'Редактирование', 'Предоставить доступ', 'Отозвать', 'Комментарии', 'Добавить комментарий', 'Копировать ссылку-приглашение', 'Скопировано', 'Не удалось сохранить или загрузить изменения.', 'В библиотеку', 'Назад', 'Далее'],
  kk: ['Сабаққа қол жеткізу', 'Ұйымыңыздағы тіркелгі', 'Көру', 'Өңдеу', 'Рұқсат беру', 'Рұқсатты қайтарып алу', 'Пікірлер', 'Пікір қосу', 'Шақыру сілтемесін көшіру', 'Көшірілді', 'Өзгерістерді сақтау немесе жүктеу мүмкін болмады.', 'Кітапханаға оралу', 'Алдыңғы', 'Келесі'],
};
type Grant = {subject:string; permission:'edit'|'view'};
type Comment = {id:number;subject:string;text:string;slideId?:string};
export function LessonAccess({deck, locale, slideId}: {deck:Deck; locale:Locale; slideId?:string}) {
  const t = labels[locale], path = '/decks/' + encodeURIComponent(deck.id);
  const permissionLabel = {en:'Permission',ru:'Уровень доступа',kk:'Рұқсат деңгейі'}[locale];
  const manage = deck.viewerPermission === 'owner' || deck.viewerPermission === 'admin';
  const [open, setOpen] = useState(false), [subject, setSubject] = useState(''), [permission, setPermission] = useState<Grant['permission']>('view');
  const [message, setMessage] = useState(''), [grants, setGrants] = useState<Grant[]>([]), [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const [unread,setUnread] = useState(0), [views,setViews] = useState<{opens:number;completed:number;lastSlide?:string}>();
  const [session] = useState(()=>crypto.randomUUID());
  useEffect(() => {
    if (slideId && !manage) void request(path+'/view-state',{method:'POST',body:{session,slideId}}).catch(()=>{});
  },[path,slideId,session,manage]);
  async function reload() {
    const [list, history] = await Promise.all([manage ? request<Grant[]>(path+'/access') : Promise.resolve([]), request<Comment[]>(path+'/comments')]);
    setGrants(list); setComments(history);
    const last = history.at(-1);
    if (last) await request(path+'/comments/read',{method:'POST',body:{id:last.id}});
    setUnread(0);
    if (manage) setViews(await request(path+'/access/views'));
  }
  useEffect(() => {
    setError(false); setCopied(false);
    let active = true;
    const refresh = () => {
      if (!active) return;
      if (open) void reload().catch(()=>{if(active) setError(true);});
      else void request<{unread:number}>(path+'/comments/unread').then(data=>{if(active)setUnread(data.unread);}).catch(()=>{});
    };
    refresh();
    const timer = setInterval(refresh,15000);
    return () => { active=false; clearInterval(timer); };
  }, [open, deck.id, manage]);
  async function save(suffix:string, method:string, body?:object) {
    setBusy(true); setError(false);
    try { await request(path+suffix,{method,body}); await reload(); return true; }
    catch { setError(true); return false; }
    finally { setBusy(false); }
  }
  return <><Button size="sm" variant="outline" onClick={()=>setOpen(true)}>{manage ? t[0] : t[6]}{unread>0 && <span aria-live="polite"> · {unread}</span>}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogPopup className="access-dialog" closeProps={{'aria-label':words[locale].close}}>
      <DialogHeader><DialogTitle>{manage ? t[0] : t[6]}</DialogTitle></DialogHeader>
      <DialogPanel><div className="access-dialog-body">
      {manage && <><form onSubmit={async event => {event.preventDefault(); if(await save('/access','PUT',{subject,permission})) setSubject('');}}>
        <label>{t[1]}<Input required maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)}/></label>
        <label>{permissionLabel}<OptionSelect label={permissionLabel} value={permission}
          options={[{value:'view',label:t[2]},{value:'edit',label:t[3]}]} onChange={setPermission}/></label>
        <Button disabled={busy || !subject.trim()}>{t[4]}</Button>
      </form>
      <ul className="access-grants">{grants.map(grant=><li key={grant.subject}><span>{grant.subject}<small>{grant.permission === 'view' ? t[2] : t[3]}</small></span><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void save('/access/'+encodeURIComponent(grant.subject),'DELETE')}>{t[5]}</Button></li>)}</ul>
      {views && <p>{{en:'Invitation opens',ru:'Открытия по приглашению',kk:'Шақыру арқылы ашу'}[locale]} · {views.opens}<br/>
        {{en:'Reached the last slide',ru:'Дошли до последнего слайда',kk:'Соңғы слайдқа жетті'}[locale]} · {views.completed}
        {views.lastSlide && <><br/>{deck.slides.find(s=>s.id===views.lastSlide)?.title}</>}</p>}
      <Button variant="outline" onClick={async()=>{try { await navigator.clipboard.writeText(new URL('#/deck/'+deck.id,window.location.href).href); setCopied(true); } catch { setError(true); }}}>{copied ? t[9] : t[8]}</Button></>}
      {manage && <h3>{t[6]}</h3>}
      <ul className="access-comments">{comments.map(comment=><li key={comment.id}><strong>{comment.subject}</strong>{comment.slideId && ' · '+(deck.slides.find(s=>s.id===comment.slideId)?.title || '')}<p>{comment.text}</p></li>)}</ul>
      <form onSubmit={async event => {event.preventDefault(); if(await save('/comments','POST',{text:message,slideId})) setMessage('');}}>
        <Textarea aria-label={t[7]} required maxLength={2500} value={message} onChange={e=>setMessage(e.target.value)}/>
        <Button disabled={busy || !message.trim()}>{t[7]}</Button>
      </form>{error && <p role="alert">{t[10]}</p>}
      </div></DialogPanel>
    </DialogPopup></Dialog></>;
}
export function ReadOnlyLesson({deck, locale, coeditHref}: {deck:Deck; locale:Locale; coeditHref?:string}) {
  const [index,setIndex] = useState(0);
  const slides = useMemo(() => deck.slides.filter(slide => slide.status === 'ready'), [deck.slides]);
  const current = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[current];
  const media = usePresentationMedia(slides, deck.brand?.logo);
  const t = labels[locale];
  return <div className="collaboration-page">
    <CollaborationHeader title={deck.title} language={deck.language} locale={locale} mode="view"
      action={<LessonAccess deck={deck} locale={locale} slideId={slide?.id}/>}/>
    <main className="readonly-lesson">
      {deck.activeEditor && <div className="readonly-pending">
        <span role="status">{{en:'Currently editing', ru:'Сейчас редактирует', kk:'Қазір өңдеп жатыр'}[locale]} · {deck.activeEditor}</span>
        {deck.viewerPermission!=='view' && <Button size="sm" variant="outline" onClick={()=>location.reload()}>{t[3]}</Button>}
        {coeditHref && <a href={coeditHref}>{coeditLabels[locale]}</a>}
      </div>}
      {slide ? <>
        <small role="status">{reviewText(locale, media.state === 'ready' ? 'offlineReady' : media.state === 'loading' ? 'offlineLoading' : 'offlineIncomplete')}</small>
        <SlideCanvas deck={media.withBrand(deck)} slide={media.withMedia(slide)}/>
        <nav className="readonly-pagination" aria-label={reviewText(locale,'slides')}>
          <Button variant="outline" disabled={!current} onClick={()=>setIndex(current-1)}>{t[12]}</Button>
          <span aria-live="polite">{current+1} / {slides.length}</span>
          <Button variant="outline" disabled={current>=slides.length-1} onClick={()=>setIndex(current+1)}>{t[13]}</Button>
        </nav>
      </> : <p role="status">{reviewText(locale,'none')}</p>}
    </main>
  </div>;
}
