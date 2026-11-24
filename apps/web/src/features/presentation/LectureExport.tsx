import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, CheckCircleIcon, ClockIcon, ClosedCaptioningIcon,
  DeviceMobileIcon, DownloadSimpleIcon, FilmStripIcon, InfoIcon, MonitorIcon, NotePencilIcon, PlayIcon,
  SquareIcon, VideoCameraIcon, WarningCircleIcon, XIcon,
} from '@phosphor-icons/react';
import { framePercent, videoFrame, videoSizes, type VideoAspect, type VideoJob, type VideoJobFailure, type VideoSettings, type VideoState } from '@sabaq/contracts/video';
import { formatSpeechTime, speechSeconds } from '@sabaq/lesson/speech-time';
import { lessonPalette } from '@sabaq/lesson/themes';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { VideoSlide } from '@sabaq/slide-renderer/video';
import { Button } from '@/components/coss/button';
import { Checkbox } from '@/components/coss/checkbox';
import { DialogDescription, DialogTitle } from '@/components/coss/dialog';
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/coss/progress';
import { Skeleton } from '@/components/coss/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import { SlidePositionPicker } from '@/features/editor/SlidePositionPicker';
import { reviewText } from './review-copy';
import './lecture-export.css';

const languageNames: Record<Locale, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
const formats = [
  { value: '16:9', icon: MonitorIcon }, { value: '9:16', icon: DeviceMobileIcon }, { value: '1:1', icon: SquareIcon },
] as const;

const localeCopy = {
  en: {
    title: 'Export video', preview: 'Slide preview', playback: 'Exported video', options: 'Video settings', slideCount: 'slides',
    format: 'Video format', language: 'Narration language', subtitles: 'Subtitles', subtitleHint: 'Timed to the narration',
    reveal: 'Reveal by paragraph', revealHint: 'Show slide elements as the notes are read.',
    imported: 'Imported images play as a single frame.', notes: 'Speaker notes', silent: 'This slide plays without narration.',
    noNotes: 'Add speaker notes to at least one slide to export a narrated video.', incomplete: 'Finish generating the remaining slides before exporting.',
    unavailable: 'Video export is unavailable', reconnecting: 'Checking the export service…', reload: 'Check again',
    serviceError: 'Could not reach the video export service. Try again.', actionError: 'The request could not be completed. Try again.',
    generate: 'Generate video lesson', cancel: 'Cancel export', download: 'Download MP4', play: 'Play video', slides: 'Back to slides',
    queued: 'Queued for export', running: 'Rendering slides', verifying: 'Verifying video markings', ready: 'Video ready',
    failed: 'Export failed', cancelled: 'Export cancelled', progress: 'Video export progress',
  },
  ru: {
    title: 'Экспорт видео', preview: 'Предпросмотр слайда', playback: 'Готовое видео', options: 'Параметры видео', slideCount: 'слайдов',
    format: 'Формат видео', language: 'Язык озвучки', subtitles: 'Субтитры', subtitleHint: 'Синхронизированы с озвучкой',
    reveal: 'Показ по абзацам', revealHint: 'Элементы слайда появляются по ходу озвучки.',
    imported: 'Импортированные изображения показываются целиком.', notes: 'Заметки докладчика', silent: 'Этот слайд будет показан без озвучки.',
    noNotes: 'Добавьте заметки хотя бы к одному слайду, чтобы экспортировать видео с озвучкой.', incomplete: 'Дождитесь готовности всех слайдов.',
    unavailable: 'Экспорт видео недоступен', reconnecting: 'Проверяем доступность экспорта…', reload: 'Проверить снова',
    serviceError: 'Не удалось подключиться к сервису экспорта. Попробуйте снова.', actionError: 'Не удалось выполнить запрос. Попробуйте снова.',
    generate: 'Создать видеолекцию', cancel: 'Отменить экспорт', download: 'Скачать MP4', play: 'Смотреть видео', slides: 'К слайдам',
    queued: 'В очереди на экспорт', running: 'Подготовка слайдов', verifying: 'Проверка маркировки', ready: 'Видео готово',
    failed: 'Ошибка экспорта', cancelled: 'Экспорт отменён', progress: 'Ход экспорта видео',
  },
  kk: {
    title: 'Бейнені экспорттау', preview: 'Слайдты алдын ала көру', playback: 'Дайын бейне', options: 'Бейне параметрлері', slideCount: 'слайд',
    format: 'Бейне пішімі', language: 'Баяндау тілі', subtitles: 'Субтитрлер', subtitleHint: 'Баяндаумен синхрондалады',
    reveal: 'Абзац бойынша көрсету', revealHint: 'Жазбалар оқылған сайын слайд элементтері пайда болады.',
    imported: 'Импортталған кескіндер бір кадрда толығымен көрсетіледі.', notes: 'Баяндамашы жазбалары', silent: 'Бұл слайд дыбыстаусыз көрсетіледі.',
    noNotes: 'Дыбысталған бейнені экспорттау үшін кемінде бір слайдқа жазба қосыңыз.', incomplete: 'Экспорттау үшін барлық слайдтың дайын болуын күтіңіз.',
    unavailable: 'Бейнені экспорттау қолжетімсіз', reconnecting: 'Экспорт қызметі тексерілуде…', reload: 'Қайта тексеру',
    serviceError: 'Экспорт қызметіне қосылу мүмкін болмады. Қайта көріңіз.', actionError: 'Сұрауды орындау мүмкін болмады. Қайта көріңіз.',
    generate: 'Бейнесабақ жасау', cancel: 'Экспортты тоқтату', download: 'MP4 жүктеп алу', play: 'Бейнені көру', slides: 'Слайдтарға оралу',
    queued: 'Экспорттау кезегінде', running: 'Слайдтар дайындалуда', verifying: 'Бейне белгілері тексерілуде', ready: 'Бейне дайын',
    failed: 'Экспорт сәтсіз аяқталды', cancelled: 'Экспорт тоқтатылды', progress: 'Бейнені экспорттау барысы',
  },
};

const isActive = (job?: VideoJob) => job?.status === 'queued' || job?.status === 'running' || job?.status === 'verifying';

const failureCopy = {
  en: {
    slide: 'Slide', retry: 'Try the export again.',
    prepare: 'Could not prepare the saved revision. Reopen video export and try again.',
    render: 'Could not render this slide. Review its layout and try again.',
    scene: 'Could not create this video scene. Review the speaker notes and try again.',
    assemble: 'Could not assemble the MP4. Try the export again.',
    verify: 'The MP4 failed verification. Try generating a new export.',
    publish: 'Could not make the MP4 available. Reopen video export and try again.',
  },
  ru: {
    slide: 'Слайд', retry: 'Попробуйте экспортировать видео ещё раз.',
    prepare: 'Не удалось подготовить сохранённую версию. Откройте экспорт заново и повторите попытку.',
    render: 'Не удалось отрисовать слайд. Проверьте его разметку и повторите попытку.',
    scene: 'Не удалось создать сцену. Проверьте заметки докладчика и повторите попытку.',
    assemble: 'Не удалось собрать MP4. Повторите экспорт.',
    verify: 'MP4 не прошёл проверку. Попробуйте создать видео заново.',
    publish: 'Не удалось предоставить доступ к MP4. Откройте экспорт заново и повторите попытку.',
  },
  kk: {
    slide: 'Слайд', retry: 'Бейнені қайта экспорттап көріңіз.',
    prepare: 'Сақталған нұсқаны дайындау мүмкін болмады. Бейне экспортын қайта ашып көріңіз.',
    render: 'Слайдты бейнелеу мүмкін болмады. Орналасуын тексеріп, қайта көріңіз.',
    scene: 'Бейне көрінісін жасау мүмкін болмады. Баяндамашы жазбаларын тексеріп, қайта көріңіз.',
    assemble: 'MP4 файлын құрастыру мүмкін болмады. Экспортты қайталаңыз.',
    verify: 'MP4 файлы тексерістен өтпеді. Бейнені қайта жасап көріңіз.',
    publish: 'MP4 файлы қолжетімсіз. Бейне экспортын қайта ашып көріңіз.',
  },
};

function describeFailure(locale: Locale, failure?: VideoJobFailure) {
  const copy = failureCopy[locale];
  if (!failure) return copy.retry;
  const detail = copy[failure.stage] || copy.retry;
  return failure.slide ? `${copy.slide} ${new Intl.NumberFormat(locale).format(failure.slide)} · ${detail}` : detail;
}

export function LectureExport({ deck, locale, slideId, onClose }: {
  deck: Deck; locale: Locale; slideId?: string; onClose: () => void;
}) {
  const copy = localeCopy[locale];
  const slides = deck.slides.filter(slide => slide.status === 'ready');
  const [selected, selectSlide] = useState(() => Math.max(0, slides.findIndex(slide => slide.id === slideId)));
  const [aspect, setAspect] = useState<VideoAspect>('16:9');
  const [captions, setCaptions] = useState(true);
  const [reveals, setReveals] = useState(false);
  const [worker, setWorker] = useState<VideoState>();
  const [connectionError, setConnectionError] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [request, setRequest] = useState<'start'|'cancel'|null>(null);
  const [refresh, refreshStatus] = useState(0);
  const [playing, setPlaying] = useState<string>();
  const restored = useRef(false);
  const formatLabel = useId();
  const revealHelp = useId();
  const index = Math.min(selected, slides.length - 1);
  const slide = slides[index];
  const url = `/api/decks/${encodeURIComponent(deck.id)}/video`;
  const blockedReveal = slides.some(item => item.importedPage && item.notes.trim().split(/\n+/u).filter(line => line.trim()).length > 1);
  const settings: VideoSettings = { position: 'none', language: deck.language, aspect, captions, revealParagraphs: reveals && !blockedReveal };
  const job = worker?.job;
  const busy = isActive(job);
  const matches = job?.revision === deck.revision && job.settings.position === 'none' && job.settings.language === settings.language &&
    (job.settings.aspect ?? '16:9') === aspect && job.settings.captions === captions && !!job.settings.revealParagraphs === settings.revealParagraphs;
  const ready = worker?.enabled && matches && job.status === 'ready' ? job : undefined;
  const playback = !!ready && playing === ready.key;
  const file = ready ? `${url}/${encodeURIComponent(ready.key)}/file` : undefined;
  const shownStatus = busy || (worker?.enabled && matches) ? job?.status : undefined;
  const hasNotes = slides.some(item => item.notes.trim());
  const complete = !!slide && slides.length === deck.slides.length;
  const estimate = hasNotes ? slides.reduce((sum, item) => sum + (item.notes.trim()
    ? speechSeconds(item.notes, deck.speechProfile?.wordsPerMinute) : 3), 0) : 0;
  const frame = videoFrame(settings);

  useEffect(() => {
    if (request) return;
    const controller = new AbortController();
    let timer: number;
    let wasActive = false;
    async function poll() {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error();
        const current: VideoState = await response.json();
        if (controller.signal.aborted) return;
        if (!restored.current) {
          restored.current = true;
          if (current.job?.revision === deck.revision && current.job.settings.position === 'none') {
            setAspect(current.job.settings.aspect ?? '16:9');
            setCaptions(current.job.settings.captions);
            setReveals(!!current.job.settings.revealParagraphs);
          }
        }
        wasActive = isActive(current.job);
        setWorker(current);
        setConnectionError(false);
      } catch {
        if (!controller.signal.aborted) setConnectionError(true);
      }
      if (wasActive && !controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1200);
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [url, deck.revision, request, refresh]);

  async function changeExport(action: 'start'|'cancel') {
    if (request) return;
    setRequest(action);
    setRequestError(false);
    try {
      const response = await fetch(url + (action === 'cancel' ? '/cancel' : ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'cancel' ? {} : { revision: deck.revision, settings }),
      });
      if (!response.ok) throw new Error();
      setWorker(await response.json());
      setConnectionError(false);
    } catch { setRequestError(true); }
    finally { setRequest(null); }
  }

  const checking = !worker && !connectionError;
  const unavailable = worker?.enabled === false || connectionError;
  const status = shownStatus ? copy[shownStatus] : unavailable ? copy.unavailable : undefined;
  const exportFailure = shownStatus === 'failed' ? describeFailure(locale, job?.failure) : undefined;
  const warning = requestError ? copy.actionError : connectionError ? copy.serviceError
    : exportFailure ?? (!complete ? copy.incomplete : !hasNotes ? copy.noNotes : undefined);

  return <div className="lecture-export">
    <header className="lecture-header">
      <span className="lecture-header-icon"><VideoCameraIcon size={23} weight="regular"/></span>
      <div className="lecture-heading">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription lang={deck.language}>{deck.title}</DialogDescription>
      </div>
      <Button variant="ghost" size="icon" aria-label={reviewText(locale, 'close')} onClick={onClose}><XIcon size={19}/></Button>
    </header>

    <div className="lecture-layout">
      <section className="lecture-preview" aria-label={copy.preview}>
        <div className="lecture-preview-bar">
          <h3>{playback ? copy.playback : copy.preview}</h3>
          <div className="lecture-preview-actions">
            {ready && <Button variant="secondary" size="sm" onClick={() => setPlaying(playback ? undefined : ready.key)}>
              {playback ? <FilmStripIcon/> : <PlayIcon/>}{playback ? copy.slides : copy.play}
            </Button>}
            {slide && !playback && <div className="rv-stepper">
              <Button variant="ghost" size="icon-sm" className="rv-tool" onClick={() => selectSlide(index - 1)} disabled={index <= 0}
                aria-label={reviewText(locale, 'prev')}><CaretLeftIcon size={17}/></Button>
              <SlidePositionPicker index={index} slides={slides} locale={locale} onChange={selectSlide}/>
              <Button variant="ghost" size="icon-sm" className="rv-tool" onClick={() => selectSlide(index + 1)} disabled={index >= slides.length - 1}
                aria-label={reviewText(locale, 'next')}><CaretRightIcon size={17}/></Button>
            </div>}
          </div>
        </div>
        <div className="lecture-stage" data-aspect={aspect}>
          {slide ? <div className="lecture-frame" style={{ aspectRatio: `${frame.width}/${frame.height}`, background: lessonPalette(deck).paper }}>
            {playback && file ? <video className="lecture-player" controls autoPlay playsInline src={`${file}?play=1`} aria-label={copy.playback}/>
              : <>
              <VideoSlide deck={deck} slide={slide} lang={locale} settings={settings} revealAnswer={false}/>
              <div className="lecture-mark-band" style={{ height: framePercent(frame.labelBox, frame).height }} aria-hidden="true"/>
              <div className="lecture-ai" style={framePercent(frame.labelBox, frame)} aria-hidden="true">ИИ</div>
              {frame.captionBox && <div className="lecture-caption-band" style={framePercent(frame.captionBox, frame)} aria-hidden="true"/>}
              </>}
          </div> : <div className="lecture-empty"><FilmStripIcon size={28}/>{reviewText(locale, 'none')}</div>}
        </div>
        {slide && !playback && <details className="lecture-notes">
          <summary><NotePencilIcon size={17}/><span>{copy.notes}</span><CaretRightIcon className="lecture-notes-caret" size={15}/></summary>
          <p lang={deck.language}>{slide.notes.trim() || copy.silent}</p>
        </details>}
      </section>

      <section className="lecture-settings" aria-label={copy.options}>
        <h3>{copy.options}</h3>
        <fieldset disabled={busy || !!request} className="lecture-setting-fields">
          <div className="lecture-format-field">
            <label id={formatLabel}>{copy.format}</label>
            <ToggleGroup aria-labelledby={formatLabel} className="lecture-formats" value={[aspect]}
              onValueChange={values => { if (values[0]) setAspect(values[0] as VideoAspect); }}>
              {formats.map(({value, icon: Icon}) => <ToggleGroupItem value={value} key={value}>
                <Icon size={17}/>{value}
              </ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="lecture-language"><span>{copy.language}</span><strong lang={deck.language}>{languageNames[deck.language]}</strong></div>
          <label className="lecture-option">
            <ClosedCaptioningIcon size={19}/><span><strong>{copy.subtitles}</strong><small>{copy.subtitleHint}</small></span>
            <Checkbox aria-label={copy.subtitles} checked={captions} onCheckedChange={setCaptions}/>
          </label>
          <label className="lecture-option">
            <FilmStripIcon size={19}/><span><strong>{copy.reveal}</strong><small id={revealHelp}>{blockedReveal ? copy.imported : copy.revealHint}</small></span>
            <Checkbox aria-label={copy.reveal} aria-describedby={revealHelp} checked={settings.revealParagraphs} disabled={blockedReveal} onCheckedChange={setReveals}/>
          </label>
        </fieldset>
      </section>
    </div>

    <footer className="lecture-footer">
      {busy && job && <Progress aria-label={copy.progress} value={job.completed} max={Math.max(1, job.total)}>
        <ProgressTrack><ProgressIndicator/></ProgressTrack>
      </Progress>}
      <div className="lecture-footer-row">
        <div className="lecture-status">
          {checking && <Skeleton className="lecture-skeleton" aria-hidden="true"/>}
          <div role="status" aria-live="polite" aria-atomic="true" className="lecture-status-line" data-state={shownStatus || (unavailable ? 'unavailable' : 'idle')}>
            {status ? <>{shownStatus === 'ready' ? <CheckCircleIcon/> : shownStatus === 'failed' || unavailable ? <WarningCircleIcon/> : <ClockIcon/>}
              <strong>{status}</strong>{busy && job && <span>{job.completed} / {job.total}</span>}</>
              : checking ? <span className="rv-sr">{copy.reconnecting}</span>
                : <><FilmStripIcon/><span>{slides.length} / {deck.slides.length} {copy.slideCount}</span>
                  {estimate > 0 && <><span aria-hidden="true">·</span><span>≈ {formatSpeechTime(estimate, locale)}</span></>}</>}
          </div>
          {warning && <p role={requestError || connectionError || exportFailure ? 'alert' : undefined}><InfoIcon size={15}/>{warning}</p>}
          {!warning && (ready || (!checking && !unavailable && !busy)) && <p>MP4 · {videoSizes[aspect].width} × {videoSizes[aspect].height}</p>}
        </div>
        <div className="lecture-actions">
          {unavailable && <Button variant="ghost" size="sm" onClick={() => refreshStatus(value => value + 1)}><ArrowClockwiseIcon/>{copy.reload}</Button>}
          {busy ? <Button variant="outline" size="lg" disabled={!!request} onClick={() => void changeExport('cancel')}>{copy.cancel}</Button>
            : ready && file ? <Button size="lg" render={<a href={file} download/>}><DownloadSimpleIcon/>{copy.download}</Button>
            : <Button size="lg" onClick={() => void changeExport('start')} loading={request === 'start'}
                disabled={checking || unavailable || !worker?.enabled || !complete || !hasNotes}><VideoCameraIcon/>{copy.generate}</Button>}
        </div>
      </div>
    </footer>
  </div>;
}
