import { useEffect, useRef, useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import type { Deck, Layout, Locale, Slide } from '@sabaq/lesson/types';
import { alternateLayouts, SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Button } from '@/components/shadcn/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import './slide-layout-picker.css';

export const layoutPickerCopy = {
  en: {
    title: 'Other layouts', original: 'Original design', all: 'All layouts',
    suggested: 'Suggested layouts', reset: 'Choosing a layout resets custom placement.',
  },
  ru: {
    title: 'Другие макеты', original: 'Исходный макет', all: 'Все макеты',
    suggested: 'Рекомендуемые макеты', reset: 'Выбор макета сбросит ручное расположение элементов.',
  },
  kk: {
    title: 'Басқа макеттер', original: 'Бастапқы макет', all: 'Барлық макет',
    suggested: 'Ұсынылған макеттер', reset: 'Макет таңдалса, элементтердің қолмен берілген орны қалпына келеді.',
  },
};

type Props = {
  deck: Deck;
  slide: Slide;
  locale: Locale;
  recommended: Layout[];
  layouts: Layout[];
  label: (layout: Layout) => string;
  closeLabel: string;
  onLayout: (layout: Layout) => void;
  onClose: () => void;
};

export function SlideLayoutPicker({
  deck, slide, locale, recommended, layouts, label, closeLabel, onLayout, onClose,
}: Props) {
  const copy = layoutPickerCopy[locale];
  const [showAll, setShowAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const current = slide.freeLayout ? undefined : slide.layout;
  const available = showAll ? layouts : recommended;
  const hasMore = layouts.some(layout => !recommended.includes(layout));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = list.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')
        ?? list.current?.querySelector<HTMLButtonElement>('button');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return <div className="ed-layout-gallery" data-editor-motion="layout"
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    <header className="ed-layout-header">
      <h3>{copy.title}</h3>
      <div className="ed-layout-controls">
        {hasMore && <Button type="button" size="sm" variant="ghost" aria-controls="editor-layout-gallery"
          aria-expanded={showAll} onClick={() => {
            setShowAll(!showAll);
            if (list.current) list.current.scrollLeft = 0;
          }}>
          {showAll ? copy.suggested : copy.all}
        </Button>}
        <Button type="button" size="icon-sm" variant="ghost" aria-label={closeLabel} onClick={onClose}><XIcon /></Button>
      </div>
    </header>
    {slide.freeLayout && <p className="ed-layout-hint">{copy.reset}</p>}
    <section id="editor-layout-gallery" aria-label={copy.title}>
      <ToggleGroup ref={list} className="ed-layout-options" spacing={1} aria-label={copy.title} value={current ? [current] : []}
        onValueChange={values => {
          const selected = available.find(layout => layout === values[0]);
          if (selected) onLayout(selected);
        }}>
        {available.map(layout => <div key={layout} className="ed-layout-option" data-current={layout === current}>
          <div className="ed-layout-mini" inert aria-hidden="true">
            <SlideCanvas slide={{ ...slide, layout, freeLayout: undefined }} deck={deck} lang={locale} revealAnswer={false} />
          </div>
          <span className="ed-layout-caption" aria-hidden="true">{label(layout)}</span>
          {layout === current && <span className="ed-layout-selected" aria-hidden="true"><CheckIcon weight="bold" /></span>}
          <ToggleGroupItem className="ed-layout-hit" value={layout} aria-label={label(layout)} title={label(layout)} />
        </div>)}
      </ToggleGroup>
    </section>
  </div>;
}

export function layoutChoices(slide: Slide, initialLayout: Layout) {
  if (slide.diagram) {
    const layouts:Layout[]=['body','cover','quote',...alternateLayouts];
    return {all:layouts,gallery:layouts};
  }
  if (slide.additionalImages?.length) {
    const layouts:Layout[]=['image-grid',...alternateLayouts];
    return {all:[...new Set([slide.layout,...layouts])],gallery:layouts};
  }
  const original: Layout = slide.design?.variant === 'opening' ? 'cover' : slide.image ? 'image-right' : 'body';
  const isAlternate = (value: Layout) => alternateLayouts.some((layout) => layout === value);
  const originalStory = !isAlternate(initialLayout) ? initialLayout : original;
  const ordinary: Layout[] = ['cover', 'body', 'quote'];
  const banner:Layout[] = slide.image && !slide.chart && !slide.table ? ['image-section'] : [];
  if (slide.image) ordinary.push('image-left', 'image-right', 'image-full',...banner);
  if (slide.chart) ordinary.push('data-chart');
  if (slide.table) ordinary.push('native-table');
  ordinary.push('avatar-right');
  let bases: Layout[];
  if (slide.design?.variant) bases = [originalStory,...banner];
  else if (slide.chart || slide.table) bases = [...(slide.chart ? ['data-chart' as const] : []), ...(slide.table ? ['native-table' as const] : [])];
  else if (slide.image) bases = [initialLayout === 'cover' ? 'cover' : 'image-right', 'image-full',...banner];
  else bases = ['body', 'cover', 'quote'];
  if (!isAlternate(slide.layout) && !bases.includes(slide.layout)) bases = [slide.layout, ...bases].slice(0,3);
  return {
    all: [...new Set<Layout>([slide.layout, ...(slide.design?.variant ? [originalStory,...banner] : ordinary), ...alternateLayouts])],
    gallery: [...new Set<Layout>([...bases, ...alternateLayouts])].slice(0,6),
  };
}
