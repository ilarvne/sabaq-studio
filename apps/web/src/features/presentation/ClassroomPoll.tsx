import { ChartBarIcon } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClassroomPoll, ClassroomQuestion } from '@sabaq/contracts/poll';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import './classroom-poll.css';

const copy = {
  en:{open:'Class poll',close:'Close panel',kind:'Activity',types:['Poll','Quiz','Word cloud'],question:'Question',options:'Answer options, one per line',correct:'Correct answer',start:'Open poll',end:'End poll',join:'Join the class',code:'Class code',send:'Submit answer',saved:'Answer recorded',unavailable:'The poll is unavailable. Check the code or try again.',results:'Class responses',link:'Student link',notice:'Select 2–12 different options.'},
  ru:{open:'Опрос класса',close:'Закрыть панель',kind:'Задание',types:['Опрос','Викторина','Облако слов'],question:'Вопрос',options:'Варианты ответа, по одному в строке',correct:'Правильный ответ',start:'Начать опрос',end:'Завершить опрос',join:'Присоединиться',code:'Код занятия',send:'Отправить ответ',saved:'Ответ принят',unavailable:'Опрос недоступен. Проверьте код или попробуйте позже.',results:'Ответы класса',link:'Ссылка для учащихся',notice:'Укажите от 2 до 12 разных вариантов.'},
  kk:{open:'Сынып сауалнамасы',close:'Панельді жабу',kind:'Тапсырма',types:['Сауалнама','Викторина','Сөз бұлты'],question:'Сұрақ',options:'Жауап нұсқалары, әр жолда біреуден',correct:'Дұрыс жауап',start:'Сауалнаманы бастау',end:'Сауалнаманы аяқтау',join:'Сабаққа қосылу',code:'Сабақ коды',send:'Жауапты жіберу',saved:'Жауап қабылданды',unavailable:'Сауалнама қолжетімсіз. Кодты тексеріп, қайта көріңіз.',results:'Сынып жауаптары',link:'Оқушыларға арналған сілтеме',notice:'2–12 түрлі нұсқа жазыңыз.'},
} as const;
const kinds = ['poll','quiz','words'] as const;
async function transact<T>(url:string, method='GET', body?:unknown):Promise<T> {
  const res = await fetch(url,{method,cache:'no-store',headers:body ? {'Content-Type':'application/json'}:undefined,body:body ? JSON.stringify(body):undefined});
  if (!res.ok) throw Error('Poll unavailable');
  return res.status===204 ? undefined as T : res.json();
}

export function TeacherPoll({deckId,locale,initialQuestion}:{deckId:string;locale:Locale;initialQuestion:string}) {
  const c=copy[locale], endpoint='/api/decks/'+encodeURIComponent(deckId)+'/poll';
  const [open,setOpen]=useState(false), [poll,setPoll]=useState<ClassroomPoll|null>(null), [busy,setBusy]=useState(false);
  const [kind,setKind]=useState<ClassroomQuestion['kind']>('poll'), [question,setQuestion]=useState(initialQuestion);
  const [text,setText]=useState(''), [correct,setCorrect]=useState(0), [error,setError]=useState('');
  const [reveal,setReveal]=useState(false);
  const options=text.split('\n').map(item=>item.trim()).filter(Boolean);
  useEffect(()=>{
    if(!open) return;
    let active=true, timer:ReturnType<typeof setTimeout>;
    async function refresh(){
      try {
        const data=await transact<{poll:ClassroomPoll|null}>(endpoint);
        if (active) {setPoll(data.poll);setError('');}
      } catch {if(active) setError(c.unavailable);}
      if(active) timer=setTimeout(refresh,800);
    }
    void refresh();
    return ()=>{active=false;clearTimeout(timer);};
  },[open,endpoint,c.unavailable]);
  async function change(event:FormEvent){
    event.preventDefault();
    if(!poll && (options.length<2 || options.length>12 || new Set(options).size!==options.length)){setError(c.notice);return;}
    setBusy(true);
    try {
      if(poll){await transact(endpoint,'DELETE');setPoll(null);setReveal(false);}
      else setPoll(await transact<ClassroomPoll>(endpoint,'POST',{question,kind,options,...(kind==='quiz' && {correct})}));
      setError('');
    } catch {setError(c.unavailable);}
    finally{setBusy(false);}
  }
  return <div className="class-poll-teacher">
    <Button type="button" size="sm" variant="ghost" className="rv-tool rv-tool-text rv-class-poll-trigger"
      aria-label={c.open} title={c.open} aria-expanded={open} onClick={()=>setOpen(!open)}>
      <ChartBarIcon size={18} aria-hidden/><span>{c.open}</span>
    </Button>
    {open && <section className="class-poll-panel" aria-label={c.open}>
      <header><strong>{c.open}</strong><Button type="button" size="sm" variant="ghost" onClick={()=>setOpen(false)}>{c.close}</Button></header>
      <form onSubmit={change}>{poll ? <>
        <h3>{poll.question}</h3>
        <p>{c.code} <strong className="class-poll-code">{poll.code}</strong></p>
        <a href={'/?join='+poll.code} target="_blank" rel="noreferrer">{c.link}</a>
        <ul aria-label={c.results} className={poll.kind==='words'?'class-poll-cloud':''}>
          {poll.options.map((label,i)=><li key={i} style={poll.kind==='words'?{fontSize:Math.min(2.2,1+poll.counts[i]*.12)+'em'}:undefined}>
            {label}{reveal && poll.correct===i ? ' ✓' : ''} <strong>{poll.counts[i]}</strong></li>)}
        </ul>
        {poll.kind==='quiz' && <Button type="button" variant="outline" aria-pressed={reveal} onClick={()=>setReveal(!reveal)}>{c.correct}</Button>}
      </> : <>
        <label>{c.kind}<select value={kind} onChange={e=>setKind(e.target.value as ClassroomQuestion['kind'])}>{kinds.map((value,i)=><option key={value} value={value}>{c.types[i]}</option>)}</select></label>
        <label>{c.question}<input required maxLength={220} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
        <label>{c.options}<textarea required rows={4} value={text} maxLength={972} onChange={e=>{setText(e.target.value);setCorrect(0);}}/></label>
        {kind==='quiz' && <label>{c.correct}<select value={correct} onChange={e=>setCorrect(Number(e.target.value))}>{options.map((label,i)=><option key={i} value={i}>{label}</option>)}</select></label>}
      </>}
      <Button type="submit" disabled={busy}>{poll?c.end:c.start}</Button>
      {error && <p role="alert">{error}</p>}</form>
    </section>}
  </div>;
}

export default function JoinPoll(){
  const initial=new URLSearchParams(location.search).get('join')?.toUpperCase() ?? '';
  const [code,setCode]=useState(initial),[entered,setEntered]=useState(initial),[data,setData]=useState<(ClassroomQuestion & {choice:number|null})>();
  const [choice,setChoice]=useState<number>(),[saved,setSaved]=useState(false),[failed,setFailed]=useState(false);
  const language=data?.language ?? (navigator.language.startsWith('ru')?'ru':navigator.language.startsWith('en')?'en':'kk');
  const c=copy[language], endpoint='/api/classroom-polls/'+encodeURIComponent(entered);
  useEffect(()=>{
    let active=true;
    if(entered) void transact<ClassroomQuestion & {choice:number|null}>(endpoint).then(value=>{
      if(active){setData(value);setChoice(value.choice??undefined);setSaved(value.choice!==null);setFailed(false);}
    }).catch(()=>{if(active){setData(undefined);setFailed(true);}});
    return ()=>{active=false;};
  },[entered,endpoint]);
  async function submit(e:FormEvent){
    e.preventDefault();
    if(!data){setEntered(code.trim().toUpperCase());return;}
    try{await transact(endpoint,'POST',{choice});setSaved(true);setFailed(false);}
    catch{setFailed(true);}
  }
  return <main className="class-poll-student" lang={language}><form onSubmit={submit}>
    <h1>{data?.question??c.join}</h1>
    {data?<fieldset aria-label={c.question}>{data.options.map((label,i)=><label key={i}>
      <input type="radio" name="answer" checked={choice===i} onChange={()=>{setChoice(i);setSaved(false);}}/>{label}</label>)}</fieldset>:
      <label>{c.code}<input required autoCapitalize="characters" maxLength={8} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/></label>}
    <Button type="submit" disabled={data ? choice===undefined : code.trim().length!==8}>{data?c.send:c.join}</Button>
    {saved && <p role="status">{c.saved}</p>}{failed && <p role="alert">{c.unavailable}</p>}
  </form></main>;
}
