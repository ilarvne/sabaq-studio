import { useState } from 'react';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { issueLabel } from '@sabaq/contracts/quality';
import { request } from '@/lib/api';
import { Button } from '@/components/shadcn/button';

const text = {
  en: { title: 'Slide check', review: 'Review slide', check: 'Check presentation', pending: 'Checking slide layouts…', unavailable: 'The renderer could not finish the geometry check.', clear: 'No issues found in measured elements.', stale: 'Check this version of the slide.', error: 'Could not start the check.' },
  ru: { title: 'Проверка слайда', review: 'Проверьте слайд', check: 'Проверить презентацию', pending: 'Проверяем макеты…', unavailable: 'Не удалось завершить проверку геометрии.', clear: 'В проверенных элементах нарушений не найдено.', stale: 'Проверьте эту версию слайда.', error: 'Не удалось начать проверку.' },
  kk: { title: 'Слайдты тексеру', review: 'Слайдты тексеріңіз', check: 'Презентацияны тексеру', pending: 'Макеттер тексерілуде…', unavailable: 'Геометрияны тексеру аяқталмады.', clear: 'Өлшенген элементтерден ақау табылмады.', stale: 'Слайдтың осы нұсқасын тексеріңіз.', error: 'Тексеруді бастау мүмкін болмады.' },
};

export function SlideQuality({ deck, slide, locale }: { deck: Deck; slide: Slide; locale: Locale }) {
  const t = text[locale];
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const review = deck.qualityReview;
  const report = review && review.state !== 'pending' && review.theme === deck.theme ? review.slides[slide.id] : undefined;
  const current = report?.version === slide.version;
  const issues = current ? report.issues : [];
  const pending = review?.state === 'pending';
  if (deck.phase !== 'editing' || slide.status !== 'ready') return null;
  async function check() {
    setSending(true); setError(false);
    try { await request('/decks/' + encodeURIComponent(deck.id) + '/quality', { method: 'POST' }); }
    catch { setError(true); }
    finally { setSending(false); }
  }
  const label = issues.length ? t.review + ' (' + issues.length + ')' : t.title;
  return <details className="ed-quality" data-warning={issues.length > 0 || review?.state === 'unavailable'}>
    <summary aria-label={label} title={label}>{issues.length ? <WarningCircleIcon aria-hidden/> : <CheckCircleIcon aria-hidden/>}<span>{label}</span></summary>
    <div className="ed-quality-popup">
      {issues.length > 0 && <ul>{issues.map(issue => <li key={issue}>{issueLabel(issue, locale)}</li>)}</ul>}
      {pending ? <p role="status">{t.pending}</p> : review?.state === 'unavailable' ? <p>{t.unavailable}</p> :
        !current ? <p>{t.stale}</p> : !issues.length ? <p>{t.clear}</p> : null}
      {error && <p role="alert">{t.error}</p>}
      {deck.viewerPermission !== 'view' && <Button size="sm" type="button" variant="outline" disabled={pending || sending} onClick={() => void check()}>{t.check}</Button>}
    </div>
  </details>;
}
