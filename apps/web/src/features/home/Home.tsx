import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon, PresentationIcon } from '@phosphor-icons/react';
import type { CreateInput, Deck, Locale } from '@sabaq/lesson/types';
import type { TemplateId } from '@sabaq/lesson/lesson-templates';
import { Button } from '@/components/shadcn/button';
import { BorderGlow } from '@/components/react-bits/BorderGlow';
import { Skeleton } from '@/components/shadcn/skeleton';
import { useMediaQuery } from '@/components/coss/use-media-query';
import { languages, words } from '@/copy';
import { QuickStart } from './QuickStart';
import type { StartMode } from '@/features/authoring/Start';
import { TemplateGallery } from './TemplateGallery';
import { homeCopy } from './home-copy';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { formatStudioDate } from '@/lib/date';
import './home.css';

const HomeComposer = lazy(() =>
  import('@/features/authoring/HomeComposer').then((module) => ({ default: module.HomeComposer })),
);
const Lightfall = lazy(() => import('@/components/react-bits/Lightfall'));
const lightfallDark = ['#2563eb', '#60a5fa', '#93c5fd'];
const lightfallLight = ['#1d4ed8', '#2563eb', '#60a5fa'];

function HomeBackdrop({ dark }: { dark: boolean }) {
  const allowMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
  const desktop = useMediaQuery('(min-width: 768px)');
  const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!allowMotion) return;
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(() => setReady(true), { timeout: 600 });
      return () => window.cancelIdleCallback(idle);
    }
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [allowMotion]);

  return (
    <div className="creation-home-backdrop" aria-hidden="true">
      {allowMotion && ready && (
        <Suspense fallback={null}>
          <Lightfall
            colors={dark ? lightfallDark : lightfallLight}
            backgroundColor="#2563eb"
            lightMode={!dark}
            speed={0.18}
            streakCount={2}
            streakWidth={0.85}
            streakLength={1.2}
            density={0.56}
            twinkle={0.08}
            glow={1.05}
            backgroundGlow={0.12}
            headGlow={0.38}
            bloom={desktop ? 0.22 : 0}
            opacity={dark ? 0.55 : 0.31}
            fade={0.13}
            mouseInteraction={hasFinePointer}
            mouseStrength={0.13}
            lens={0.18}
            holdToWarp={false}
            intro={false}
            dpr={1}
          />
        </Suspense>
      )}
    </div>
  );
}

interface HomeProps {
  locale: Locale;
  dark: boolean;
  localAuthoring: boolean;
  researchTopics: string[];
  alem: boolean;
  recent: Deck[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onCreate: (input: CreateInput) => Promise<void>;
  onStart: (mode: StartMode) => void;
  onTemplate: (template: TemplateId, topic: string) => void;
}

export function Home({
  locale,
  dark,
  localAuthoring,
  researchTopics,
  alem,
  recent,
  loading,
  error,
  onRetry,
  onCreate,
  onStart,
  onTemplate,
}: HomeProps) {
  const [suggestion, setSuggestion] = useState<{ id: number; text: string }>();
  const c = homeCopy[locale],
    t = words[locale];
  return (
    <div className="creation-home-page">
      <HomeBackdrop dark={dark} />
      <div className="creation-home">
        <section className="creation-hero" aria-labelledby="creation-heading">
          <h1 id="creation-heading">{c.heading}</h1>
          <BorderGlow colors={[
            'var(--primary)',
            'color-mix(in oklab, var(--primary) 56%, white)',
            'color-mix(in oklab, var(--primary) 76%, white)',
          ]} glowColor="var(--primary)" borderRadius={23}>
            <Suspense
              fallback={
                <div className="creation-prompt-placeholder" role="status" aria-busy="true">
                  <span className="sr-only">{t.initial}</span>
                  <Skeleton />
                  <Skeleton />
                </div>
              }
            >
              <HomeComposer
                suggestion={suggestion}
                researchTopics={researchTopics}
                locale={locale}
                localAuthoring={localAuthoring}
                alem={alem}
                onCreate={onCreate}
              />
            </Suspense>
          </BorderGlow>
          <QuickStart
            locale={locale}
            onStart={onStart}
            onSuggest={(text) => setSuggestion((previous) => ({ id: (previous?.id ?? 0) + 1, text }))}
          />
        </section>
        <TemplateGallery locale={locale} onChoose={onTemplate} />
        <section className="creation-recents" aria-labelledby="creation-recents-heading" aria-busy={loading}>
          <div className="creation-section-title">
            <h2 id="creation-recents-heading">{c.recent}</h2>
            <a href="#/library">
              {c.viewAll}
              <ArrowRightIcon data-motion-arrow />
            </a>
          </div>
          {loading ? (
            <div className="creation-lessons-skeleton" role="status">
              <span className="sr-only">{t.initial}</span>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : error ? (
            <div className="creation-load-error" role="alert">
              {t.unavailable}
              <Button variant="outline" onClick={onRetry}>
                {t.retry}
              </Button>
            </div>
          ) : recent.length ? (
            <ul className="creation-lessons-list">
              {recent.map((deck) => (
                <li key={deck.id}>
                  <a href={`#/deck/${encodeURIComponent(deck.id)}`}>
                    <span className="creation-lesson-cover" aria-hidden="true" inert>
                      {deck.slides.find(slide => slide.status === 'ready')
                        ? <SlideCanvas slide={deck.slides.find(slide => slide.status === 'ready')!} deck={deck} />
                        : <span className="creation-lesson-draft"><PresentationIcon weight="duotone"/><strong>{deck.title}</strong></span>}
                    </span>
                    <span className="creation-lesson-info">
                      <strong lang={deck.language}>{deck.title}</strong>
                      <small>
                        {languages[deck.language]}
                        <i aria-hidden="true">·</i>
                        {formatStudioDate(deck.updatedAt, locale)}
                      </small>
                    </span>
                    <ArrowUpRightIcon />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>{c.empty}</p>
          )}
        </section>
      </div>
    </div>
  );
}
