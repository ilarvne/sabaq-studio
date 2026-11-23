import { formatStudioDate } from '@/lib/date';
import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import type { UsageRow } from '@sabaq/contracts/usage';
import type { Locale } from '@sabaq/lesson/types';
import { languages } from '@/copy';
import { Button } from '@/components/coss/button';
import './usage-report.css';

const words={
  en:{title:'Usage report',from:'From (UTC)',to:'Through (UTC)',org:'Organization',language:'Language',all:'All',apply:'Show report',empty:'No events in this period.',loading:'Loading report…',error:'Could not load the report.',time:'Median time to first ready lesson (min)',edits:'AI edits accepted',video:'Ready lessons converted within 30 days',finish:'Creations completed',undo:'Manual rollbacks per active lesson',pending:'Open 30-day windows',help:'Dates select the cohort. Follow-up outcomes include events observed through report time.'},
  ru:{title:'Отчёт об использовании',from:'С (UTC)',to:'По (UTC)',org:'Организация',language:'Язык',all:'Все',apply:'Показать отчёт',empty:'За период нет событий.',loading:'Загружаем отчёт…',error:'Не удалось загрузить отчёт.',time:'Медиана до первого готового урока (мин)',edits:'Принятые правки ИИ',video:'Готовые уроки с видео за 30 дней',finish:'Завершённые создания',undo:'Ручные откаты на активный урок',pending:'Открытые 30-дневные окна',help:'Даты задают период отбора. Последующие результаты учитываются до момента формирования отчёта.'},
  kk:{title:'Пайдалану есебі',from:'Басынан (UTC)',to:'Дейін (UTC)',org:'Ұйым',language:'Тіл',all:'Барлығы',apply:'Есепті көрсету',empty:'Бұл кезеңде оқиға жоқ.',loading:'Есеп жүктелуде…',error:'Есепті жүктеу мүмкін болмады.',time:'Алғашқы дайын сабаққа дейінгі медиана (мин)',edits:'Қабылданған ЖИ түзетулері',video:'30 күнде бейнеге айналған дайын сабақтар',finish:'Аяқталған сабақтар',undo:'Белсенді сабаққа шаққандағы қайтарулар',pending:'Ашық 30 күндік мерзімдер',help:'Күндер бастапқы топты анықтайды. Кейінгі нәтижелер есеп жасалған сәтке дейін ескеріледі.'},
};
const day=(t:number)=>new Date(t).toISOString().slice(0,10);
export default function UsageReport({locale}:{locale:Locale}) {
  const t=words[locale];
  const [open,setOpen]=useState(false);
  const [filters,setFilters]=useState(()=>({from:day(Date.now()-13*86400000),to:day(Date.now()),org:'',language:''}));
  const [query,setQuery]=useState(filters);
  const [data,setData]=useState<{asOf:string;rows:UsageRow[]}>();
  const [error,setError]=useState(false);
  useEffect(()=>{
    if(!open) return;
    let current=true;
    setData(undefined);setError(false);
    const params=new URLSearchParams(Object.entries(query).filter(([,value])=>value));
    void request<{asOf:string;rows:UsageRow[]}>('/admin/usage?'+params).then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});
    return ()=>{current=false;};
  },[open,query]);
  const number=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
  const ratio=(a:number,b:number)=>b ? number.format(100*a/b)+'% ('+a+'/'+b+')' : '—';
  return <details className="usage-report" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{t.title}</summary>
    <form onSubmit={event=>{event.preventDefault();setQuery({...filters});}}>
      <label>{t.from}<input required type="date" max={filters.to} value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label>
      <label>{t.to}<input required type="date" min={filters.from} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label>
      <label>{t.org}<input value={filters.org} maxLength={160} placeholder={t.all} onChange={e=>setFilters({...filters,org:e.target.value})}/></label>
      <label>{t.language}<select value={filters.language} onChange={e=>setFilters({...filters,language:e.target.value})}><option value="">{t.all}</option>
        {Object.entries(languages).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <Button type="submit" size="sm">{t.apply}</Button>
    </form>
    {error ? <p role="alert">{t.error}</p> : !data ? <p role="status">{t.loading}</p> : !data.rows.length ? <p>{t.empty}</p> :
      <div className="usage-table"><table><caption>{t.title} · {formatStudioDate(data.asOf,locale,{time:true})}</caption>
        <thead><tr>{[t.org,t.language,t.time,t.edits,t.video,t.finish,t.undo,t.pending].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{data.rows.map(row=><tr key={JSON.stringify([row.org,row.language])}><th scope="row">{row.org}</th><td>{languages[row.language as Locale]}</td>
          <td>{row.medianSeconds===null?'—':number.format(row.medianSeconds/60)}</td><td>{ratio(row.accepted,row.proposed)}</td><td>{ratio(row.video,row.ready)}</td>
          <td>{ratio(row.finished,row.started)}</td><td>{row.activeDecks?number.format(row.manualRollbacks/row.activeDecks):'—'}</td><td>{row.openVideoWindows}</td></tr>)}</tbody>
      </table><p>{t.help}</p></div>}
  </details>;
}
