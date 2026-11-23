import type { CSSProperties } from 'react';
import {
  ArrowRightIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PresentationChartIcon,
  StopIcon,
} from '@phosphor-icons/react';
import { lessonPalette } from '@sabaq/lesson/themes';
import type { Deck, Layout, Locale, OutlineItem, Slide } from '@sabaq/lesson/types';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Progress } from '@/components/coss/progress';
import { Button } from '@/components/shadcn/button';
import { words } from '@/copy';
import './storyboard.css';

const storyboardCopy = {
  en: {
    title: 'Slide storyboard',
    planned: 'Outline preview',
    ready: 'Ready',
    writing: 'Writing',
    queued: 'Queued',
    failed: 'Failed',
    stopped: 'Stopped',
    paused: 'Generation paused',
    progress: 'Generation progress',
    starting: 'Preparing slides',
    empty: 'No slides planned',
    add: 'Add a blank slide',
    resume: 'Resume generation',
    slide: 'Slide',
    count: (n: number, total: number) =>
      total === 1 ? `${n} of 1 slide ready` : `${n} of ${total} slides ready`,
  },
  ru: {
    title: 'Раскадровка урока',
    planned: 'Эскиз из плана',
    ready: 'Готово',
    writing: 'Создаётся',
    queued: 'В очереди',
    failed: 'Ошибка',
    stopped: 'Остановлено',
    paused: 'Создание приостановлено',
    progress: 'Ход создания',
    starting: 'Подготовка слайдов',
    empty: 'В плане нет слайдов',
    add: 'Добавить пустой слайд',
    resume: 'Продолжить создание',
    slide: 'Слайд',
    count: (n: number, total: number) => `Готово слайдов: ${n} из ${total}`,
  },
  kk: {
    title: 'Слайдтар көрінісі',
    planned: 'Жоспар нобайы',
    ready: 'Дайын',
    writing: 'Жасалуда',
    queued: 'Кезекте',
    failed: 'Қате',
    stopped: 'Тоқтатылды',
    paused: 'Жасау тоқтатылды',
    progress: 'Жасалу барысы',
    starting: 'Слайдтар дайындалуда',
    empty: 'Жоспарда слайд жоқ',
    add: 'Бос слайд қосу',
    resume: 'Жасауды жалғастыру',
    slide: 'Слайд',
    count: (n: number, total: number) => `${total} слайдтың ${n}-і дайын`,
  },
};

type StoryEntry = { slide: Slide; outline?: OutlineItem; title: string; number: number };
type StoryProps = {
  deck: Deck;
  locale: Locale;
  active: boolean;
  busy: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onPresent: () => void;
  onCancel: () => void;
  onRetry: (id: string) => void;
  onResume: () => void;
};

function ProgressRing({ ready, total, locale }: { ready: number; total: number; locale: Locale }) {
  const c = storyboardCopy[locale];
  const percent = total ? (100 * ready) / total : 0;
  return (
    <Progress
      className="sb-ring"
      aria-label={c.progress}
      value={total ? ready : null}
      max={Math.max(1, total)}
      aria-valuetext={c.count(ready, total)}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className="sb-ring-track" cx="20" cy="20" r="17" />
        <circle
          className="sb-ring-value"
          cx="20"
          cy="20"
          r="17"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
          transform="rotate(-90 20 20)"
          opacity={ready ? 1 : 0}
        />
      </svg>
      <span aria-hidden="true">
        {Math.round(percent)}
        <small>%</small>
      </span>
    </Progress>
  );
}

// Each outline thumbnail uses the composition that is saved for this slide.
function LayoutBlueprint({ layout }: { layout: Layout }) {
  let shapes;
  if (layout === 'data-chart') {
    shapes = (
      <>
        <path d="M9 24h28M11 10v14" />
        <path d="M15 21v-5m6 5V9m6 12v-8m6 8V6" strokeWidth="3.5" />
      </>
    );
  } else if (layout === 'native-table') {
    shapes = (
      <>
        <rect x="8" y="7" width="29" height="18" rx="1.5" />
        <path d="M8 13h29M8 19h29M18 7v18M27 7v18" />
      </>
    );
  } else if (layout === 'quote') {
    shapes = (
      <>
        <path d="M11 17v-4q0-6 5-6M19 17v-4q0-6 5-6" strokeWidth="2.8" />
        <path d="M24 16h11m-11 4h8" />
      </>
    );
  } else if (layout.startsWith('image') || layout === 'avatar-right') {
    shapes = (
      <g transform={layout === 'image-left' ? 'translate(45 0) scale(-1 1)' : undefined}>
        <path d="M8 11h11M8 15h9M8 19h7" />
        <rect x="23" y="7" width="14" height="18" rx="1.5" />
        <path d="m24 22 4-6 3 3 3-4 3 4" />
        <circle cx="27" cy="11" r="1" />
      </g>
    );
  } else if (layout === 'split') {
    shapes = (
      <>
        <path d="M8 8h23" />
        <rect x="8" y="13" width="12" height="11" rx="1.5" />
        <rect x="24" y="13" width="12" height="11" rx="1.5" />
      </>
    );
  } else if (layout === 'cover' || layout === 'centered') {
    shapes = (
      <>
        <path d="M13 12h20M10 16h26" strokeWidth="2.6" />
        <path d="M17 22h12" />
      </>
    );
  } else {
    shapes = (
      <>
        <path d="M8 9h17" strokeWidth="2.8" />
        <path d="M8 15h28M8 19h25M8 23h17" />
      </>
    );
  }
  return (
    <svg
      className="sb-layout-glyph"
      viewBox="0 0 45 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes}
    </svg>
  );
}

function PlannedPreview({ entry, deck, locale }: { entry: StoryEntry; deck: Deck; locale: Locale }) {
  const palette = lessonPalette(deck);
  const style = {
    '--sb-paper': palette.paper,
    '--sb-ink': palette.ink,
    '--sb-accent': palette.accent,
    '--sb-tint': palette.tint,
    '--sb-type': palette.heading === 'serif' ? 'var(--font-reading)' : 'var(--font-slide)',
  } as CSSProperties;
  const { outline, slide, title } = entry;
  return (
    <div className="sb-plan-preview" style={style} data-layout={outline?.layout ?? slide.layout}>
      <div className="sb-plan-meta">
        <LayoutBlueprint layout={outline?.layout ?? slide.layout} />
        {outline?.section || storyboardCopy[locale].planned}
      </div>
      <div className="sb-plan-copy" lang={deck.language}>
        <strong>{title}</strong>
        {outline?.summary && outline.summary !== title && <p>{outline.summary}</p>}
      </div>
    </div>
  );
}

function statusLabel(status: Slide['status'], locale: Locale) {
  const c = storyboardCopy[locale];
  return { pending: c.queued, generating: c.writing, ready: c.ready, cancelled: c.stopped, failed: c.failed }[
    status
  ];
}

export function Generation({
  deck,
  locale,
  active,
  busy,
  onAdd,
  onOpen,
  onPresent,
  onCancel,
  onRetry,
  onResume,
}: StoryProps) {
  const t = words[locale],
    c = storyboardCopy[locale];
  const outlines = new Map(deck.outline.map((item) => [item.id, item]));
  const entries: StoryEntry[] = deck.slides.map((slide, index) => {
    const outline = outlines.get(slide.id);
    return {
      slide,
      outline,
      title: slide.title || outline?.title || `${c.slide} ${index + 1}`,
      number: index + 1,
    };
  });
  if (!entries.length) {
    const hasPlan = deck.outline.length > 0;
    return (
      <main className="deck-workbench wb-generation generation-page">
        <header className="sb-heading">
          <div className="sb-heading-copy">
            <h1>{c.title}</h1>
            <p lang={deck.language}>{deck.title}</p>
          </div>
        </header>
        <section className="sb-empty">
          <h2 role="status">{active ? c.starting : hasPlan ? c.paused : c.empty}</h2>
          {active ? (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
              <StopIcon />
              {t.stopGeneration}
            </Button>
          ) : (
            <Button variant="outline" onClick={hasPlan ? onResume : onAdd} disabled={busy}>
              {hasPlan ? <PlayIcon /> : <PlusIcon />}
              {hasPlan ? t.generate : c.add}
            </Button>
          )}
          {hasPlan && (
            <ol aria-label={t.slideSequence} className="sb-empty-list">
              {deck.outline.map((item, index) => (
                <li key={item.id} id={'workbench-slide-' + item.id} tabIndex={-1}>
                  <span className="sb-slide-number">{String(index + 1).padStart(2, '0')}</span>
                  <strong lang={deck.language}>{item.title}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    );
  }
  const ready = entries.filter((entry) => entry.slide.status === 'ready').length;
  const complete = entries.length > 0 && ready === entries.length;
  const writing = entries.find((entry) => entry.slide.status === 'generating');
  const runState = active
    ? writing
      ? `${c.writing} · ${String(writing.number).padStart(2, '0')}`
      : c.starting
    : complete
      ? t.lessonReady
      : c.paused;

  return (
    <main className="deck-workbench wb-generation generation-page">
      <header className="sb-heading">
        <div className="sb-heading-copy">
          <h1>{c.title}</h1>
          <p lang={deck.language}>{deck.title}</p>
        </div>
        <div className="sb-run">
          <ProgressRing ready={ready} total={entries.length} locale={locale} />
          <div className="sb-run-details" role="status">
            <strong>{c.count(ready, entries.length)}</strong>
            <span>
              {runState}
              {active && writing && (
                <>
                  {' '}
                  · <span lang={deck.language}>{writing.title}</span>
                </>
              )}
            </span>
          </div>
          {active ? (
            <Button className="sb-run-action" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
              <StopIcon />
              {t.stopGeneration}
            </Button>
          ) : complete ? (
            <Button className="sb-run-action" variant="outline" size="sm" onClick={onPresent}>
              <PresentationChartIcon />
              {t.present}
            </Button>
          ) : (
            <Button className="sb-run-action" variant="outline" size="sm" onClick={onResume} disabled={busy}>
              <PlayIcon />
              {c.resume}
            </Button>
          )}
        </div>
      </header>
      <ol className="wb-storyboard sb-previews" aria-label={t.slideSequence}>
          {entries.map((entry) => {
            const { slide, number, title } = entry;
            const done = slide.status === 'ready',
              canRetry = slide.status === 'failed' || slide.status === 'cancelled';
            return (
              <li
                key={slide.id}
                id={'workbench-slide-' + slide.id}
                tabIndex={-1}
                data-status={slide.status}
                className="sb-preview"
              >
                {done ? (
                  <div className="sb-canvas" aria-hidden="true" inert>
                    <SlideCanvas deck={deck} slide={slide} lang={locale} revealAnswer={false} />
                  </div>
                ) : (
                  <PlannedPreview entry={entry} deck={deck} locale={locale} />
                )}
                <div className="sb-caption">
                  <span className="sb-slide-number">{String(number).padStart(2, '0')}</span>
                  {done ? (
                    <button
                      className="sb-open"
                      onClick={() => onOpen(slide.id)}
                      aria-label={`${t.openSlide} ${number} · ${title}`}
                    >
                      <span lang={deck.language}>{title}</span>
                      <ArrowRightIcon aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="sb-preview-state">
                      {slide.status === 'generating' ? (
                        <CircleNotchIcon aria-hidden className="wb-spinner" />
                      ) : slide.status === 'pending' ? (
                        <ClockIcon aria-hidden />
                      ) : (
                        <PauseIcon aria-hidden />
                      )}
                      {statusLabel(slide.status, locale)}
                    </span>
                  )}
                  {done && (
                    <span className="sb-ready-mark" title={c.ready}>
                      <CheckIcon aria-hidden />
                      <span className="sr-only">{c.ready}</span>
                    </span>
                  )}
                  {canRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || active}
                      aria-label={`${t.retry} · ${number} · ${title}`}
                      onClick={() => onRetry(slide.id)}
                    >
                      {t.retry}
                    </Button>
                  )}
                </div>
                {slide.status === 'failed' && slide.moderationNotice && (
                  <p className="sb-notice" role="alert">
                    {slide.moderationNotice}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
    </main>
  );
}
