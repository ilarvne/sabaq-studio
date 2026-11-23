import { useEffect, useRef, useState } from 'react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { compareVersion, type RelatedVersion, type VersionComparison } from '@sabaq/contracts/language-version';
import { ApiError, request, runLimitMessage } from '@/lib/api';
import { languages, words } from '@/copy';
import { LanguageFlag } from '@/components/LanguageFlag';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import './lesson-dialogs.css';
import { Button } from '@/components/coss/button';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { OptionSelect } from '@/components/OptionSelect';

export const versionLabels = {
  en:{title:'Language versions',target:'Version language',create:'Add a version in another language',cancel:'Cancel',wait:'Translating and checking the slides…',report:'Translation saved',fit:'Slides checked for fit',fields:'Text fields checked',slide:'Compare slide',original:'Original',translation:'Translation',open:'Open version',related:'Related versions',difference:'The slide structure differs between language versions.',review:'Compare structure',add:'Add',remove:'Remove',reorder:'Reorder slides',align:'Match this lesson to that version',push:'Update that version to match this lesson',source:'Slide text and speaker notes are translated into a separate lesson.',unavailable:'Start a local translation model and try again.',error:'The translation could not be completed.',stale:'A lesson has changed. Close and reopen this dialog.'},
  ru:{title:'Языковые версии',target:'Язык версии',create:'Добавить версию на другом языке',cancel:'Отмена',wait:'Переводим и проверяем слайды…',report:'Перевод сохранён',fit:'Проверено слайдов на переполнение',fields:'Проверено текстовых полей',slide:'Сравнить слайд',original:'Оригинал',translation:'Перевод',open:'Открыть версию',related:'Связанные версии',difference:'Структура слайдов в языковых версиях различается.',review:'Сравнить структуру',add:'Добавить',remove:'Удалить',reorder:'Изменить порядок',align:'Применить структуру этой версии здесь',push:'Перенести текущую структуру в ту версию',source:'Текст слайдов и заметки докладчика будут переведены в отдельном уроке.',unavailable:'Запустите локальную модель перевода и повторите попытку.',error:'Не удалось завершить перевод.',stale:'Урок изменился. Откройте это окно ещё раз.'},
  kk:{title:'Тілдік нұсқалар',target:'Нұсқа тілі',create:'Басқа тілдегі нұсқаны қосу',cancel:'Бас тарту',wait:'Слайдтар аударылып, тексерілуде…',report:'Аударма сақталды',fit:'Сыйымдылығы тексерілген слайдтар',fields:'Тексерілген мәтін өрістері',slide:'Слайдты салыстыру',original:'Түпнұсқа',translation:'Аударма',open:'Нұсқаны ашу',related:'Байланысты нұсқалар',difference:'Тілдік нұсқалардағы слайдтардың құрылымы әртүрлі.',review:'Құрылымды салыстыру',add:'Қосу',remove:'Жою',reorder:'Ретін өзгерту',align:'Сол нұсқаның құрылымын осында қолдану',push:'Осы құрылымды сол нұсқаға қолдану',source:'Слайд мәтіні мен баяндамашы жазбалары бөлек сабаққа аударылады.',unavailable:'Жергілікті аударма моделін іске қосып, қайталап көріңіз.',error:'Аударма аяқталмады.',stale:'Сабақ өзгерді. Терезені қайта ашыңыз.'},
};
const differs = (v:RelatedVersion)=>v.added > 0 || v.removed > 0 || v.reordered;

export function LanguageVersions({deck,locale,open,onOpen,onUpdate}: {deck:Deck;locale:Locale;open:boolean;onOpen:(next:boolean)=>void;onUpdate:(deck:Deck)=>void}) {
  const t = versionLabels[locale];
  const choices = (Object.keys(languages) as Locale[]).filter(lang=>lang !== deck.language);
  const [language,setLanguage] = useState(choices[0]);
  const [versions,setVersions] = useState<RelatedVersion[]>([]);
  const [result,setResult] = useState<Deck>();
  const [saved,setSaved] = useState<VersionComparison>();
  const [compare,setCompare] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const job = useRef<AbortController | undefined>(undefined);
  const receipt = useRef<{key:string;id:string} | undefined>(undefined);
  const structure = JSON.stringify(deck.slides.map(s=>s.id));
  const path = `/decks/${encodeURIComponent(deck.id)}/language-versions`;
  useEffect(()=>{
    const controller = new AbortController();
    void request<RelatedVersion[]>(path,{signal:controller.signal}).then(setVersions).catch(()=>{if (!controller.signal.aborted && open) setError(t.error);});
    return ()=>controller.abort();
  },[path,structure,open,refresh,t.error]);
  const canCompare = versions.some(v=>v.id===deck.translation?.sourceDeckId);
  useEffect(()=>{
    if (!open || !canCompare) return;
    const controller = new AbortController();
    void request<VersionComparison>(path+'/comparison',{signal:controller.signal}).then(setSaved).catch(()=>{if (!controller.signal.aborted) setError(t.error);});
    return ()=>controller.abort();
  },[path,open,canCompare,t.error]);
  useEffect(()=>()=>job.current?.abort(),[]);
  function close() {
    job.current?.abort();
    job.current = undefined;
    setBusy(false);setError('');setResult(undefined);setSaved(undefined);setCompare(0);onOpen(false);
  }
  async function run(other?:RelatedVersion,outward=false) {
    if (job.current) return;
    const controller = new AbortController();
    job.current=controller;
    const key = JSON.stringify([deck.id,deck.revision,language,other?.id,other?.revision,outward]);
    if (receipt.current?.key !== key) receipt.current = {key,id:crypto.randomUUID()};
    setBusy(true);setError('');setResult(undefined);
    try {
      const endpoint = outward && other ? `/decks/${encodeURIComponent(other.id)}/language-versions/align` : path+(other ? '/align' : '');
      const next = await request<Deck>(endpoint,{method:'POST',signal:controller.signal,
        body:{baseRevision:outward ? other!.revision : deck.revision,requestId:receipt.current.id,...(other ? {sourceId:outward ? deck.id : other.id,sourceRevision:outward ? deck.revision : other.revision} : {language})}});
      if (!other) setResult(next); else if (!outward) onUpdate(next);
      setRefresh(v=>v+1);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof ApiError ? (failure.status===429 ? runLimitMessage[locale] : failure.status===503 ? t.unavailable : failure.status===409 ? t.stale : failure.message) : t.error);
    } finally {if (job.current === controller) {job.current=undefined;setBusy(false);}}
  }
  const comparison = result ? compareVersion(deck,result) : saved;
  const pair = comparison?.slides[compare];
  return <>{versions.some(differs) && !open && <div className="page-alert" role="status">{t.difference}<Button variant="outline" onClick={()=>onOpen(true)}>{t.review}</Button></div>}
    <Dialog open={open} onOpenChange={next=>next ? onOpen(true) : close()}>
      <DialogPopup className="versions-dialog" closeProps={{'aria-label':words[locale].close}}><DialogHeader><DialogTitle>{t.title}</DialogTitle><DialogDescription>{t.source}</DialogDescription></DialogHeader>
      <DialogPanel><div className="grid gap-4">
        {!result && <><label className="lesson-dialog-field">{t.target}
          <Select value={language} items={choices.map(value=>({value,label:languages[value]}))} disabled={busy} onValueChange={value=>{if(value)setLanguage(value);}}>
            <SelectTrigger aria-label={t.target}><LanguageFlag locale={language}/><SelectValue/></SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>{choices.map(value=><SelectItem key={value} value={value}><LanguageFlag locale={value}/>{languages[value]}</SelectItem>)}</SelectPopup>
          </Select></label>
          <Button disabled={busy} onClick={()=>void run()}>{t.create}</Button></>}
        {busy && <div role="status">{t.wait} <Button variant="ghost" onClick={close}>{t.cancel}</Button></div>}
        {error && <p role="alert">{error}</p>}
        {comparison && pair && <section className="grid gap-3"><h3>{t.report}</h3>
          <p>{t.fit} · {comparison.report.checkedSlides} / {comparison.slides.length}<br/>{t.fields} · {comparison.report.translatedFields}</p>
          <OptionSelect label={t.slide} value={String(compare)} options={comparison.slides.map((s,i)=>({value:String(i),label:`${i+1}. ${s.after.title}`}))} onChange={v=>setCompare(Number(v))}/>
          <div className="grid gap-3 sm:grid-cols-2">{[{heading:t.original,slide:pair.before,lang:comparison.sourceLanguage},{heading:t.translation,slide:pair.after,lang:comparison.language}].map(({heading,slide,lang})=>{
            return <section key={heading} className="rounded-lg border p-3"><strong>{heading}</strong><div lang={lang}><h4>{slide.title}</h4><p>{slide.body}</p><p className="text-sm">{slide.notes}</p></div></section>;
          })}</div>{result && <Button onClick={()=>{location.hash='/deck/'+result.id;}}>{t.open}</Button>}</section>}
        {versions.length>0 && <section className="grid gap-2"><h3>{t.related}</h3>{versions.map(v=><div key={v.id} className="grid gap-2 rounded-lg border p-3">
          <a href={'#/deck/'+v.id}>{languages[v.language]} · {v.title}</a>
          {differs(v) && <><p>{t.add} {v.added} · {t.remove} {v.removed}{v.reordered && ' · '+t.reorder}</p><Button variant="outline" disabled={busy} onClick={()=>void run(v)}>{t.align}</Button>{v.writable && <Button variant="outline" disabled={busy} onClick={()=>void run(v,true)}>{t.push}</Button>}</>}
        </div>)}</section>}
      </div></DialogPanel></DialogPopup>
    </Dialog></>;
}
