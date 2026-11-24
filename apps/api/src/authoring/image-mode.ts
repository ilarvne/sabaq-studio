import sharp from 'sharp';
import { illustrationDescriptions } from '@sabaq/contracts/illustrations';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import { lessonPalette } from '@sabaq/lesson/themes';
import type { CreateInput, Deck, ImageMode, Layout, OutlineItem, Slide, SlideImage } from '@sabaq/lesson/types';
import { allowsOpenAIImages, hasLessonImageProvider, resolveSlideIllustration, storeImage } from '../media/visuals';
import { fitGeneratedLayout, fitsFullBleedCopy, isImageLayout } from './layout-planner';

export function requestedImageMode(mode?: ImageMode, legacy?: CreateInput['answers']): ImageMode {
  if (legacy?.imageSource === 'none') return 'none';
  if (mode) return mode;
  if (legacy?.image === 'none') return 'none';
  return legacy?.image === 'illustrations' ? 'illustrated' : 'auto';
}

export function outlineIllustration(item: Pick<OutlineItem, 'title'|'summary'|'visualDescription'>) {
  const description=item.visualDescription?.trim();
  return { prompt:description || `${item.title}. ${item.summary}`.slice(0,400), alt:description || item.title.slice(0,400) };
}

export function eligibleForIllustration(item: OutlineItem) {
  return !item.diagramKind && item.layout !== 'data-chart' && item.layout !== 'native-table';
}

function sectionStarts(items: OutlineItem[], index: number) {
  const item = items[index];
  return index > 0 && Boolean(item.section && item.section !== items[index - 1].section);
}

export function planIllustratedOutline(items: OutlineItem[], mode: 'illustrated' | 'image-led') {
  const candidates = items.flatMap((item,index) => eligibleForIllustration(item) &&
    (!item.assessment || isImageLayout(item.layout)) ? [index] : []);
  const planned = new Set(candidates.filter(index =>
    index === 0 || isImageLayout(items[index].layout) || Boolean(items[index].visualDescription)));
  const target = Math.min(5, candidates.length);
  // Fill the illustration budget with section starts and visual examples first.
  const unplanned = candidates.filter(index => !planned.has(index));
  const priorities = [...unplanned.filter(index => sectionStarts(items,index)),
    ...unplanned.filter(index => !sectionStarts(items,index) && items[index].role === 'examples'),
    ...unplanned.filter(index => !sectionStarts(items,index) && items[index].role !== 'examples')];
  for (const index of priorities) {
    if (planned.size >= target) break;
    planned.add(index);
  }
  const compact = candidates.filter(index => planned.has(index) && items[index].layout !== 'image-grid' &&
    fitsFullBleedCopy(items[index].title,items[index].summary));
  const fullBleed = mode === 'image-led' && !items.some(item => item.layout === 'image-full')
    ? compact.find(index => sectionStarts(items,index)) ?? compact[0]
    : undefined;
  let nextSide: 'image-left'|'image-right' = 'image-right';
  return items.map((item,index) => {
    if (!planned.has(index)) return item;
    let layout: Layout;
    if (item.layout === 'image-grid' && item.imageScenes?.length) layout = item.layout;
    else if (item.layout === 'image-full' && fitsFullBleedCopy(item.title,item.summary)) layout = item.layout;
    else if (index === fullBleed && fitsFullBleedCopy(item.title,item.summary)) layout = 'image-full';
    else if (index === 0 && item.layout === 'cover') layout = 'cover';
    else if (item.layout === 'image-section' || sectionStarts(items,index)) layout = 'image-section';
    else if (item.layout === 'image-left' || item.layout === 'image-right') layout = item.layout;
    else { layout = nextSide; nextSide = nextSide === 'image-right' ? 'image-left' : 'image-right'; }
    return { ...item, layout };
  });
}

const subjects: [keyof typeof illustrationDescriptions, RegExp][] = [
  ['water-lab', /water volume|measuring (?:liquids|water)|объ[её]м воды|мерн\S* цилиндр|су көлем|су мөлшер/iu],
  ['seedling-growth', /seedling|plant growth|photosynthesis|bean plant|фотосинтез|рост растен|прораст|өсімдік|үрмебұршақ/iu],
  ['kindness-notebooks', /kindness|helping a classmate|доброта|взаимопомощь|мейірім|қайырым/iu],
  ['kindness-schoolyard', /kindness|schoolyard friendship|доброта|дружба|мейірім|достық/iu],
];

function catalogScene(deck: Deck, item: OutlineItem): SlideImage | undefined {
  const text = [item.title, item.summary, deck.topic].join(' ');
  const scene = subjects.find(([asset, subject]) => subject.test(text)
    && !deck.slides.some(slide => slide.id !== item.id && slide.image?.src === '/assets/' + asset + '.webp'));
  if (!scene) return;
  const [asset] = scene;
  return { src: '/assets/' + asset + '.webp', alt: illustrationDescriptions[asset][deck.language], provenance: { source: 'catalog', asset } };
}

// Offline art is decorative. It carries no claims about the subject or the supplied source.
async function decorativeImage(deck: Deck, index: number, mediaRoot: string, signal: AbortSignal): Promise<SlideImage> {
  const { ink, paper, accent, tint } = lessonPalette(deck);
  const center = 580 + (index * 67) % 310;
  const radius = 130 + (index * 41) % 120;
  const rings = Array.from({ length: 11 }, (_, band) => {
    const r = radius + 18 * band;
    return '<circle cx="' + center + '" cy="375" r="' + r + '" />';
  }).join('');
  const waves = Array.from({ length: 16 }, (_, line) =>
    '<path d="M-40 ' + (520 + line * 15) + 'Q460 -100 805 280T1470 85" />',
  ).join('');
  const foldedPaper = '<path fill="' + accent + '" d="m120 680 530-555 225 460z"/>'
    + '<path fill="' + ink + '" d="m650 125 365 145-140 315z"/>'
    + '<path fill="' + paper + '" d="m1015 270 142 380-282-65z"/>';
  const art = [
    '<circle cx="' + center + '" cy="375" r="' + (radius - 14) + '" fill="' + accent + '"/>'
      + '<g fill="none" stroke="' + ink + '" stroke-opacity=".65" stroke-width="2.5">' + rings + '</g>',
    '<circle fill="' + accent + '" cx="' + center + '" cy="320" r="194"/>'
      + '<g fill="none" stroke="' + ink + '" stroke-width="4">' + waves + '</g>',
    '<g transform="translate(' + (index * 13 % 170) + ' 0)">' + foldedPaper + '</g>',
  ];
  const composition = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">'
    + '<rect width="1280" height="720" fill="' + tint + '"/>'
    + '<path d="M-160 720 720 -160h340L180 720Z" fill="' + paper + '"/>'
    + art[index % art.length] + '</svg>';
  signal.throwIfAborted();
  const png = await sharp(Buffer.from(composition)).png().toBuffer();
  return { src: await storeImage(png, mediaRoot, signal), alt: '', decorative: true, provenance: { source: 'generated' } };
}

export async function applyImageMode(
  deck: Deck, item: OutlineItem, index: number, slide: Partial<Slide>, mode: ImageMode, mediaRoot: string, signal: AbortSignal,
): Promise<Partial<Slide>> {
  if (mode === 'none' || deck.imageSource === 'none' || deck.imageSource === 'own' && (!deck.ownIllustration || index !== 0)) {
    const layout = slide.layout ?? item.layout;
    return { ...slide, image: undefined, additionalImages:undefined, ...(isImageLayout(layout) && { layout: 'body' }) };
  }
  if (slide.diagram || slide.chart || slide.table || slide.importedPage || !eligibleForIllustration(item)) return slide;
  if (deck.imageSource === 'own') {
    return {...slide,image:deck.ownIllustration,additionalImages:undefined,layout:'cover',design:undefined};
  }
  const guidance = lessonImageGuidance(deck);
  const canGenerate = hasLessonImageProvider(deck);
  const context = {language:deck.language,topic:deck.topic+' — '+item.title,signal,mediaRoot,
    allowOpenAI:allowsOpenAIImages(deck),...guidance};
  let image=slide.image;
  let additionalImages = slide.additionalImages;
  const wantsArt = isImageLayout(item.layout) || Boolean(item.visualDescription);
  const imageBudget = mode !== 'auto' || deck.slides.filter(candidate=>candidate.id!==item.id && candidate.image).length < 5;
  if (canGenerate && imageBudget && item.layout === 'image-grid' && item.imageScenes?.length && !additionalImages?.length) {
    const generated = await Promise.all(item.imageScenes.slice(0,3).map(scene => resolveSlideIllustration({
      prompt:[scene,item.visualDescription].filter(Boolean).join('. '),alt:scene,
    },context)));
    const distinct = [...new Map(generated.flatMap(art => art ? [[art.src,art] as const] : [])).values()];
    if (distinct.length) [image,...additionalImages] = distinct;
  }
  // The text composer already resolves its own art request. Fixture and grounded
  // drafting use the approved descriptions directly when a permitted provider exists.
  const fallbackDraft = deck.provider==='fixture' || Boolean(deck.source);
  const needsOutlineArt = !image && fallbackDraft && imageBudget && (wantsArt || mode === 'auto');
  if (needsOutlineArt && canGenerate) image=await resolveSlideIllustration(outlineIllustration(item),context);
  if (!image && mode !== 'auto' && wantsArt && (!deck.imageStyle || deck.imageStyle==='illustration')) {
    image=guidance.avoidCatalog ? undefined : catalogScene(deck,item);
    if (!image && deck.provider === 'fixture' && !deck.source) image=await decorativeImage(deck,index,mediaRoot,signal);
  }
  if (!image) return isImageLayout(slide.layout ?? item.layout)
    ? {...slide,layout:fitGeneratedLayout(slide.layout ?? item.layout,{title:slide.title ?? item.title,body:slide.body ?? item.summary})}
    : slide;
  if (mode === 'auto' && !isImageLayout(item.layout)) return {...slide,image};
  const preferred = isImageLayout(item.layout) || item.layout === 'cover' ? item.layout
    : slide.layout && isImageLayout(slide.layout) ? slide.layout : index % 2 ? 'image-left' : 'image-right';
  const layout = fitGeneratedLayout(preferred,{title:slide.title ?? item.title,body:slide.body ?? item.summary,image,additionalImages});
  if (layout === slide.layout && image === slide.image && additionalImages === slide.additionalImages && !slide.design?.variant) return slide;
  // Preserve detail from story layouts in the notes when the illustration replaces their visual slot.
  const design = slide.design;
  const notes = [slide.notes, design?.takeaway, ...(design?.cards ?? []).map(card => card.title + '\n' + card.text)].filter(Boolean).join('\n\n');
  const caption = design?.eyebrow ? {theme: 'deck' as const,eyebrow:design.eyebrow} : undefined;
  return { ...slide, image, additionalImages, layout, notes, design:caption };
}
