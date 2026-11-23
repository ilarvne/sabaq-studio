import { effectiveFreeLayout, freeIds, hasFreePhotoBackground } from '@sabaq/lesson/free-layout';
import { DiagramGraphic, DiagramPage } from './Diagram';
import { Fragment, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { safeHref } from '@sabaq/lesson/rich-text';
import { displaySlide } from '@sabaq/lesson/typography';
export { documentRuns, safeHref } from '@sabaq/lesson/rich-text';
import type { JSONContent } from '@tiptap/core';
import { isSlideSymbol, slideImages, type Deck, type Layout, type Locale, type Slide, type SlideChart, type SlideTable } from '@sabaq/lesson/types';
import { slideCopy, lessonPartLabel } from './slide-copy';
import { lessonPalette, powerPointVisualStyle, templateFont } from '@sabaq/lesson/themes';
import './canvas.css';

export type TextSlot = 'title' | 'body';

export function slotDocument(slide: Slide, slot: TextSlot): JSONContent {
  const document = slide.richText?.[slot] as JSONContent | undefined;
  if (document?.type === 'doc') return document;
  if (
    slot === 'body' &&
    slide.bodyRuns?.length &&
    slide.bodyRuns.map((r) => r.text).join('') === slide.body
  ) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: slide.bodyRuns
            .filter((r) => r.text)
            .map((run) => ({
              type: 'text',
              text: run.text,
              marks: [
                ...(run.bold ? [{ type: 'bold' }] : []),
                ...(run.italic ? [{ type: 'italic' }] : []),
                ...(safeHref(run.href) ? [{ type: 'link', attrs: { href: safeHref(run.href) } }] : []),
              ],
            })),
        },
      ],
    };
  }
  return {
    type: 'doc',
    content: slide[slot]
      .split('\n')
      .map((text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })),
  };
}

function RichText({ node, interactiveLinks }: { node: JSONContent; interactiveLinks: boolean }) {
  const children = node.content?.map((child, i) => (
    <RichText key={i} node={child} interactiveLinks={interactiveLinks} />
  ));
  const align = node.attrs?.textAlign;
  const style = ['left', 'right', 'center', 'justify'].includes(align)
    ? ({ textAlign: align } as CSSProperties)
    : undefined;
  if (node.type === 'text') {
    let output: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') output = <strong>{output}</strong>;
      if (mark.type === 'italic') output = <em>{output}</em>;
      if (mark.type === 'link' && safeHref(mark.attrs?.href))
        output = interactiveLinks ? (
          <a href={safeHref(mark.attrs?.href)} target="_blank" rel="noreferrer">
            {output}
          </a>
        ) : (
          <span className="ed-render-link">{output}</span>
        );
    }
    return <>{output}</>;
  }
  if (node.type === 'paragraph' || node.type === 'heading')
    return (
      <span className="ed-text-line" style={style}>
        {children?.length ? children : <br />}
      </span>
    );
  if (node.type === 'bulletList') return <ul>{children}</ul>;
  if (node.type === 'orderedList') return <ol>{children}</ol>;
  if (node.type === 'listItem') return <li>{children}</li>;
  if (node.type === 'hardBreak') return <br />;
  return <Fragment>{children}</Fragment>;
}

function Chart({ chart, label, transcript }: { chart: SlideChart; label: string; transcript: boolean }) {
  const numbers = chart.series.flatMap((s) => s.values).filter(Number.isFinite);
  // The zero line is shared by all series, including datasets with negative values.
  const high = Math.max(0, ...numbers);
  const low = Math.min(0, ...numbers);
  const span = high - low || 1;
  const zero = ((0 - low) / span) * 100;
  return (
    <figure className="ed-slide-chart" role="group">
      {transcript && <div className="ed-chart-transcript" data-chart-transcript>
        <table aria-label={chart.alt || label}>
          <thead><tr><td/>{chart.series.map((entry, index) => <th scope="col" key={index}>{entry.name}</th>)}</tr></thead>
          <tbody>{chart.categories.map((category, index) => <tr key={index}><th scope="row">{category}</th>
            {chart.series.map((entry, series) => <td key={series}>{entry.values[index]}</td>)}</tr>)}</tbody>
        </table>
      </div>}
      <div className="ed-slide-plot" role="img" aria-label={chart.alt || label}>
        <i className="ed-zero-line" style={{ bottom: `${zero}%` }} />
        {chart.categories.map((category, i) => (
          <div className="ed-chart-group" key={i} title={category}>
            {chart.series.map((series, j) => {
              const value = series.values[i] ?? 0;
              return (
                <div className="ed-chart-column" key={j}>
                  <i
                    style={{
                      bottom: `${((Math.min(value, 0) - low) / span) * 100}%`,
                      height: `${(Math.abs(value) / span) * 100}%`,
                      opacity: Math.max(0.4, 1 - j * 0.22),
                    }}
                  />
                  <b style={{bottom:`${((Math.max(value, 0) - low) / span) * 100}%`}}>{value}</b>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="ed-chart-labels">
        {chart.categories.map((category, i) => (
          <span key={i}>{category}</span>
        ))}
      </div>
      {chart.series.length > 1 && (
        <figcaption>
          {chart.series.map((s, i) => (
            <span key={i}>{s.name}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

function DataTable({ table, label }: { table: SlideTable; label: string }) {
  return (
    <table className="ed-slide-table" aria-label={label}>
      <thead>
        <tr>
          {table.headers.map((v, i) => (
            <th key={i} scope="col">
              {v}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StoryPage({
  design,
  title,
  body,
  answer,
  image,
}: {
  design: NonNullable<Slide['design']>;
  title: ReactNode;
  body: ReactNode;
  answer: ReactNode;
  image: ReactNode;
}) {
  const numbered = design.numbered ?? (design.variant === 'activity' || design.variant === 'recap');
  const CardList = numbered ? 'ol' : 'ul';
  const cards = design.cards ?? [];
  return (
    <div className="ed-story-page" data-illustrated={Boolean(image)} data-card-count={cards.length}>
      <div className="ed-story-intro">
        {design.eyebrow && (
          <p className="ed-story-eyebrow" data-story-text>
            {design.eyebrow}
          </p>
        )}
        <div className="ed-slide-title" role="heading" aria-level={2} data-story-text>
          {title}
        </div>
        {body && (
          <div className="ed-slide-body" data-story-text>
            {body}
          </div>
        )}
      </div>
      {cards.length > 0 && (
        <CardList className="ed-story-cards" role="list">
          {cards.map((card, i) => (
            <li key={i} className="ed-story-card">
              {numbered && (
                <span className="ed-story-step" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <div>
                <strong className="ed-story-card-title" data-story-text>
                  {card.title}
                </strong>
                <p className="ed-story-card-text" data-story-text>
                  {card.text}
                </p>
              </div>
            </li>
          ))}
        </CardList>
      )}
      {(design.takeaway || answer) && (
        <div className="ed-story-end">
          {design.takeaway && (
            <p className="ed-story-takeaway" data-story-text>
              {design.takeaway}
            </p>
          )}
          {answer && (
            <div className="ed-slide-answer" data-story-text>
              {answer}
            </div>
          )}
        </div>
      )}
      {image && <figure className="ed-story-art">{image}</figure>}
    </div>
  );
}

export const alternateLayouts = ['stacked', 'split', 'centered'] as const satisfies readonly Layout[];

function SlideCards({design}: {design: Slide['design']}) {
  if (!design?.cards?.length) return null;
  const cards = design.cards;
  const numbered = design.numbered ?? (design.variant === 'activity' || design.variant === 'recap');
  const CardList = numbered ? 'ol' : 'ul';
  return <CardList className="ed-arranged-cards" style={{ '--card-columns': Math.min(3, cards.length) } as CSSProperties}>
    {cards.map((card, index) => <li key={index}>
      <strong data-story-text>{numbered && <span>{index + 1}. </span>}{card.title}</strong>
      <p data-story-text>{card.text}</p>
    </li>)}
  </CardList>;
}

function ArrangedPage({slide, language, lang, title, body, image, answer, includeChartData}: {
  slide: Slide; language: Locale; lang: Locale; title: ReactNode; body: ReactNode; image: ReactNode; answer: ReactNode; includeChartData: boolean;
}) {
  const { design, chart, table } = slide;
  const cards = design?.cards ?? [];
  const eyebrow = design ? design.eyebrow : slide.lessonPart && slide.lessonPart !== 'lesson' && lessonPartLabel(slide.lessonPart, language);
  const withDetails = Boolean(cards.length || image || chart || table);
  return <div className="ed-arranged-page" data-details={withDetails}>
    <div className="ed-arranged-copy">
      <div className="ed-arranged-heading">
        {eyebrow && <div className="ed-slide-kicker" data-story-text>{eyebrow}</div>}
        <div className="ed-slide-title" role="heading" aria-level={2} data-story-text>{title}</div>
      </div>
      {body && <div className="ed-slide-body" data-story-text>{body}</div>}
    </div>
    {withDetails && <div className="ed-arranged-details">
      <SlideCards design={design}/>
      {image && <div className="ed-slide-image-frame">{image}</div>}
      {chart && <Chart chart={chart} label={slideCopy[lang].chart} transcript={includeChartData} />}
      {table && <DataTable table={table} label={slideCopy[lang].table} />}
    </div>}
    {(design?.takeaway || answer) && <footer className="ed-arranged-end">
      {design?.takeaway && <p data-story-text>{design.takeaway}</p>}
      {answer && <div className="ed-slide-answer" data-story-text>{answer}</div>}
    </footer>}
  </div>;
}

function storyFits(page: HTMLElement) {
  const pageBounds = page.getBoundingClientRect();
  const details = page.querySelector<HTMLElement>('.ed-arranged-details');
  if (details) {
    const band = details.getBoundingClientRect();
    for (const child of details.children) {
      const box = child.getBoundingClientRect();
      if (box.height && (box.top < Math.max(band.top, pageBounds.top) - 1 || box.bottom > Math.min(band.bottom, pageBounds.bottom) + 1)) return false;
    }
  }
  const range = document.createRange();
  for (const region of page.querySelectorAll<HTMLElement>('[data-story-text], .ed-slide-table th, .ed-slide-table td, .ed-chart-labels span, .ed-chart-column b')) {
    const box = region.getBoundingClientRect();
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        if (
          rect.left < Math.max(pageBounds.left, box.left) - 1 ||
          rect.right > Math.min(pageBounds.right, box.right) + 1 ||
          rect.top < pageBounds.top - 1 ||
          rect.bottom > pageBounds.bottom + 1
        )
          return false;
      }
    }
  }
  return true;
}

function watchSlideSize(root: HTMLElement, fit: () => void, thumbnail: boolean) {
  let width = root.clientWidth;
  let height = root.clientHeight;
  fit();
  const observer = thumbnail && width ? undefined : new ResizeObserver(() => {
    if (root.clientWidth === width && root.clientHeight === height) return;
    width = root.clientWidth;
    height = root.clientHeight;
    fit();
    if (thumbnail && width) observer?.disconnect();
  });
  observer?.observe(root);
  let active = true;
  if (document.fonts?.status === 'loading') document.fonts.ready.then(() => { if (active) fit(); });
  return () => { active = false; observer?.disconnect(); };
}

export interface SlideCanvasProps {
  slide: Slide;
  deck: Pick<Deck, 'language' | 'theme' | 'brand' | 'powerPointStyle'>;
  lang?: Locale;
  revealAnswer?: boolean;
  includeChartData?: boolean;
  thumbnail?: boolean;
  className?: string;
  onOverflowChange?: (overflows: boolean) => void;
  renderSlot?: (slot: TextSlot, readonlyContent: ReactNode) => ReactNode;
}

export function SlideCanvas({
  slide: originalSlide,
  deck,
  lang = deck.language,
  revealAnswer = true,
  includeChartData = false,
  thumbnail = false,
  className = '',
  renderSlot,
  onOverflowChange,
}: SlideCanvasProps) {
  const slide=useMemo(()=>displaySlide(originalSlide, deck.language),[originalSlide,deck.language]);
  const c = slideCopy[lang];
  const isReady = slide.status === 'ready';
  const preset = lessonPalette(deck,slide.powerPointLayoutId);
  const importedStyle=powerPointVisualStyle(deck.powerPointStyle,slide.powerPointLayoutId);
  const canvas = useRef<HTMLElement>(null);
  // Server acknowledgements replace nested objects even when their displayed content is identical.
  const fitContent = useMemo(() => JSON.stringify([
    slide.richText, slide.bodyRuns, slide.design, slide.image, slide.additionalImages, slide.chart, slide.table, slide.diagram, slide.freeLayout,
  ]), [slide.richText, slide.bodyRuns, slide.design, slide.image, slide.additionalImages, slide.chart, slide.table, slide.diagram, slide.freeLayout]);
  useLayoutEffect(() => {
    const root = canvas.current;
    const free = root?.querySelector<HTMLElement>('.ed-free-page');
    if (root && free) return watchSlideSize(root,()=>{
      if(!root.clientWidth) return;
      let overflow=false;
      for(const item of free.querySelectorAll<HTMLElement>('.ed-free-element, .ed-diagram-node')) {
        const prop=item.classList.contains('ed-diagram-node') ? '--node-scale' : '--ed-fit';
        for(let step=20;step>=6;step--) {
          item.style.setProperty(prop,String(step/20));
          if(item.scrollWidth<=item.clientWidth+1 && item.scrollHeight<=item.clientHeight+1) break;
          if(step===6) overflow=true;
        }
      }
      root.dataset.overflow=String(overflow);
      onOverflowChange?.(overflow);
    }, thumbnail);
    const diagram = root?.querySelector<HTMLElement>('.ed-diagram-page');
    if (root && diagram) return watchSlideSize(root, () => {
      if (!root.clientWidth) return;
      const header=diagram.querySelector<HTMLElement>('.ed-diagram-header')!;
      function fit(element:HTMLElement, property:string) {
        for (let step=20;step>=4;step--) {
          element.style.setProperty(property,String(step/20));
          if (element.scrollHeight>element.clientHeight+1 || element.scrollWidth>element.clientWidth+1) continue;
          const label=element.querySelector('.ed-diagram-label');
          if (!label) return true;
          if (label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1) continue;
          const text=label.getBoundingClientRect(), box=element.getBoundingClientRect();
          if (text.left>=box.left-1 && text.top>=box.top-1 && text.right<=box.right+1 && text.bottom<=box.bottom+1) return true;
        }
        return false;
      }
      let fits=fit(header,'--diagram-scale');
      for (const node of diagram.querySelectorAll<HTMLElement>('.ed-diagram-node')) {
        if (!fit(node,'--node-scale')) fits=false;
      }
      root.dataset.overflow=String(!fits);
      onOverflowChange?.(!fits);
    }, thumbnail);
    const column = root?.querySelector<HTMLElement>('.ed-slide-copy-column');
    const storyPage = root?.querySelector<HTMLElement>('.ed-story-page, .ed-arranged-page');
    if (root && storyPage) {
      const fit = () => {
        if (!root.clientWidth) return;
        let overflow = false;
        for (const scale of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58]) {
          storyPage.style.setProperty('--ed-fit', String(scale));
          overflow = !storyFits(storyPage);
          if (!overflow) break;
        }
        root.dataset.overflow = String(overflow);
        onOverflowChange?.(overflow);
      };
      return watchSlideSize(root, fit, thumbnail);
    }
    const inner = root?.querySelector<HTMLElement>('.ed-slide-inner');
    if (!root || !inner || !column) {
      onOverflowChange?.(false);
      return;
    }
    const measure = () => {
      if (!root.clientWidth) return;
      const padding = (node: HTMLElement) => {
        const style = getComputedStyle(node);
        return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      };
      const scale = inner.getBoundingClientRect().height / (inner.offsetHeight || 1);
      const room = (inner.clientHeight - padding(inner) - padding(column)) * scale;
      const style = getComputedStyle(column);
      const columnBounds = column.getBoundingClientRect();
      const left = columnBounds.left + parseFloat(style.paddingLeft) * scale;
      const right = columnBounds.right - parseFloat(style.paddingRight) * scale;
      const fitsWidth = () => {
        const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        while (walker.nextNode()) {
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects())
            if (rect.width && (rect.right > right + 1 || rect.left < left - 1)) return false;
        }
        return true;
      };
      const occupied = () => {
        const children = Array.from(column.children).map((child) => child.getBoundingClientRect());
        return children.length ? children.at(-1)!.bottom - children[0].top : 0;
      };
      let overflow = false;
      for (const size of [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52]) {
        inner.style.setProperty('--ed-fit', String(size));
        overflow = occupied() > room + 1 || !fitsWidth();
        if (!overflow) break;
      }
      root.dataset.overflow = String(overflow);
      onOverflowChange?.(overflow);
    };
    return watchSlideSize(root, measure, thumbnail);
  }, [isReady, slide.title, slide.body, slide.answer, slide.layout, slide.lessonPart, fitContent,
    deck.theme, deck.brand?.font, deck.powerPointStyle, slide.powerPointLayoutId, deck.language, revealAnswer, thumbnail, onOverflowChange]);

  const text = (slot: TextSlot) => {
    const rich = <RichText node={slotDocument(slide, slot)} interactiveLinks={!renderSlot} />;
    return renderSlot ? renderSlot(slot, rich) : rich;
  };
  const images = slideImages(slide);
  const media = Boolean(images.length || slide.table || slide.chart);
  const pictures = images.map((asset, index) => (
    <img
      key={index}
      className="ed-slide-image"
      style={asset.crop || isSlideSymbol(asset) ? {objectFit:'contain'} : undefined}
      src={asset.src}
      alt={asset.decorative ? '' : asset.alt}
      draggable={false}
    />
  ));
  const image = pictures.length > 1 ? <div className="ed-slide-image-grid" style={{'--image-count':pictures.length} as CSSProperties}>
    {pictures}
  </div> : pictures[0] ?? null;
  const neutralDesign = slide.design?.variant ? undefined : slide.design;
  const nativeData = (slide.layout==='native-table' && slide.table) || (slide.layout==='data-chart' && slide.chart);
  const arranged = Boolean(nativeData) || ['image-grid','image-section'].includes(slide.layout) || pictures.length>1 || alternateLayouts.some((layout) => layout === slide.layout) ||
    Boolean(slide.design?.variant && (slide.chart || slide.table)) ||
    Boolean(neutralDesign && slide.layout === 'body' && neutralDesign.cards?.length && !media);
  const freeLayout = slide.freeLayout && effectiveFreeLayout(slide);
  const answer = slide.answer && revealAnswer ? <><strong>{slideCopy[deck.language].answer}</strong> {slide.answer}</> : null;
  const titleSize =
    slide.title.length > 100
      ? 4.3
      : slide.title.length > 65
        ? 5.05
        : slide.title.length > 36
          ? 5.4
          : slide.layout === 'cover' && media
            ? 5.45
            : 6.3;
  const bodySize = slide.body.length > 450 ? 2.05 : slide.body.length > 250 ? 2.35 : 2.65;
  return (
    <article
      ref={canvas}
      lang={deck.language}
      className={`ed-slide${slide.design?.variant ? ' ed-story' : ''} ${className}`}
      data-story={slide.design?.variant}
      data-story-theme={deck.brand || deck.powerPointStyle ? 'deck' : slide.design?.theme}
      data-layout={slide.layout}
      data-theme={deck.theme}
      data-brand={deck.brand || deck.powerPointStyle ? true : undefined}
      data-powerpoint-style={deck.powerPointStyle ? true : undefined}
      data-slide-id={slide.id}
      data-has-media={media ? 'true' : 'false'}
      data-cover-art={
        slide.layout === 'cover' && !media && slide.title.length <= 64 && slide.body.length <= 135
          ? 'true'
          : undefined
      }
      aria-label={slide.title || c.slide}
      style={
        {
          '--ed-slide-title': `${titleSize}cqw`,
          '--ed-slide-body': `${bodySize}cqw`,
          '--preset-paper': preset.paper,
          '--preset-ink': preset.ink,
          '--preset-accent': preset.accent,
          '--preset-tint': preset.tint,
          '--preset-heading':
            preset.heading === 'serif'
              ? 'var(--font-reading, Georgia, serif)'
              : 'var(--font-slide, sans-serif)',
          ...(deck.brand && {'--ed-paper':preset.paper,'--ed-ink':preset.ink,'--ed-accent':preset.accent,'--ed-tint':preset.tint,
            '--font-slide':deck.brand.font,'--font-reading':deck.brand.font,'--font-ui':deck.brand.font,'--preset-heading':deck.brand.font}),
          ...(importedStyle && {'--ed-paper':preset.paper,'--ed-ink':preset.ink,'--ed-accent':preset.accent,'--ed-tint':preset.tint,
            '--font-slide':JSON.stringify(templateFont(importedStyle.bodyFont,'canvas'))+', sans-serif',
            '--font-reading':JSON.stringify(templateFont(importedStyle.bodyFont,'canvas'))+', sans-serif',
            '--font-ui':JSON.stringify(templateFont(importedStyle.bodyFont,'canvas'))+', sans-serif',
            '--preset-heading':JSON.stringify(templateFont(importedStyle.headingFont,'canvas'))+', sans-serif'}),

        } as CSSProperties
      }
    >
      {isReady && slide.importedArtwork && <img className="ed-imported-artwork" src={slide.importedArtwork} alt="" draggable={false}/>}
      {isReady && deck.brand?.logo && <img className="ed-brand-logo" src={deck.brand.logo} alt="" draggable={false}/>}
      {isReady && freeLayout ? <div className="ed-free-page" data-photo-backdrop={hasFreePhotoBackground(slide,freeLayout) || undefined}>
        {freeLayout.items.map((item,z)=>({...item,z})).sort((a,b)=>freeIds.indexOf(a.id)-freeIds.indexOf(b.id)).map(item=>{
          const {id,x,y,w,h,rotation}=item;
          let content:ReactNode;
          switch(id) {
            case 'title': content=<div className="ed-slide-title" role="heading" aria-level={2}>{text('title')}</div>;break;
            case 'body': content=(slide.body || renderSlot) && <div className="ed-slide-body">{text('body')}</div>;break;
            case 'image': content=image;break;
            case 'table': content=slide.table && <DataTable table={slide.table} label={c.table}/>;break;
            case 'chart': content=slide.chart && <Chart chart={slide.chart} label={c.chart} transcript={includeChartData}/>;break;
            case 'diagram': content=slide.diagram && <DiagramGraphic diagram={slide.diagram} language={deck.language}/>;break;
            case 'eyebrow': content=<div data-story-text className="ed-slide-kicker">{slide.design?.eyebrow || lessonPartLabel(slide.lessonPart,deck.language)}</div>;break;
            case 'answer': content=answer && <div className="ed-slide-answer">{answer}</div>;break;
            case 'takeaway': content=<p data-story-text>{slide.design?.takeaway}</p>;break;
            default: {
              const index=Number(id.slice(-1));
              const card=slide.design?.cards?.[index];
              content=card && <div className="ed-free-card"><strong data-story-text>{(slide.design?.numbered ?? (slide.design?.variant==='activity' || slide.design?.variant==='recap')) && (index+1)+'. '}{card.title}</strong><p data-story-text>{card.text}</p></div>;
            }
          }
          return content ? <div key={id} className="ed-free-element" data-free-id={id}
            style={{left:x+'%',top:y+'%',width:w+'%',height:h+'%',zIndex:item.z,transform:'rotate('+rotation+'deg)'}}>{content}</div> : null;
        })}
      </div> : isReady && slide.importedPage && slide.layout === 'image-full' && image ? (
        <div className="ed-imported-page">{image}</div>
      ) : isReady && slide.diagram ? (
        <DiagramPage diagram={slide.diagram} language={deck.language} title={text('title')}
          eyebrow={neutralDesign?.eyebrow}
          body={neutralDesign?.cards?.length || neutralDesign?.takeaway ? <>
            {text('body')}<SlideCards design={neutralDesign}/>{neutralDesign.takeaway && <p className="ed-native-takeaway">{neutralDesign.takeaway}</p>}
          </> : slide.body || renderSlot ? text('body') : null} answer={answer}/>
      ) : isReady && arranged ? (
        <ArrangedPage includeChartData={includeChartData} slide={slide} language={deck.language} lang={lang} title={text('title')}
          body={slide.body || renderSlot ? text('body') : null} image={image} answer={answer} />
      ) : isReady && slide.design?.variant ? (
        <StoryPage
          design={slide.design}
          title={text('title')}
          body={slide.body || renderSlot ? text('body') : null}
          answer={answer}
          image={image}
        />
      ) : isReady ? (
        <div className="ed-slide-inner">
          {slide.layout === 'image-full' && image && <div className="ed-slide-background">{image}</div>}
          <div className="ed-slide-copy-column">
            {neutralDesign?.eyebrow ? <div className="ed-slide-kicker">{neutralDesign.eyebrow}</div> :
              slide.lessonPart && slide.lessonPart !== 'lesson' && <div className="ed-slide-kicker">{lessonPartLabel(slide.lessonPart, deck.language)}</div>}
            <div role="heading" aria-level={2} className="ed-slide-title">
              {text('title')}
            </div>
            {(slide.body || renderSlot) && <div className="ed-slide-body">{text('body')}</div>}
            <SlideCards design={neutralDesign}/>
            {neutralDesign?.takeaway && <p className="ed-native-takeaway">{neutralDesign.takeaway}</p>}
            {slide.answer && revealAnswer && (
              <div className="ed-slide-answer">
                <strong>{slideCopy[deck.language].answer}</strong> {slide.answer}
              </div>
            )}
          </div>
          {media && !(slide.layout === 'image-full' && !slide.chart && !slide.table) && (
            <div className="ed-slide-media">
              {slide.chart && <Chart chart={slide.chart} label={c.chart} transcript={includeChartData} />}
              {slide.table && <DataTable table={slide.table} label={c.table} />}
              {slide.layout !== 'image-full' && image && (
                <div className="ed-slide-image-frame">{image}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="ed-slide-placeholder">
          <div className="ed-placeholder-block" />
          <div className="ed-placeholder-line" />
          <div className="ed-placeholder-line" />
          <p>
            {slide.status === 'failed'
              ? c.errorText
              : slide.status === 'cancelled'
                ? c.cancelledText
                : c.pendingText}
          </p>
        </div>
      )}
    </article>
  );
}
