import type { CreateInput, Deck, OutlineItem, Slide, SlideImage } from '@sabaq/lesson/types';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import { generateLocal } from './local-generation';
import { generateSlide, type LessonSlideDraft } from './alem';
import { allowsOpenAIImages, hasLessonImageProvider, resolveSlideIllustration } from '../media/visuals';
import { outlineIllustration, requestedImageMode } from './image-mode';

export async function composeLessonSlide(
  deck: Deck,
  item: OutlineItem,
  index: number,
  options: { signal: AbortSignal; mediaRoot: string; preferences?: CreateInput['answers'] },
): Promise<Partial<Slide>> {
  const mode = requestedImageMode(deck.imageMode, options.preferences);
  const allowIllustration = deck.imageSource !== 'own' && deck.imageSource !== 'none' && mode !== 'none' &&
    (mode !== 'auto' || deck.slides.filter(slide => slide.id !== item.id && slide.image).length < 5);
  const allowOpenAI = allowsOpenAIImages(deck);
  const canGenerate = allowIllustration && hasLessonImageProvider(deck);
  const draft = await generateSlide(
    deck, item, index, options.signal, options.preferences, allowIllustration,
    canGenerate, deck.provider === 'local' ? generateLocal : undefined,
  );
  const suggested = allowIllustration && !draft.table && !draft.chart && !draft.diagram ? draft.illustration : undefined;
  const used = suggested?.asset && deck.slides.some(({ image }) =>
    image?.provenance?.source === 'catalog' && image.provenance.asset === suggested.asset,
  );
  const request = suggested?.asset && !used ? suggested : canGenerate ? { ...suggested, asset: undefined } : undefined;
  const fallback = canGenerate && !draft.table && !draft.chart && !draft.diagram && (!request || (!request.asset && !request.prompt));
  const illustration = await resolveSlideIllustration(
    fallback ? outlineIllustration(item) : request,
    { language: deck.language, topic:deck.topic+' — '+item.title, signal: options.signal, mediaRoot: options.mediaRoot, allowOpenAI, ...lessonImageGuidance(deck) },
  );
  return composeDraft(item,draft,illustration);
}

export function composeDraft(item:OutlineItem,draft:LessonSlideDraft,illustration?:SlideImage):Partial<Slide> {
  const { title, body, notes, eyebrow, takeaway, cards, numbered, answer, table, chart, diagram } = draft;
  const design = eyebrow || takeaway || cards?.length ? {
    theme: 'deck' as const, eyebrow, takeaway, cards,
    ...(cards?.length && numbered && { numbered:true }),
  } : undefined;
  const slide = { title, body, notes, ...(answer && {answer}), ...(design && {design}) };
  if (table) return { ...slide, layout:'native-table', table };
  if (chart) return { ...slide, layout:'data-chart', chart };
  if (diagram) return { ...slide, layout:item.layout, diagram };

  const needsImage = item.layout.startsWith('image-') || item.layout === 'avatar-right';
  const needsData = item.layout === 'native-table' || item.layout === 'data-chart';
  const layout = (needsImage && !illustration) || needsData ? 'body' : item.layout;

  return { ...slide, layout, ...(illustration && { image:illustration }) };
}
