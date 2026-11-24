import type { Deck, Locale } from '@sabaq/lesson/types';
import { useRef, type RefObject } from 'react';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { words } from '@/copy';
import { slideLayoutNames } from '@/slide-layout-copy';
import { planCopy } from './outline-copy';
import './saved-lesson-plan.css';

export const savedLessonPlanLabel = {
  en: planCopy.en.title, ru: planCopy.ru.title, kk: planCopy.kk.title,
};

export function SavedLessonPlan({ deck, locale, open, onOpenChange, returnFocus }: {
  deck: Deck;
  locale: Locale;
  open: boolean;
  onOpenChange(open: boolean): void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const c = planCopy[locale];
  const heading = useRef<HTMLHeadingElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup className="saved-lesson-plan" initialFocus={heading} finalFocus={returnFocus} closeProps={{ 'aria-label': words[locale].close }}>
      <DialogHeader>
        <DialogTitle ref={heading} tabIndex={-1}>{c.title}</DialogTitle>
        <DialogDescription lang={deck.language}>{deck.title}</DialogDescription>
      </DialogHeader>
      <DialogPanel scrollFade={false} className="saved-lesson-plan-panel">
        <p className="saved-lesson-plan-count">{c.slides(deck.outline.length)}</p>
        <ol role="list" className="saved-lesson-plan-items">
          {deck.outline.map((item, index) => {
            const purpose = item.purpose?.trim();
            const fields = [
              [c.purpose, purpose === item.summary.trim() ? undefined : purpose],
              [c.visual, item.visualDescription],
              ...(item.imageScenes ?? []).map((description, scene)=>[`${c.scene} ${scene+1}`,description]),
              [c.narration, item.narrationDraft],
            ].filter(([, value]) => Boolean(value?.trim()));
            return <li key={item.id} className="saved-lesson-plan-item">
              <span className="saved-lesson-plan-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className="saved-lesson-plan-copy">
                {item.section && item.section !== deck.outline[index - 1]?.section &&
                  <p className="saved-lesson-plan-section" lang={deck.language}>{item.section}</p>}
                <h3 lang={deck.language}>{item.title}</h3>
                {item.summary && <p className="saved-lesson-plan-summary" lang={deck.language}>{item.summary}</p>}
                <p className="saved-lesson-plan-layout"><span>{c.layout}</span> {slideLayoutNames[locale][item.layout]}</p>
                {fields.length > 0 && <details>
                  <summary>{c.details}</summary>
                  <dl>{fields.map(([label, value]) => <div key={label}>
                    <dt>{label}</dt><dd lang={deck.language}>{value}</dd>
                  </div>)}</dl>
                </details>}
              </div>
            </li>;
          })}
        </ol>
      </DialogPanel>
    </DialogPopup>
  </Dialog>;
}
