import { formatStudioDate } from '@/lib/date';
import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { calendarDayFormatter, type LibraryActivity as Activity } from '@sabaq/contracts/library';
import type { Locale } from '@sabaq/lesson/types';
import { request } from '@/lib/api';
import { Button } from '@/components/coss/button';
import { Card, CardAction, CardPanel, CardDescription, CardHeader, CardTitle } from '@/components/coss/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/coss/skeleton';
import { OptionSelect } from '@/components/OptionSelect';
import { words } from '@/copy';

const copy = {
  en:{title:'Lesson activity', description:'New lessons and saved edits by day', created:'Created', edited:'Edits', range:'Activity period', days:(n:number)=>`Last ${n} days`, empty:'No lessons were created or edited in this period.', error:'Activity could not load.'},
  ru:{title:'Активность', description:'Созданные уроки и сохранённые правки по дням', created:'Создано', edited:'Правки', range:'Период активности', days:(n:number)=>`Последние ${n} дн.`, empty:'В этот период уроки не создавались и не редактировались.', error:'Не удалось загрузить активность.'},
  kk:{title:'Сабақ белсенділігі', description:'Күн сайын жасалған сабақтар мен сақталған түзетулер', created:'Жасалды', edited:'Түзетулер', range:'Белсенділік кезеңі', days:(n:number)=>`Соңғы ${n} күн`, empty:'Бұл кезеңде сабақтар жасалмаған және өңделмеген.', error:'Белсенділікті жүктеу мүмкін болмады.'},
};

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function period(rows: Activity[], days: number) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const today = calendarDayFormatter(timeZone)(new Date());
  const now = Date.parse(today+'T00:00:00Z');
  return Array.from({length:days}, (_, i) => {
    const day = new Date(now - (days - 1 - i) * 86400000).toISOString().slice(0,10);
    return byDay.get(day) ?? {day,created:0,edited:0};
  });
}

export function LibraryActivity({ locale }: { locale:Locale }) {
  const t=copy[locale];
  const [rows,setRows]=useState<Activity[]>();
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [days,setDays]=useState(30);
  const id=useId();
  useEffect(() => {
    let cancelled=false;
    void request<Activity[]>('/library/activity?timeZone='+encodeURIComponent(timeZone)).then((data)=>{
      if (!cancelled) setRows(data);
    }).catch(()=>{ if (!cancelled) setError(true); });
    return () => {cancelled=true;};
  },[attempt]);
  const format = (day: string) => formatStudioDate(day+'T00:00:00Z', locale, { utc: true });
  const data=rows && period(rows,days);
  const config={created:{label:t.created,color:'var(--chart-1)'},edited:{label:t.edited,color:'var(--chart-2)'}};
  return <Card className="dashboard-activity">
    <CardHeader>
      <CardTitle>{t.title}</CardTitle>
      <CardDescription>{t.description}</CardDescription>
      <CardAction>
        <OptionSelect label={t.range} value={String(days)} options={[90,30,7].map(value=>({value:String(value),label:t.days(value)}))} onChange={value=>setDays(Number(value))}/>
      </CardAction>
    </CardHeader>
    <CardPanel>
      {error ? <div className="dashboard-chart-empty" role="alert"><p>{t.error}</p><Button variant="outline" onClick={()=>{setError(false);setAttempt(n=>n+1);}}>{words[locale].retry}</Button></div> :
        !data ? <Skeleton className="dashboard-chart-skeleton" /> :
        !data.some(({created,edited})=>created||edited) ? <p className="dashboard-chart-empty">{t.empty}</p> :
        <ChartContainer config={config} className="dashboard-chart">
          <AreaChart accessibilityLayer data={data} margin={{left:-12,right:8}}>
            <defs>
              <linearGradient id={`${id}-created`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-created)" stopOpacity={.65}/><stop offset="95%" stopColor="var(--color-created)" stopOpacity={.1}/></linearGradient>
              <linearGradient id={`${id}-edited`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-edited)" stopOpacity={.5}/><stop offset="95%" stopColor="var(--color-edited)" stopOpacity={.06}/></linearGradient>
            </defs>
            <CartesianGrid vertical={false}/>
            <XAxis dataKey="day" tickFormatter={format} tickLine={false} axisLine={false} minTickGap={27} tickMargin={10}/>
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36}/>
            <ChartTooltip content={<ChartTooltipContent labelFormatter={label=>typeof label==='string'?format(label):label} indicator="dot"/>}/>
            <Area dataKey="edited" type="monotone" stroke="var(--color-edited)" strokeWidth={2} fill={`url(#${id}-edited)`} isAnimationActive={false}/>
            <Area dataKey="created" type="monotone" stroke="var(--color-created)" strokeWidth={2} fill={`url(#${id}-created)`} isAnimationActive={false}/>
            <ChartLegend content={<ChartLegendContent/>}/>
          </AreaChart>
        </ChartContainer>}
    </CardPanel>
  </Card>;
}
