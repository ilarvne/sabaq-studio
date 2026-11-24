import { lazy, Suspense, useEffect, useState } from 'react';
import type { CreateInput, Deck, Locale } from '@sabaq/lesson/types';
import type { TemplateId } from '@sabaq/lesson/lesson-templates';
import { BorderGlow } from '@/components/react-bits/BorderGlow';
import { Skeleton } from '@/components/shadcn/skeleton';
import { useMediaQuery } from '@/components/coss/use-media-query';
import { words } from '@/copy';
import { QuickStart } from './QuickStart';
import { HomeHeading } from './HomeHeading';
import { RecentLessons } from './RecentLessons';
import type { StartMode } from '@/features/authoring/Start';
import { TemplateGallery } from './TemplateGallery';
import '@/components/workspace-tones.css';
import './home.css';

const HomeComposer = lazy(() =>
  import('@/features/authoring/HomeComposer').then((module) => ({ default: module.HomeComposer })),
);
const Lightfall = lazy(() => import('@/components/react-bits/Lightfall'));
const lightfallDark = ['#ffffff'];
const lightfallLight = ['#355bb8', '#6555ae', '#308aa7'];

function HomeBackdrop({ dark }: { dark: boolean }) {
  const forcedColors = useMediaQuery('(forced-colors: active)');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (forcedColors) return;
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(() => setReady(true), { timeout: 600 });
      return () => window.cancelIdleCallback(idle);
    }
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [forcedColors]);

  return (
    <div className="creation-home-backdrop" aria-hidden="true">
      {!forcedColors && ready && (
        <Suspense fallback={null}>
          <Lightfall
            colors={dark ? lightfallDark : lightfallLight}
            backgroundColor={dark ? '#94a3b8' : '#829fce'}
            lightMode={!dark}
            opacity={0.86}
            mouseInteraction
            holdToWarp
            intro
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
  assistantWebResearch: boolean;
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
  assistantWebResearch,
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
  const t = words[locale];
  return (
    <div className="creation-home-page">
      <HomeBackdrop dark={dark} />
      <div className="creation-home">
        <section className="creation-hero" aria-labelledby="creation-heading">
          <HomeHeading key={locale} locale={locale} />
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
                assistantWebResearch={assistantWebResearch}
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
        <RecentLessons locale={locale} recent={recent} loading={loading} error={error} onRetry={onRetry} />
      </div>
    </div>
  );
}
