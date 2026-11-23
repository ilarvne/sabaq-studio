import sharp from 'sharp';
import { illustrationDescriptions } from '@sabaq/contracts/illustrations';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import { lessonPalette } from '@sabaq/lesson/themes';
import type { CreateInput, Deck, ImageMode, OutlineItem, Slide, SlideImage } from '@sabaq/lesson/types';
import { allowsOpenAIImages, hasLessonImageProvider, resolveSlideIllustration, storeImage } from '../media/visuals';

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
  if (mode === 'none' || deck.imageSource === 'own' && (!deck.ownIllustration || index !== 0)) {
    const layout = slide.layout ?? item.layout;
    return { ...slide, image: undefined, additionalImages:undefined, ...(['image-left', 'image-right', 'image-full','image-grid','image-section','avatar-right'].includes(layout) && { layout: 'body' }) };
  }
  if (deck.imageSource === 'own') {
    return {...slide,image:deck.ownIllustration,additionalImages:undefined,layout:'image-right',design:undefined};
  }
  if (slide.diagram || slide.chart || slide.table || slide.importedPage) return slide;
  const guidance=lessonImageGuidance(deck);
  let image=slide.image;
  // The lesson model's structured illustration is resolved during composition.
  // Fixture and grounded slides have no illustration field, so use the approved outline.
  const needsOutlineArt = !image && (deck.provider==='fixture' || !!deck.source) &&
    (mode!=='auto' || deck.slides.filter(candidate=>candidate.image).length < 5);
  if (needsOutlineArt && hasLessonImageProvider(deck)) {
    image=await resolveSlideIllustration(outlineIllustration(item), {
      language:deck.language, topic:deck.topic, signal, mediaRoot, allowOpenAI:allowsOpenAIImages(deck), ...guidance,
    });
  }
  if (mode === 'auto') return image && !slide.image ? { ...slide, image } : slide;
  if (!image && (!deck.imageStyle || deck.imageStyle==='illustration')) {
    image=(guidance.avoidCatalog ? undefined : catalogScene(deck,item)) ?? await decorativeImage(deck,index,mediaRoot,signal);
  }
  if (!image) return slide;
  const layout = mode === 'image-led' ? 'image-full' : index % 2 ? 'image-left' : 'image-right';
  // The basic visual layouts display editable title and body slots. Keep supplementary
  // content from story-card layouts available to the presenter as notes.
  const design = slide.design;
  const notes = [slide.notes, design?.takeaway, ...(design?.cards ?? []).map(card => card.title + '\n' + card.text)].filter(Boolean).join('\n\n');
  return { ...slide, image, layout, notes, design: undefined };
}
