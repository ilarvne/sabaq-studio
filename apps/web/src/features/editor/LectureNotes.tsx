import { useEffect, useRef, useState } from 'react';
import { SpeakerHighIcon } from '@phosphor-icons/react';
import { narrationSource, spokenNarration } from '@sabaq/lesson/narration';
import { formatSpeechTime, speechSeconds } from '@sabaq/lesson/speech-time';
import type { Locale, Slide } from '@sabaq/lesson/types';
import { AssistantReadAloud } from '@/features/assistant/AssistantVoice';
import { RewriteSpeechButton } from '@/features/assistant/Assistant';
import { Button } from '@/components/coss/button';

const labels={
  en:{title:'Lecture text', listen:'Listen', rewrite:'Rewrite for speech', duration:'Estimated narration',fallback:'The preview uses the slide text until you add notes.',unavailable:'This device has no local voice for the lesson language.'},
  ru:{title:'Текст лекции',listen:'Прослушать',rewrite:'Переписать для речи',duration:'Оценка длительности',fallback:'Пока заметок нет, для прослушивания используется текст слайда.',unavailable:'На этом устройстве нет локального голоса для языка урока.'},
  kk:{title:'Дәріс мәтіні',listen:'Тыңдау',rewrite:'Ауызша баяндауға бейімдеу',duration:'Баяндаудың болжамды ұзақтығы',fallback:'Жазба енгізілгенше слайд мәтіні оқылады.',unavailable:'Құрылғыда сабақ тіліне сай жергілікті дауыс жоқ.'},
};
const hostedLabels = {
  en:{action:'Preview studio voice',working:'Generating narration…',error:'Could not preview the saved notes. Try again.',audio:'Studio voice narration'},
  ru:{action:'Прослушать голос студии',working:'Создаём озвучку…',error:'Не удалось озвучить сохранённые заметки. Попробуйте снова.',audio:'Озвучка голосом студии'},
  kk:{action:'Студия дауысын тыңдау',working:'Дыбыс жасалуда…',error:'Сақталған жазбаларды дыбыстау мүмкін болмады. Қайталап көріңіз.',audio:'Студия дауысы'},
};

function HostedNarration({ url, slide, locale }: { url: string; slide: Slide; locale: Locale }) {
  const copy = hostedLabels[locale];
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<'idle'|'pending'|'failed'>('idle');
  const [source, setSource] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal }).then(response => response.ok ? response.json() : undefined)
      .then(result => { if (!abort.signal.aborted) setEnabled(result?.enabled === true); }).catch(() => {});
    return () => { abort.abort(); request.current?.abort(); };
  }, [url]);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  if (!enabled) return null;

  async function preview() {
    if (request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setStatus('pending');
    try {
      const response = await fetch(`${url}/${encodeURIComponent(slide.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ version: slide.version }),
      });
      if (!response.ok) throw new Error();
      const audio = await response.blob();
      if (!abort.signal.aborted) { setSource(URL.createObjectURL(audio)); setStatus('idle'); }
    } catch { if (!abort.signal.aborted) setStatus('failed'); }
    finally { request.current = null; }
  }

  return <div className="lecture-hosted-narration">
    {source ? <audio aria-label={copy.audio} controls preload="metadata" src={source} /> :
      <Button variant="outline" size="sm" onClick={() => void preview()} disabled={!slide.notes.trim() || status === 'pending'}>
        <SpeakerHighIcon aria-hidden />{status === 'pending' ? copy.working : copy.action}
      </Button>}
    {status === 'failed' && <p role="alert" className="error-text">{copy.error}</p>}
  </div>;
}

export const lectureTitle=(locale:Locale)=>labels[locale].title;
export function LectureNotes({deckId,slide,locale,language,speechRate,canEdit,openReview}:{
  deckId:string;slide:Slide;locale:Locale;language:Locale;speechRate?:number;canEdit:boolean;openReview:()=>void;
}) {
  const t=labels[locale], raw=narrationSource(slide), spoken=spokenNarration(raw,language);
  const duration=formatSpeechTime(spoken ? speechSeconds(spoken,speechRate) : 0,locale);
  return <section className="lecture-notes-controls" aria-label={t.title}>
    <p>{t.duration} · {duration}</p>
    {!slide.notes.trim() && raw && <p>{t.fallback}</p>}
    <div className="lecture-notes-actions">
      <AssistantReadAloud text={spoken} language={language} locale={locale} lecture={{listen:t.listen,unavailable:t.unavailable}}/>
      <RewriteSpeechButton label={t.rewrite} disabled={!canEdit || !raw} openReview={openReview}/>
    </div>
    {canEdit && <HostedNarration key={`${slide.id}:${slide.version}`} url={`/api/decks/${encodeURIComponent(deckId)}/narration`} slide={slide} locale={locale}/>}
  </section>;
}
