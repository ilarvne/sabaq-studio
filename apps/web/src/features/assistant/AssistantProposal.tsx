'use client';

import { ArrowUpRightIcon, CheckIcon } from '@phosphor-icons/react';
import type { AssistantDecision, AssistantProposal } from '@sabaq/contracts/assistant';
import type { Deck, Locale, Slide } from '@sabaq/lesson/types';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Button } from '@/components/coss/button';
import { Card, CardFooter, CardHeader, CardPanel, CardTitle } from '@/components/coss/card';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';
import './assistant-proposal.css';

const copy = {
  en: {
    changes: 'Proposed changes', pending: 'Pending changes', review: 'Review changes', compare: 'Compare slides', order: 'Review slide order',
    before: 'Before', after: 'After', version: 'Based on lesson version', slide: 'Slide',
    apply: 'Apply changes', dismiss: 'Dismiss', applied: 'Changes applied', dismissed: 'Dismissed', restored: 'Previous version restored',
    restore:'Restore original', newerEdits:'The lesson has newer edits.',
    stale: 'The lesson changed. Request a new proposal.', close: 'Close', untitled: 'Untitled slide', empty: 'No slide',
    clear: 'Content removed', emptyText: 'Empty', textChanges: 'Read the text changes', title: 'Title', body: 'Slide text',
    notes: 'Speaker notes', answer: 'Answer', imageAlt: 'Image description', imageRole: 'Image accessibility',
    decorative: 'Decorative image', meaningful: 'Meaningful image',
  },
  ru: {
    changes: 'Предложенные правки', pending: 'Правки на утверждение', review: 'Проверить правки', compare: 'Сравнить слайды', order: 'Проверить порядок слайдов',
    before: 'До', after: 'После', version: 'На основе версии урока', slide: 'Слайд',
    apply: 'Применить правки', dismiss: 'Отклонить', applied: 'Правки применены', dismissed: 'Отклонено', restored: 'Предыдущая версия восстановлена',
    restore:'Вернуть исходное', newerEdits:'В уроке есть более поздние правки.',
    stale: 'Урок изменился. Запросите новое предложение.', close: 'Закрыть', untitled: 'Слайд без заголовка', empty: 'Слайда нет',
    clear: 'Содержимое удалено', emptyText: 'Пусто', textChanges: 'Посмотреть правки текста', title: 'Заголовок', body: 'Текст слайда',
    notes: 'Заметки докладчика', answer: 'Ответ', imageAlt: 'Описание изображения', imageRole: 'Доступность изображения',
    decorative: 'Декоративное изображение', meaningful: 'Значимое изображение',
  },
  kk: {
    changes: 'Ұсынылған түзетулер', pending: 'Бекітілетін түзетулер', review: 'Түзетулерді тексеру', compare: 'Слайдтарды салыстыру', order: 'Слайдтар ретін тексеру',
    before: 'Бұрын', after: 'Кейін', version: 'Сабақ нұсқасы', slide: 'Слайд',
    apply: 'Түзетулерді қолдану', dismiss: 'Қабылдамау', applied: 'Түзетулер қолданылды', dismissed: 'Қабылданбады', restored: 'Алдыңғы нұсқа қалпына келтірілді',
    restore:'Бастапқы нұсқаны қайтару', newerEdits:'Сабақта кейін енгізілген түзетулер бар.',
    stale: 'Сабақ өзгерді. Жаңа ұсыныс сұраңыз.', close: 'Жабу', untitled: 'Тақырыпсыз слайд', empty: 'Слайд жоқ',
    clear: 'Мазмұн жойылды', emptyText: 'Бос', textChanges: 'Мәтін өзгерістерін оқу', title: 'Тақырып', body: 'Слайд мәтіні',
    notes: 'Баяндамашы жазбалары', answer: 'Жауап', imageAlt: 'Сурет сипаттамасы', imageRole: 'Сурет қолжетімділігі',
    decorative: 'Сәндік сурет', meaningful: 'Мазмұнды сурет',
  },
};

type SlideChange = NonNullable<AssistantProposal['changes']>[number];
type Labels = (typeof copy)[Locale];
const sides = ['before', 'after'] as const;

function changedText({before, after}: SlideChange, labels: Labels) {
  if (!before || !after) return [];
  const fields = ['title', 'body', 'notes', 'answer', 'imageAlt', 'imageRole'] as const;
  const read = (slide: Slide, key: (typeof fields)[number]) => {
    if (key === 'imageRole') return slide.image ? labels[slide.image.decorative ? 'decorative' : 'meaningful'] : '';
    return (key === 'imageAlt' ? slide.image?.alt : slide[key]) ?? '';
  };
  return fields.flatMap(key => {
    const previous = read(before, key);
    const current = read(after, key);
    return previous === current ? [] : [{key, before: previous, after: current}];
  });
}

function CompareSlides({proposal, deck, labels, busy, onDecision}: {
  proposal: AssistantProposal;
  deck: Deck;
  labels: Labels;
  busy: boolean;
  onDecision: (action: AssistantDecision) => void;
}) {
  return <Dialog>
    <DialogTrigger render={<Button size="sm" variant="ghost" />} className="as-change-inspect">
      {labels.compare}<ArrowUpRightIcon aria-hidden size={14} />
    </DialogTrigger>
    <DialogPopup className="as-change-dialog" closeProps={{'aria-label': labels.close}}>
      <DialogHeader>
        <DialogTitle>{labels.compare}</DialogTitle>
        {proposal.baseRevision !== undefined && <DialogDescription>{labels.version} {proposal.baseRevision}</DialogDescription>}
      </DialogHeader>
      <DialogPanel>
        {proposal.changes?.map(change => {
          const textChanges = changedText(change, labels);
          return <div className="as-change-difference" key={change.slideId}>
            <div className="as-change-difference-grid">
              {sides.map(side => {
                const slide = change[side];
                return <figure key={side}>
                  <figcaption>{labels[side]}{slide && <span lang={deck.language}>{slide.title || labels.untitled}</span>}</figcaption>
                  {slide
                    ? <div className="as-change-slide"><SlideCanvas slide={slide} deck={{language: deck.language, theme: proposal.themes?.[side] ?? deck.theme}} /></div>
                    : <div className="as-change-no-slide">{labels.empty}</div>}
                </figure>;
              })}
            </div>
            {textChanges.length > 0 && <details className="as-change-disclosure as-change-text-disclosure">
              <summary>{labels.textChanges}</summary>
              {textChanges.map(field => <div className="as-change-text" key={field.key}>
                <strong>{labels[field.key]}</strong>
                <dl className="as-change-difference-grid">
                  {sides.map(side => <div key={side}>
                    <dt>{labels[side]}</dt>
                    <dd lang={field[side] && field.key !== 'imageRole' ? deck.language : undefined}>{field[side] || labels.emptyText}</dd>
                  </div>)}
                </dl>
              </div>)}
            </details>}
          </div>;
        })}
      </DialogPanel>
      {proposal.status === 'pending' && <DialogFooter className="as-change-dialog-footer">
        <DialogClose render={<Button variant="ghost" disabled={busy}/>} onClick={()=>onDecision('dismiss')}>{labels.dismiss}</DialogClose>
        <DialogClose render={<Button disabled={busy || (proposal.baseRevision !== undefined && proposal.baseRevision !== deck.revision)}/>} onClick={()=>onDecision('apply')}>{labels.apply}</DialogClose>
      </DialogFooter>}
    </DialogPopup>
  </Dialog>;
}

function CompareOrder({order, labels, language}: {order: NonNullable<AssistantProposal['order']>; labels: Labels; language: Locale}) {
  return <details className="as-change-disclosure">
    <summary>{labels.order}</summary>
    <div className="as-change-order">
      {sides.map(side => <div key={side}>
        <strong>{labels[side]}</strong>
        <ol aria-label={labels[side]} lang={language}>
          {order[side].map((title, index) => <li key={index}>{title || labels.untitled}</li>)}
        </ol>
      </div>)}
    </div>
  </details>;
}

export function AssistantProposalCard({proposal, deck, locale, busy, onDecision}: {
  proposal: AssistantProposal;
  deck: Deck;
  locale: Locale;
  busy: boolean;
  onDecision: (action: AssistantDecision) => void;
}) {
  const labels = copy[locale];
  const pending = proposal.status === 'pending';
  const action = proposal.actions.length === 1 ? proposal.actions[0] : undefined;
  const change = action && action.kind !== 'edit_deck' && proposal.changes?.length === 1 ? proposal.changes[0] : undefined;
  const slide = change?.after ?? change?.before;
  const position = change && deck.slides.findIndex(item => item.id === change.slideId);
  const preview = action?.kind === 'edit_slide' && change ? changedText(change, labels).find(field => field.key !== 'title') : undefined;
  const sample = change ?? proposal.changes?.[0];
  const hasComparison = Boolean(proposal.changes?.length);
  const showActionDetail = action?.detail && !preview && !proposal.order && (!slide || !hasComparison);
  const title = slide?.title || action?.label || labels.changes;
  const result = proposal.status === 'pending' ? '' : labels[proposal.status];
  const applied = proposal.status === 'applied';
  const canRestore = applied && proposal.appliedRevision === deck.revision;
  const scrollable = pending && (proposal.actions.length > 1 || Boolean(proposal.order));

  return <Card render={<section />} id={'assistant-proposal-' + proposal.id} className="as-change-card" aria-label={labels.changes} data-status={proposal.status}>
    <CardHeader className="as-change-header">
      <CardTitle className="as-change-title" lang={slide?.title ? deck.language : locale}>{title}</CardTitle>
      {slide && action && <p className="as-change-context">
        {preview ? labels[preview.key] : action.label}{position !== undefined && position >= 0 && ` · ${labels.slide} ${position + 1}`}
      </p>}
    </CardHeader>
    <CardPanel className="as-change-content" data-scrollable={scrollable || undefined}
      tabIndex={scrollable ? 0 : undefined} role={scrollable ? 'region' : undefined} aria-label={scrollable ? labels.review : undefined}>
      {pending && sample && <div className="as-preview-pair" aria-hidden="true" inert>
        {sides.map(side => <figure key={side}>
          <figcaption>{labels[side]}</figcaption>
          {sample[side] ? <SlideCanvas slide={sample[side]} deck={{...deck, theme:proposal.themes?.[side] ?? deck.theme}}/>
            : <span>{labels.empty}</span>}
        </figure>)}
      </div>}
      {preview && <p className="as-change-excerpt" lang={preview.after && preview.key !== 'imageRole' ? deck.language : locale}>{preview.after || labels.clear}</p>}
      {showActionDetail && <p className="as-change-detail">{showActionDetail}</p>}
      {proposal.actions.length > 1 && <details className="as-change-disclosure">
        <summary>{labels.review}</summary>
        <ul className="as-change-actions">
          {proposal.actions.map((item, index) => <li key={index}><strong>{item.label}</strong>{item.detail && <p>{item.detail}</p>}</li>)}
        </ul>
      </details>}
      {proposal.order && <>
        {proposal.baseRevision !== undefined && <p className="as-change-context">{labels.version} {proposal.baseRevision}</p>}
        <CompareOrder order={proposal.order} labels={labels} language={deck.language} />
      </>}
      {hasComparison && <CompareSlides proposal={proposal} deck={deck} labels={labels} busy={busy} onDecision={onDecision}/>}
    </CardPanel>
    {!pending && <CardFooter className="as-change-footer">
        <p className="as-change-result" role="status">{applied && <CheckIcon aria-hidden size={15}/>} {result}</p>
        {applied && <Button size="sm" variant="ghost" disabled={busy || !canRestore} onClick={()=>onDecision('restore')}>
          {labels.restore}
        </Button>}
        {applied && !canRestore && <p className="as-change-context">{labels.newerEdits}</p>}
    </CardFooter>}
  </Card>;
}

export function PendingProposalBar({proposals, selected, locale, revision, busy, choose, decide}: {
  proposals: AssistantProposal[]; selected: AssistantProposal; locale: Locale; revision: number; busy: boolean;
  choose: (id: string) => void; decide: (id: string, action: AssistantDecision) => void;
}) {
  const t = copy[locale];
  const stale = selected.baseRevision !== undefined && selected.baseRevision !== revision;
  const title = (proposal: AssistantProposal) => proposal.changes?.[0]?.after?.title ||
    proposal.changes?.[0]?.before?.title || proposal.actions[0]?.label || t.changes;
  function reveal(id: string) {
    document.getElementById('assistant-proposal-' + id)?.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }
  return <section className="as-pending-bar" aria-label={t.pending}>
    {proposals.length > 1 ? <select className="as-pending-select" aria-label={t.pending} value={selected.id}
      onChange={event => { choose(event.target.value); reveal(event.target.value); }}>
      {proposals.map((proposal, index) => <option value={proposal.id} key={proposal.id}>{index + 1}. {title(proposal)}</option>)}
    </select> : <button type="button" className="as-pending-target" title={t.review} onClick={() => reveal(selected.id)}>
      <span>{title(selected)}</span><ArrowUpRightIcon aria-hidden size={13}/>
    </button>}
    {stale && <p role="status">{t.stale}</p>}
    <div className="as-pending-decisions">
      <Button type="button" size="sm" className="as-pending-apply" disabled={busy || stale} onClick={() => decide(selected.id, 'apply')}>{t.apply}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => decide(selected.id, 'dismiss')}>{t.dismiss}</Button>
    </div>
  </section>;
}
