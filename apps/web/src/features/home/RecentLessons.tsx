import { ArrowRightIcon, PresentationIcon } from '@phosphor-icons/react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { LanguageFlag } from '@/components/LanguageFlag';
import { Button } from '@/components/shadcn/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/shadcn/empty';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/shadcn/item';
import { Skeleton } from '@/components/shadcn/skeleton';
import { languages, words } from '@/copy';
import { formatStudioDate } from '@/lib/date';
import { HomeSectionHeading } from './HomeSectionHeading';
import { homeCopy } from './home-copy';
import './recent-lessons.css';

function RecentLessonCard({ deck, locale }: { deck: Deck; locale: Locale }) {
  const cover = deck.slides.find(slide => slide.status === 'ready');
  return (
    <Item
      variant="outline"
      className="creation-lesson-card"
      render={<a href={`#/deck/${encodeURIComponent(deck.id)}`} />}
    >
      <ItemMedia className="creation-lesson-cover" data-has-slide={Boolean(cover)} aria-hidden="true" inert>
        {cover ? <SlideCanvas slide={cover} deck={deck} /> : <PresentationIcon weight="duotone" />}
      </ItemMedia>
      <ItemContent className="creation-lesson-info">
        <ItemTitle lang={deck.language} title={deck.title}>{deck.title}</ItemTitle>
        <ItemDescription className="creation-lesson-meta">
          <span><LanguageFlag locale={deck.language} />{languages[deck.language]}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={deck.updatedAt}>{formatStudioDate(deck.updatedAt, locale)}</time>
        </ItemDescription>
      </ItemContent>
      <ArrowRightIcon className="creation-lesson-arrow" aria-hidden="true" />
    </Item>
  );
}

function RecentLessonSkeletons({ label }: { label: string }) {
  return (
    <div className="creation-lessons-skeleton" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Item className="creation-lesson-card creation-lesson-placeholder" variant="outline" key={index} aria-hidden="true">
          <Skeleton className="creation-lesson-cover" />
          <ItemContent className="creation-lesson-info"><Skeleton /><Skeleton /></ItemContent>
          <span className="creation-lesson-arrow" />
        </Item>
      ))}
    </div>
  );
}

export function RecentLessons({ locale, recent, loading, error, onRetry }: {
  locale: Locale;
  recent: Deck[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const c = homeCopy[locale];
  const t = words[locale];
  return (
    <section className="creation-recents" aria-labelledby="creation-recents-heading" aria-busy={loading}>
      <HomeSectionHeading id="creation-recents-heading" title={c.recent} href="#/library" linkLabel={c.viewAll} />
      {loading ? <RecentLessonSkeletons label={t.initial} /> : error ? (
        <div className="creation-load-error" role="alert">
          <span>{t.unavailable}</span>
          <Button variant="outline" onClick={onRetry}>{t.retry}</Button>
        </div>
      ) : recent.length ? (
        <ul className="creation-lessons-list">
          {recent.map(deck => <li key={deck.id}><RecentLessonCard deck={deck} locale={locale} /></li>)}
        </ul>
      ) : (
        <Empty className="creation-recents-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon"><PresentationIcon aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>{c.empty}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}
