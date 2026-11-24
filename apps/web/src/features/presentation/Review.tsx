import { formatStudioDate } from '@/lib/date';
import { narrationSource, spokenNarration } from '@sabaq/lesson/narration';
import { speechSeconds } from '@sabaq/lesson/speech-time';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  ClockIcon,
  ArrowsOutIcon,
  ArrowSquareOutIcon,
  FilePngIcon,
  FileTextIcon,
  ClockCounterClockwiseIcon,
  CircleNotchIcon,
  ChalkboardTeacherIcon,
  MoonStarsIcon,
  SunIcon,
  IconContext,
  ProjectorScreenIcon,
  EyeSlashIcon,
  PresentationIcon,
  ArrowCounterClockwiseIcon,
  XIcon,
  ArrowsInIcon,
  CaretDownIcon,
  CheckCircleIcon,
  EyeIcon,
  FilePdfIcon,
  InfoIcon,
  NotePencilIcon,
} from '@phosphor-icons/react';
import Reveal, { type RevealApi } from 'reveal.js';
import Notes from 'reveal.js/plugin/notes';
import 'reveal.js/reveal.css';
import type { Deck, Locale, Revision, Slide } from '@sabaq/lesson/types';
import { SlidePositionPicker } from '@/features/editor/SlidePositionPicker';
import { exportFilename, type ExportFormat, type ExportJob } from '@sabaq/contracts/export-file';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Button } from '@/components/coss/button';
import { Dialog, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import { reviewText, type ReviewWord } from './review-copy';
import { usePresentationMedia } from './usePresentationMedia';
import { TeacherPoll } from './ClassroomPoll';
import { LectureExport } from './LectureExport';
import './review.css';

export type ReviewMode = 'present' | 'versions' | 'export' | 'video';
type Translate = (word: ReviewWord) => string;
type ReviewProps = {
  mode: ReviewMode;
  deck: Deck;
  locale: Locale;
  slideId?: string;
  onClose: () => void;
  onRestore: (next: Deck) => void;
};
type PanelProps = { deck: Deck; locale: Locale; slideId?: string; t: Translate };
type SpeakerTiming = { elapsed: string; pace: string; plan: string };

const languageNames: Record<Locale, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
const readySlides = (deck: Deck) => deck.slides.filter((slide) => slide.status === 'ready');
const initialIndex = (slides: Slide[], id?: string) =>
  Math.max(
    0,
    slides.findIndex((slide) => slide.id === id),
  );
const endpoint = (deck: Deck) => `/api/decks/${encodeURIComponent(deck.id)}`;
const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

function Tool({
  children,
  label,
  click,
  pressed,
  expanded,
  controls,
  disabled,
  text,
}: {
  children: ReactNode;
  label: string;
  click: () => void;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  text?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={text ? 'sm' : 'icon-sm'}
      className={`rv-tool${text ? ' rv-tool-text' : ''}`}
      onClick={click}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
    >
      {children}
      {text && <span>{label}</span>}
    </Button>
  );
}

function ReviewSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} className="rv-select-trigger">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function Stepper({index, slides, locale, set, t}: {
  index: number;
  slides: readonly Slide[];
  locale: Locale;
  set: (i: number) => void;
  t: Translate;
}) {
  return <div className="rv-stepper">
    <Tool label={t('prev')} click={() => set(index - 1)} disabled={index <= 0}><CaretLeftIcon size={17}/></Tool>
    <SlidePositionPicker index={index} slides={slides} locale={locale} onChange={set}/>
    <span className="rv-sr" aria-live="polite" aria-atomic="true">{t('slide')} {index + 1} / {slides.length}</span>
    <Tool label={t('next')} click={() => set(index + 1)} disabled={index >= slides.length - 1}><CaretRightIcon size={17}/></Tool>
  </div>;
}

function writeSpeakerNotes(view: Window, text: string) {
  let doc: Document;
  try {
    doc = view.document;
  } catch {
    // The teacher can navigate the popup to a different origin.
    return;
  }
  const notes = doc.querySelector('.speaker-controls-notes');
  const value = notes?.querySelector<HTMLElement>('.value');
  if (!notes || !value) return;
  value.textContent = text;
  value.style.whiteSpace = 'pre-wrap';
  notes.classList.toggle('hidden', !text);
}

function installSpeakerTimer(doc: Document, t: Translate, reset: () => void) {
  const nativeTimer = doc.querySelector<HTMLElement>('.speaker-controls-time');
  if (!nativeTimer) return;
  // Leave the notes plugin's timer mounted for its internal updates.
  nativeTimer.hidden = true;
  const timing = doc.createElement('section');
  timing.style.cssText = 'padding: 10px 16px 16px; border-bottom: 1px solid #ddd;';
  const heading = doc.createElement('h4');
  heading.style.cssText = 'margin: 0; font-size: 14px; font-weight: normal;';
  heading.textContent = t('time');
  const elapsed = doc.createElement('strong');
  elapsed.id = 'lesson-presentation-elapsed';
  elapsed.style.cssText = 'display: block; margin-top: 4px; font-size: 24px; font-variant-numeric: tabular-nums;';
  const pace = doc.createElement('p');
  const plan = doc.createElement('p');
  for (const line of [pace, plan]) line.style.cssText = 'margin: 6px 0; font-size: 14px;';
  const resetButton = doc.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = t('resetClock');
  resetButton.addEventListener('click', reset);
  timing.append(heading, elapsed, pace, plan, resetButton);
  nativeTimer.before(timing);
  return (next: SpeakerTiming) => {
    elapsed.textContent = next.elapsed;
    pace.textContent = next.pace;
    pace.hidden = !next.pace;
    plan.textContent = next.plan;
  };
}

// The plugin creates its own document and does not expose a translation API.
function localizeSpeaker(
  view: Window,
  locale: Locale,
  t: Translate,
  navigateKey: (key: string) => boolean,
  initialNotes: string,
  resetTimer: () => void,
) {
  const doc = view.document;
  doc.documentElement.lang = locale;
  doc.title = t('speaker');
  doc.addEventListener(
    'keydown',
    (event) => {
      if (
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        (event.target as Element)?.closest?.('input,select,textarea,button')
      )
        return;
      if (navigateKey(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  const label = (selector: string, word: ReviewWord) => {
    const node = doc.querySelector(selector);
    if (node) node.textContent = t(word);
  };
  label('#upcoming-slide>.label', 'next');
  label('#connection-status', 'load');
  label('.speaker-controls-notes .label', 'notes');
  // The popup already has the teacher's notes while its two projection frames boot.
  // Reveal's own updates begin when its first receiver signals readiness.
  writeSpeakerNotes(view, initialNotes);
  const dropdown = doc.querySelector<HTMLSelectElement>('.speaker-layout-dropdown');
  const names: Record<string, ReviewWord> = {
    default: 'speakerDefault',
    wide: 'speakerWide',
    tall: 'speakerTall',
    'notes-only': 'speakerNotesOnly',
  };
  if (dropdown) {
    dropdown.setAttribute('aria-label', t('speakerLayout'));
    for (const option of dropdown.options)
      if (names[option.value]) option.textContent = t(names[option.value]);
    const change = () => {
      const current = doc.querySelector('.speaker-layout-label');
      if (current)
        current.textContent =
          t('speakerLayout') + ' · ' + (dropdown.selectedOptions[0]?.textContent ?? '');
    };
    change();
    dropdown.addEventListener('change', change);
  }
  const frames = new MutationObserver(() => {
    const current = doc.querySelector<HTMLIFrameElement>('#current-slide iframe');
    const next = doc.querySelector<HTMLIFrameElement>('#upcoming-slide iframe');
    if (current && next) {
      current.title = t('currentSlide');
      next.title = t('next');
      frames.disconnect();
    }
  });
  frames.observe(doc.body, { childList: true, subtree: true });
  view.addEventListener('pagehide', () => frames.disconnect(), { once: true });
  return installSpeakerTimer(doc, t, resetTimer);
}

function Classroom({
  deck: liveDeck,
  locale,
  slideId,
  t,
  receiver = false,
  onClose,
}: PanelProps & { receiver?: boolean; onClose?: () => void }) {
  // A presentation uses one revision even if a generator or another tab edits the lesson.
  const [deck] = useState(liveDeck);
  const [presentationSession]=useState(()=>crypto.randomUUID());
  const [slides] = useState(() => readySlides(deck));
  const media = usePresentationMedia(slides, deck.brand?.logo);
  const [start] = useState(() => initialIndex(slides, slideId));
  const [index, setIndex] = useState(start);
  const [answer, setAnswer] = useState(false);
  const [black, setBlack] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef(performance.now());
  const room = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const api = useRef<RevealApi | null>(null);
  const speakerWindow = useRef<Window | null>(null);
  const speakerTiming = useRef<((timing: SpeakerTiming) => void) | undefined>(undefined);
  const notesId = useId();
  const slide = slides[index];
  const [weights] = useState(() => {
    const rate = deck.speechProfile?.language === deck.language ? deck.speechProfile.wordsPerMinute : undefined;
    return slides.map(item => speechSeconds(spokenNarration(narrationSource(item), deck.language), rate));
  });
  const weightTotal=weights.reduce((sum,value)=>sum+value,0);
  const planTotal=deck.plannedMinutes ? Math.round(deck.plannedMinutes*60) : weightTotal;
  const endOfSlide=weightTotal ? Math.round(planTotal*weights.slice(0,index+1).reduce((sum,value)=>sum+value,0)/weightTotal) : 0;
  const remaining = endOfSlide - seconds;
  const elapsed = clock(seconds);
  const pace = !weightTotal ? '' : remaining === 0 ? t('paceOnTime') :
    clock(Math.abs(remaining)) + ' ' + t(remaining > 0 ? 'paceLeft' : 'paceOver');
  const plan = t('lessonPlan') + ' ' + clock(planTotal);
  const resetTimer = () => {
    startedAt.current = performance.now();
    setSeconds(0);
  };
  useEffect(() => {
    const view = speakerWindow.current;
    if (view && !view.closed) writeSpeakerNotes(view, slide?.notes ?? '');
  }, [slide]);
  useEffect(() => {
    if (speakerWindow.current?.closed) speakerTiming.current = undefined;
    speakerTiming.current?.({elapsed, pace, plan});
  }, [elapsed, pace, plan]);
  useEffect(() => {
    if (!stage.current || !slides.length) return;
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('lessonProjection', deck.id);
    url.searchParams.set('lessonRevision', String(deck.revision));
    url.searchParams.set('uiLanguage', locale);
    const config = {
      embedded: true,
      disableLayout: true,
      controls: false,
      progress: false,
      center: false,
      overview: false,
      help: false,
      touch: true,
      keyboard: false,
      hash: false,
      history: false,
      // Receiver frames consume the notes plugin's commands. Only teacher
      // actions drive the classroom stage, including when the frames render slowly.
      transition: 'none' as const,
      backgroundTransition: 'none' as const,
      scrollActivationWidth: 0,
      viewDistance: 3,
      postMessage: receiver,
      url: url.toString(),
      plugins: receiver ? [] : [Notes],
    };
    let disposed = false;
    let instance: RevealApi | undefined;
    // Deferring setup also avoids creating two plugin listeners during StrictMode's mount probe.
    queueMicrotask(() => {
      if (disposed || !stage.current) return;
      const current = new Reveal(stage.current, config);
      instance = current;
      const update = () => {
        if (disposed) return;
        const { h, f } = current.getIndices();
        setIndex(h);
        setAnswer((f ?? -1) >= 0);
        setBlack(current.isPaused());
      };
      ['slidechanged', 'fragmentshown', 'fragmenthidden', 'paused', 'resumed'].forEach((name) =>
        current.on(name, update),
      );
      void current
        .initialize()
        .then(() => {
          if (disposed) {
            current.destroy();
            return;
          }
          api.current = current;
          if (!receiver) {
            current.slide(start,0,-1);
            void fetch(endpoint(deck)+'/presentation-start',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({session:presentationSession})}).catch(()=>undefined);
          }
          else if (window.parent !== window && !current.getConfig().postMessageEvents) {
            // The upcoming frame fetches its snapshot asynchronously. Request the
            // initial state again if the current frame completed the handshake first.
            window.parent.postMessage(
              JSON.stringify({ namespace: 'reveal', eventName: 'ready', state: current.getState() }),
              location.origin,
            );
          }
          update();
        })
        .catch(() => {
          if (!disposed) setError(t('error'));
        });
    });
    return () => {
      disposed = true;
      speakerWindow.current?.close();
      speakerWindow.current = null;
      speakerTiming.current = undefined;
      if (api.current === instance && instance) {
        api.current = null;
        instance.destroy();
      }
    };
  }, [deck.id, deck.revision, locale, receiver, slides, start]); // t reflects locale
  useEffect(() => {
    if (receiver) return;
    const interval = window.setInterval(() => setSeconds(Math.floor((performance.now() - startedAt.current) / 1000)), 1000);
    const changed = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      clearInterval(interval);
      document.removeEventListener('fullscreenchange', changed);
    };
  }, [receiver]);
  const flipAnswer = () => api.current?.navigateFragment(answer ? -1 : 0);
  const advance = () => {
    if (api.current?.isPaused()) api.current.togglePause(false);
    else api.current?.next();
  };
  const navigateKey = (key: string) => {
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') advance();
    else if (key === 'ArrowLeft' || key === 'PageUp') api.current?.prev();
    else if (key.toLowerCase() === 'b') api.current?.togglePause();
    else return false;
    return true;
  };
  const openNotes = () => {
    try {
      const plugin = api.current?.getPlugin('notes') as ReturnType<typeof Notes> | undefined;
      if (!plugin) return;
      plugin.open();
      if (speakerWindow.current && !speakerWindow.current.closed) return;
      // Reuse the named window created synchronously by reveal.js.
      const view = window.open('', 'reveal.js - Notes');
      if (view) {
        speakerWindow.current = view;
        speakerTiming.current = localizeSpeaker(view, locale, t, navigateKey, slide?.notes ?? '', resetTimer);
        speakerTiming.current?.({elapsed, pace, plan});
        return;
      }
    } catch { /* The inline notes remain available when the browser blocks the popup. */ }
    setError(t('popupBlocked'));
    setSpeaker(true);
  };
  const toggleFull = () => {
    const pending = document.fullscreenElement
      ? document.exitFullscreen()
      : room.current?.requestFullscreen?.();
    if (pending) void pending.catch(() => setError(t('screenBlocked')));
    else setError(t('screenBlocked'));
  };
  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (
      receiver ||
      e.altKey ||
      e.metaKey ||
      e.ctrlKey ||
      (e.target as HTMLElement).matches('input,textarea,select')
    )
      return;
    if ((e.key !== ' ' || !(e.target as HTMLElement).closest('button,a')) && navigateKey(e.key))
      e.preventDefault();
    else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      openNotes();
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      toggleFull();
    }
  }
  return (
    <div
      className={`rv-classroom${receiver ? ' rv-receiver' : ''}${speaker ? ' has-speaker' : ''}`}
      ref={room}
      onKeyDown={handleKey}
      lang={locale}
      tabIndex={-1}
    >
      {!receiver && (
        <header className="rv-project-header">
          <span className="rv-project-title">
            <ProjectorScreenIcon size={20} weight="duotone" />
            <strong lang={deck.language}>{deck.title}</strong>
            <small data-offline-media={media.state} role="status">{t(media.state === 'ready' ? 'offlineReady' : media.state === 'loading' ? 'offlineLoading' : 'offlineIncomplete')}</small>
          </span>
          <Tool text label={t('exit')} click={() => onClose?.()}>
            <XIcon size={20} />
          </Tool>
        </header>
      )}
      {slide ? (
        <div className="rv-class-body">
          <div className="rv-projection">
            <div
              className="reveal rv-stage"
              data-story-playback={receiver ? undefined : true}
              ref={stage}
              onClick={(e) => {
                if (!receiver && !(e.target as HTMLElement).closest('button,a')) advance();
              }}
            >
              <div className="slides">
                {slides.map((s, i) => (
                  <section key={s.id} className="rv-projected-slide">
                    <SlideCanvas
                      deck={media.withBrand(deck)}
                      slide={media.withMedia(s)}
                      lang={locale}
                      includeChartData={i === index}
                      revealAnswer={i === index && answer}
                    />
                    {s.answer && <span className="rv-fragment-state fragment" aria-hidden="true" />}
                    <aside className="notes">{s.notes}</aside>
                  </section>
                ))}
              </div>
            </div>
          </div>
          {speaker && !receiver && (
            <aside className="rv-speakerpanel" id={notesId} aria-label={t('speaker')}>
              <div className="rv-speaker-notes">
                <h3><NotePencilIcon size={16} aria-hidden/>{t('notes')}</h3>
                <p lang={deck.language}>{slide.notes || t('noNotes')}</p>
              </div>
              <h3>{t('next')}</h3>
              {slides[index + 1] ? (
                <figure className="rv-next-slide">
                  <div className="rv-mini">
                    <SlideCanvas
                      deck={media.withBrand(deck)}
                      slide={media.withMedia(slides[index + 1])}
                      lang={locale}
                      revealAnswer={false}
                    />
                  </div>
                  <figcaption className="rv-next-title" lang={deck.language}>{slides[index + 1].title}</figcaption>
                </figure>
              ) : (
                <p>{t('last')}</p>
              )}
              <div className="rv-speaker-tools">
                <div className="rv-elapsed">
                  <ClockIcon size={16} />
                  <span>{t('time')}</span>
                  <strong>{elapsed}</strong>
                </div>
                <div className="rv-speaker-pace">
                  {pace && <p>{pace}</p>}
                  <small>{plan}</small>
                </div>
                <Button type="button" variant="ghost" size="sm" className="rv-speaker-reset" onClick={resetTimer}>
                  {t('resetClock')}
                </Button>
                <Button type="button" variant="outline" className="rv-secondary" onClick={openNotes}>
                  <ArrowSquareOutIcon size={17} />
                  {t('speakerWindow')}
                </Button>
              </div>
            </aside>
          )}
        </div>
      ) : (
        <p className="rv-empty">{t('none')}</p>
      )}
      {!receiver && (
        <footer className="rv-present-bar">
          {slide && (
            <div className="rv-projection-progress" aria-hidden="true">
              <span style={{ width: `${((index + 1) / slides.length) * 100}%` }} />
            </div>
          )}
          {slide && (
            <Stepper
              slides={slides} locale={locale}
              index={index}
              set={(i) => api.current?.slide(i, 0, -1)}
              t={t}
            />
          )}
          <div className="rv-present-actions" role="group" aria-label={t('present')}>
            <div className="rv-present-set">
              {slide && <TeacherPoll deckId={deck.id} locale={locale} initialQuestion={slide.title}/>}
              {slide?.answer && (
                <Tool text label={t(answer ? 'hideAnswer' : 'answer')} pressed={answer} click={flipAnswer}>
                  {answer ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
                </Tool>
              )}
            </div>
            <div className="rv-present-set">
              <Tool
                text
                label={t('speaker')}
                expanded={speaker}
                controls={speaker ? notesId : undefined}
                click={() => setSpeaker((v) => !v)}
              >
                <ChalkboardTeacherIcon size={19} />
              </Tool>
              <Tool
                label={t(black ? 'unblack' : 'black')}
                pressed={black}
                click={() => api.current?.togglePause()}
              >
                {black ? <SunIcon size={19} /> : <MoonStarsIcon size={19} />}
              </Tool>
              <Tool label={t(full ? 'fullOff' : 'full')} pressed={full} click={toggleFull}>
                {full ? <ArrowsInIcon size={19} /> : <ArrowsOutIcon size={19} />}
              </Tool>
            </div>
          </div>
        </footer>
      )}
      {error && (
        <p className="rv-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReviewReceiver() {
  const query = new URLSearchParams(location.search);
  const id = query.get('lessonProjection') || '';
  const revision = query.has('lessonRevision') ? Number(query.get('lessonRevision')) : undefined;
  const requested = query.get('uiLanguage');
  const locale: Locale = requested === 'kk' || requested === 'ru' ? requested : 'en';
  const [deck, setDeck] = useState<Deck>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      const url = `/api/decks/${encodeURIComponent(id)}`;
      const response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) throw Error();
      let current = (await response.json()) as Deck;
      if (revision !== undefined && current.revision !== revision) {
        const history = await fetch(`${url}/revisions`, { signal: ctrl.signal });
        if (!history.ok) throw Error();
        const snapshot = ((await history.json()) as Revision[]).find(
          (r) => r.revision === revision,
        )?.deck;
        if (!snapshot) throw Error();
        current = snapshot;
      }
      if (!ctrl.signal.aborted) setDeck(current);
    })().catch(() => {
      if (!ctrl.signal.aborted) setError(true);
    });
    return () => ctrl.abort();
  }, [id, revision]);
  const t = (word: ReviewWord) => reviewText(locale, word);
  return deck ? (
    <Classroom deck={deck} locale={locale} t={t} receiver />
  ) : (
    <p role="status">{t(error ? 'error' : 'load')}</p>
  );
}

function RevisionPanel({
  deck,
  locale,
  t,
  onRestore,
}: PanelProps & { onRestore: ReviewProps['onRestore'] }) {
  const [list, setList] = useState<Revision[]>([]);
  const [selection, select] = useState(deck.revision);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReviewWord>();
  const [base, setBase] = useState(deck.revision);
  const active = list.find((r) => r.revision === selection);
  const snapshot = active?.deck;
  const slides = snapshot ? readySlides(snapshot) : [];
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(undefined);
    void fetch(`${endpoint(deck)}/revisions`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw Error();
        const rows = ((await res.json()) as Revision[]).sort((a, b) => b.revision - a.revision);
        if (ctrl.signal.aborted) return;
        setList(rows);
        setBase(rows[0]?.revision ?? deck.revision);
        select(rows[0]?.revision ?? deck.revision);
        setPage(0);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setError('error');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [deck.id, deck.revision, reload]);
  async function restore() {
    if (!active || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await fetch(`${endpoint(deck)}/revisions/${active.revision}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: base }),
      });
      if (res.status === 409) {
        setError('restoreConflict');
        return;
      }
      if (!res.ok) throw Error();
      onRestore((await res.json()) as Deck);
    } catch {
      setError('error');
    } finally {
      setSaving(false);
    }
  }
  const reasonLabel = (reason: string): ReviewWord =>
    reason === 'Theme change' ? 'themeChanged' : /restor/i.test(reason)
      ? 'restored'
      : /propos|assist/i.test(reason)
        ? 'assistant'
        : /generat|outline|stream|run/i.test(reason)
          ? 'generated'
          : /create|sample|seed/i.test(reason)
            ? 'created'
            : /edit|patch|user|operat/i.test(reason)
              ? 'edited'
              : 'saved';
  const chooseVersion = (revision: number) => {
    select(revision);
    setPage(0);
  };
  const stamp = (at: string) => formatStudioDate(at, locale, {time: true});
  return (
    <div className="rv-options-body rv-history">
      {list.length > 0 && (
        <div className="rv-version-picker">
          <span>{t('chooseVersion')}</span>
          <ReviewSelect
            label={t('chooseVersion')}
            value={String(selection)}
            options={list.map((r) => ({
              value: String(r.revision),
              label: [`${t('version')} ${r.revision}`, t(reasonLabel(r.reason)), ...(r.revision === base ? [t('current')] : []), stamp(r.at)].join(' · '),
            }))}
            onChange={(value) => chooseVersion(Number(value))}
          />
        </div>
      )}
      <div className="rv-history-list" role="group" aria-label={t('versions')}>
        {loading ? (
          <p role="status">{t('load')}</p>
        ) : (
          list.map((r) => (
            <Button
              key={r.revision}
              type="button"
              variant="ghost"
              className={`rv-version${r.revision === selection ? ' active' : ''}`}
              aria-pressed={r.revision === selection}
              onClick={() => chooseVersion(r.revision)}
            >
              <span className="rv-version-top">
                {t('version')} {r.revision}
                {r.revision === base && <small>{t('current')}</small>}
              </span>
              <span className="rv-version-reason">{t(reasonLabel(r.reason))}</span>
              <time dateTime={r.at}>{stamp(r.at)}</time>
            </Button>
          ))
        )}
      </div>
      <div className="rv-history-main">
        {snapshot && slides[page] ? (
          <>
            <div className="rv-panel-top">
              <strong lang={snapshot.language}>{snapshot.title}</strong>
              <Stepper index={page} slides={slides} locale={locale} set={setPage} t={t} />
            </div>
            <div className="rv-preview-board">
              <div className="rv-frame">
                <SlideCanvas slide={slides[page]} deck={snapshot} lang={locale} />
              </div>
            </div>
          </>
        ) : (
          !loading && <p>{t('none')}</p>
        )}
        {active?.revision === base ? (
          <p className="rv-history-current">
            <CheckCircleIcon size={19} weight="duotone" />
            {t('currentVersion')}
          </p>
        ) : (
          active && (
            <>
              <p className="rv-explainer">{t('restoreDesc')}</p>
              <div className="rv-footer-actions">
                <Button
                  type="button"
                  className="rv-primary"
                  disabled={!active || active.revision === base || saving || error === 'restoreConflict'}
                  onClick={restore}
                >
                  {saving ? (
                    <CircleNotchIcon className="rv-spin" size={16} />
                  ) : (
                    <ArrowCounterClockwiseIcon size={16} />
                  )}{' '}
                  {t('restore')}
                </Button>
              </div>
            </>
          )
        )}
        {error && (
          <p className="rv-error" role="alert">
            {t(error)}{' '}
            <Button type="button" variant="ghost" onClick={() => setReload((v) => v + 1)}>
              {t('reload')}
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}

const formats = [
  { id: 'pptx', label: 'PowerPoint', icon: PresentationIcon },
  { id: 'pdf', label: 'PDF', icon: FilePdfIcon },
  { id: 'png', label: 'PNG', icon: FilePngIcon },
] as const;
function ExportPanel({ deck, locale, slideId, t }: PanelProps) {
  const [format, setFormat] = useState<ExportFormat>('pptx');
  const [downloading,setDownloading] = useState(false);
  const [downloadError,setDownloadError] = useState(false);
  const downloadRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => downloadRequest.current?.abort(), []);
  const slides = readySlides(deck);
  const complete = slides.length>0 && slides.length===deck.slides.length;
  const [page, setPage] = useState(() => initialIndex(slides, slideId));
  const idx = Math.min(page, Math.max(0, slides.length - 1));
  const slide = slides[idx];
  const canDownload = format === 'png' ? !!slide : complete;
  const download = async () => {
    if (!canDownload || downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    const { signal } = controller;
    setDownloading(true);
    setDownloadError(false);
    try {
      const exportsUrl = endpoint(deck) + '/exports';
      const started = await fetch(exportsUrl, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, revision: deck.revision, ...(format === 'png' && slide && { slideId: slide.id }) }),
      });
      if (!started.ok) throw new Error('Export could not start.');
      let job = await started.json() as ExportJob;
      const jobUrl = exportsUrl + '/' + job.id;
      while (job.status === 'queued' || job.status === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 700));
        const status = await fetch(jobUrl, { signal });
        if (!status.ok) throw new Error('Export status is unavailable.');
        job = await status.json() as ExportJob;
      }
      if (job.status !== 'ready') throw new Error('Export failed.');
      const query = new URLSearchParams({ downloadId: crypto.randomUUID() });
      const response = await fetch(jobUrl + '/file?' + query, { signal });
      if (!response.ok) throw new Error('Download failed');
      const objectUrl=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=objectUrl;
      link.download = exportFilename(format === 'png' && slide ? slide.title : deck.title, format);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    } catch {
      if (!signal.aborted) setDownloadError(true);
    } finally {
      downloadRequest.current = undefined;
      if (!signal.aborted) setDownloading(false);
    }
  };
  return (
    <div className="rv-normal">
      {!canDownload&&<p className="rv-limit rv-export-limit">
        <InfoIcon size={18} />
        {t('exportWaiting')}
      </p>}
      <div className="rv-options-body rv-export-body">
        <div className="rv-export-preview">
          <div className="rv-panel-top">
            <strong>{t(format === 'png' ? 'slideScope' : 'deckScope')}</strong>
            {slide && <Stepper index={idx} set={setPage} slides={slides} locale={locale} t={t} />}
          </div>
          {slide ? (
            <div className="rv-preview-board">
              <div className="rv-frame">
                <SlideCanvas deck={deck} slide={slide} lang={deck.language} revealAnswer={false} />
              </div>
            </div>
          ) : (
            <p>{t('none')}</p>
          )}
          {format === 'pptx' && slide?.notes.trim() && (
            <details className="rv-slide-notes">
              <summary>
                <NotePencilIcon size={18} />
                {t('notes')}
                <CaretDownIcon size={15} />
              </summary>
              <p lang={deck.language}>{slide.notes}</p>
            </details>
          )}
        </div>
        <div className="rv-export-settings">
          <fieldset className="rv-choose-format">
            <legend>{t('formats')}</legend>
            <div className="rv-format-list">
              {formats.map(({ id, label, icon: Icon }) => (
                <Button
                  type="button"
                  key={id}
                  variant="outline"
                  aria-pressed={id === format}
                  disabled={downloading}
                  onClick={() => { setFormat(id); setDownloadError(false); }}
                  className={id === format ? 'active' : ''}
                >
                  <Icon size={25} weight="duotone" />
                  <span>
                    <strong>{label}</strong>
                    {label.toLowerCase() !== id && <small>.{id}</small>}
                  </span>
                  {id === format && (
                    <CheckCircleIcon size={18} weight="fill" className="rv-format-check" />
                  )}
                </Button>
              ))}
            </div>
          </fieldset>
          <aside className="rv-summary" aria-label={formats.find((f) => f.id === format)?.label}>
            <p>{t(format === 'pdf' ? 'pdfHelp' : format === 'png' ? 'pngHelp' : 'pptxHelp')}</p>
            <dl>
              <div>
                <dt>{t('scope')}</dt>
                <dd>{t(format === 'png' ? 'oneSlide' : 'allSlides')}</dd>
              </div>
              <div>
                <dt>{t('slides')}</dt>
                <dd>{format === 'png' && slide ? 1 : slides.length}</dd>
              </div>
              {format === 'pptx' && (
                <div>
                  <dt>{t('withNotes')}</dt>
                  <dd>
                    {slides.filter((s) => s.notes.trim()).length} / {slides.length}
                  </dd>
                </div>
              )}
            </dl>
          </aside>
          <Button type="button" disabled={!canDownload||downloading} onClick={()=>void download()}>
            <DownloadSimpleIcon aria-hidden/>{t(downloading ? 'exportPreparing' : format === 'pptx' ? 'downloadPptx' : format === 'pdf' ? 'downloadPdf' : 'downloadPng')}
          </Button>
          {downloadError&&<p className="rv-error" role="alert">{t('exportDownloadError')}</p>}
        </div>
      </div>
    </div>
  );
}

export function Review({ mode, deck, locale, slideId, onClose, onRestore }: ReviewProps) {
  const [open, setOpen] = useState(true);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const close = () => setOpen(false);
  const returnFocus = () => {
    if (origin.current?.isConnected && origin.current !== document.body) return origin.current;
    const trigger = mode === 'present' ? '[data-action="present"]' : '[aria-haspopup="menu"]';
    return document.querySelector<HTMLElement>(`.deck-header ${trigger}`) ?? true;
  };
  const t = useCallback((word: ReviewWord) => reviewText(locale, word), [locale]);
  const common = { deck, locale, slideId, t };
  const Icon = mode === 'versions' ? ClockCounterClockwiseIcon : FileTextIcon;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogPopup
        className={`rv-dialog rv-mode-${mode}`}
        lang={locale}
        showCloseButton={false}
        bottomStickOnMobile={false}
        finalFocus={returnFocus}
      >
        <IconContext.Provider value={{ 'aria-hidden': true, focusable: false }}>
          <div className="rv-sheet">
            {mode === 'present' ? (
              <>
                <DialogTitle className="rv-sr">{t('present')}</DialogTitle>
                <Classroom {...common} onClose={close} />
              </>
            ) : mode === 'video' ? (
              <LectureExport key={deck.id} deck={deck} locale={locale} slideId={slideId} onClose={close}/>
            ) : (
              <>
                <header className="rv-modal-header">
                  <span className="rv-heading-icon">
                    <Icon size={24} weight="duotone" />
                  </span>
                  <div>
                    <DialogTitle>{t(mode)}</DialogTitle>
                    <p lang={deck.language}>{deck.title}</p>
                  </div>
                  <Tool label={t('close')} click={close}>
                    <XIcon size={19} />
                  </Tool>
                </header>
                {mode === 'versions' ? (
                  <RevisionPanel {...common} onRestore={onRestore} />
                ) : (
                  <ExportPanel {...common} />
                )}
              </>
            )}
          </div>
        </IconContext.Provider>
      </DialogPopup>
    </Dialog>
  );
}
