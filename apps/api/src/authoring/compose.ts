import type { CreateInput, Deck, OutlineItem, Slide, SlideImage } from '@sabaq/lesson/types';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import { generateLocal } from './local-generation';
import { generateSlide, type LessonSlideDraft } from './generate-slide';
import { allowsOpenAIImages, hasLessonImageProvider, resolveSlideIllustration } from '../media/visuals';
import { eligibleForIllustration, outlineIllustration, requestedImageMode } from './image-mode';
import { fitGeneratedLayout, isImageLayout } from './layout-planner';

export async function composeLessonSlide(
  deck: Deck,
  item: OutlineItem,
  index: number,
  options: { signal: AbortSignal; mediaRoot: string; preferences?: CreateInput['answers'] },
): Promise<Partial<Slide>> {
  const mode = requestedImageMode(deck.imageMode, options.preferences);
  const wantsArt = isImageLayout(item.layout) || !!item.visualDescription;
  const gallery = item.layout === 'image-grid' && !!item.imageScenes?.length;
  const allowIllustration = deck.imageSource !== 'own' && deck.imageSource !== 'none' && mode !== 'none' &&
    eligibleForIllustration(item) && !gallery &&
    (mode === 'auto' ? deck.slides.filter(slide => slide.id !== item.id && slide.image).length < 5 : wantsArt);
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
  const fallback = canGenerate && wantsArt && !draft.table && !draft.chart && !draft.diagram && (!request || (!request.asset && !request.prompt));
  const illustration = await resolveSlideIllustration(
    fallback ? outlineIllustration(item) : request,
    { language: deck.language, topic:deck.topic+' — '+item.title, signal: options.signal, mediaRoot: options.mediaRoot, allowOpenAI, ...lessonImageGuidance(deck) },
  );
  return composeDraft(item,draft,illustration);
}

export function composeDraft(item:OutlineItem,draft:LessonSlideDraft,illustration?:SlideImage):Partial<Slide> {
  const { title, body, notes, eyebrow, takeaway, cards, numbered, answer, table, chart, diagram } = draft;
  const layout = fitGeneratedLayout(item.layout, { title, body, chart, table, diagram, image:illustration });
  const hasPrimaryVisual = Boolean(table || chart || diagram || illustration);
  const projectedCards = hasPrimaryVisual ? undefined : cards;
  const design = eyebrow || takeaway || projectedCards?.length ? {
    theme: 'deck' as const, eyebrow, takeaway, cards:projectedCards,
    ...(projectedCards?.length && numbered && { numbered:true }),
  } : undefined;
  const lectureNotes = hasPrimaryVisual && cards?.length ? [notes, ...cards.map(card => `${card.title}\n${card.text}`)].join('\n\n') : notes;
  const slide = { title, body, notes:lectureNotes, ...(answer && {answer}), ...(design && {design}) };
  if (layout === 'native-table' && table) return { ...slide, layout, table };
  if (layout === 'data-chart' && chart) return { ...slide, layout, chart };
  if (diagram) return { ...slide, layout, diagram };
  return { ...slide, layout, ...(illustration && { image:illustration }) };
}
