import type { FreeBox, FreeLayout } from './free-layout';
import type { DiagramKind, SlideDiagram } from './diagram';
import type { ImageCrop } from './image-crop';
import type { QualityReview } from './quality';
import type { TranslationReport } from './language-version';
export type Locale = 'kk' | 'ru' | 'en';
export const imageModes = ['auto', 'illustrated', 'image-led', 'none'] as const;
export type ImageMode = (typeof imageModes)[number];
export const imageStyles = ['illustration','schematic','watercolor','photograph'] as const;
export type ImageStyle = typeof imageStyles[number];
export const slideLayouts = [
  'cover', 'image-right', 'image-left', 'image-full', 'image-grid', 'image-section', 'body', 'native-table', 'data-chart',
  'quote', 'avatar-right', 'stacked', 'split', 'centered',
] as const;
export type Layout = (typeof slideLayouts)[number];
export const deckThemes = ['notebook', 'laboratory', 'steppe', 'contrast', 'editorial', 'minimal', 'blueprint', 'midnight', 'museum', 'atlas', 'chalkboard', 'newsprint', 'field-notes', 'collage', 'spotlight', 'strategy', 'signal'] as const;
export type Theme = (typeof deckThemes)[number];
export const brandFonts = ['IBM Plex Sans', 'Golos Text Variable', 'Noto Serif'] as const;
export type OrganizationBrand = {
  paper: string; ink: string; font: (typeof brandFonts)[number]; logo?: string;
};
export type OrganizationAsset = {id:string; name:string; src:string};
export type OrganizationTemplate = {id:string; name:string; language:Locale; slideCount:number};
export type PowerPointVisualStyle = {
  paper:string; ink:string; accent:string; tint:string; headingFont:string; bodyFont:string;
};
export type PowerPointLayout = {name:string; layout:'centered'|'split'|'stacked'; id?:string; masterId?:string};
export type PowerPointStyle = PowerPointVisualStyle & {
  name:string;
  layouts:PowerPointLayout[];
  masters?: (PowerPointVisualStyle & {id:string;name:string})[];
};
export type SlideStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'cancelled';
export type Provider = 'fixture' | 'alem' | 'local';
export type Value = string | number;
export type RichRun = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type ImageReview = {
  model: string; modelDigest: string; imageSha256: string; constraintsSha256: string;
};
export const slidePictograms = ['atom','book','flask','globe','leaf','lightbulb','ruler','triangle'] as const;
export type SlidePictogram = typeof slidePictograms[number];
export type SlideImage = {
  originalSrc?: string;
  crop?: ImageCrop;
  src: string;
  alt: string;
  decorative?: boolean;
  provenance?: { source: 'catalog'; asset: string } | { source: 'generated'; model?: string; review?: ImageReview } | { source:'upload' }
    | {source:'formula';latex:string} | {source:'pictogram';icon:SlidePictogram};
};
export function isSlideSymbol(image:SlideImage) {
  return image.provenance?.source==='formula' || image.provenance?.source==='pictogram';
}
export type SlideTable = { headers: string[]; rows: Value[][] };
export type SlideChart = { categories: string[]; series: { name: string; values: number[] }[]; alt: string };
export type ResearchSource = { id: string; title: string; url: string; excerpt: string };
export const webResearchModes = ['search', 'research'] as const;
export type WebResearchMode = (typeof webResearchModes)[number];
export type ResearchFinding = { id: string; heading?: string; statement: string; sourceIds: string[] };
export type SourceExcerpt = { id: string; url?: string; source: string; start: number; end: number; excerpt: string };
export const slideRoles = ['opening', 'definition', 'examples', 'reflection', 'activity', 'recap', 'closing'] as const;
export type SlideRole = (typeof slideRoles)[number];
export type SlideDesign = {
  variant?: SlideRole;
  numbered?: boolean;
  theme?: 'deck';
  eyebrow?: string;
  takeaway?: string;
  cards?: { title: string; text: string }[];
};
export const slideObjectKinds = ['text', 'rectangle', 'ellipse', 'arrow'] as const;
export const maxSlideObjects = 24;
export type SlideObjectKind = (typeof slideObjectKinds)[number];
export type SlideObject = FreeBox & { id: string; color: string } & (
  | { kind: 'text'; text: string; fontSize: number; bold: boolean; align: 'left' | 'center' | 'right' }
  | { kind: Exclude<SlideObjectKind, 'text'> }
);
export const coverArtworkMotifs = ['rect','roundRect','ellipse','arch','grid','rings-top','rings-bottom','rings-atlas'] as const;
export type SlideArtwork = FreeBox & {
  id: string;
  kind: 'artwork';
  motif: (typeof coverArtworkMotifs)[number];
  color: string;
  paint: 'fill' | 'stroke';
  backdrop?: string;
};
export type CanvasObject = SlideObject | SlideArtwork;
export type CoverArtwork = { theme: Theme; objects: SlideArtwork[] };
export type Slide = {
  id: string;
  importedPage?: boolean;
  importedPageAspect?: number;
  importedArtwork?: string;
  powerPointLayoutId?: string|null;
  status: SlideStatus;
  moderationNotice?: string;
  layout: Layout;
  lessonPart: string;
  title: string;
  body: string;
  bodyRuns?: RichRun[];
  richText?: { title?: Record<string, unknown>; body?: Record<string, unknown> };
  notes: string;
  image?: SlideImage;
  additionalImages?: SlideImage[];
  table?: SlideTable;
  chart?: SlideChart;
  diagram?: SlideDiagram;
  freeLayout?: FreeLayout|null;
  objects?: SlideObject[];
  coverArtwork?: CoverArtwork|null;
  answer?: string;
  design?: SlideDesign;
  evidence?: SourceExcerpt[];
  sourceReview?: {numbers:string[]; quotations:number; unknownCitations:number};
  version: number;
};
export function slideImages(slide: Pick<Slide,'image'|'additionalImages'>): SlideImage[] {
  return [...(slide.image ? [slide.image] : []),...(slide.additionalImages ?? [])];
}
export type SpeechProfile = {voice:string; language:Locale; wordsPerMinute:number};
export type OutlineItem = { purpose?:string; section?:string; visualDescription?:string; imageScenes?:string[]; diagramKind?:DiagramKind; narrationDraft?:string; assessment?:boolean; id: string; title: string; summary: string; layout: Layout; role?: SlideRole; sourceExcerptId?: string };
export type Deck = {
  themeRecommendation?: import('./themes').ThemeRecommendation;
  speechProfile?:SpeechProfile;
  imageSource?:'ai'|'own'|'none';
  ownIllustration?:SlideImage;
  plannedMinutes?:number;
  imageMode?: ImageMode;
  imageStyle?: ImageStyle;
  powerPointStyle?:PowerPointStyle;
  brand?: OrganizationBrand;
  qualityReview?: QualityReview;
  translation?: TranslationReport;
  activeEditor?: string;
  viewerPermission?: 'owner' | 'edit' | 'view' | 'admin';
  id: string;
  title: string;
  topic: string;
  language: Locale;
  theme: Theme;
  revision: number;
  updatedAt: string;
  provider: Provider;
  phase: 'outline' | 'generating' | 'editing';
  outlineStatus?: 'generating' | 'failed' | 'complete';
  outlineModerationNotice?: string;
  outline: OutlineItem[];
  slides: Slide[];
  research?: { query: string; mode?: WebResearchMode; sources?: ResearchSource[]; findings?: ResearchFinding[] };
  source?: { name: string; text: string };
  template?: string;
};
export type SlideChanges = Partial<Pick<Slide,'layout'|'title'|'body'|'bodyRuns'|'richText'|'notes'|'image'|'additionalImages'|'table'|'chart'|'diagram'|'freeLayout'|'objects'|'coverArtwork'|'answer'|'design'|'powerPointLayoutId'>>;
export type EditOp =
  | { kind:'slide'; slideId:string; baseVersion:number; changes:SlideChanges }
  | { kind:'deck'; title?:string; theme?:Theme; imageStyle?:ImageStyle|null }
  | { kind:'outline'; outline:OutlineItem[] }
  | { kind:'reorder'; slideIds:string[] }
  | { kind:'copySlides'; slideIds:string[]; sourceDeckId:string; sourceRevision:number; afterId?:string }
  | { kind:'removeSlides'; slideIds:string[] }
  | { kind:'add'; afterId?:string; newSlideId?:string; diagram?:SlideDiagram }
  | { kind:'duplicate'|'remove'; slideId:string };
export const maxLessonSlides = 40;
export const minGeneratedSlides = 3;
export type CreateInput = {
  slideCount?: number;
  imageMode?: ImageMode;
  imageStyle?: ImageStyle;
  powerPointStyle?:PowerPointStyle;
  creationId?: string;
  moderationConfirmation?: string;
  topic: string;
  language: Locale;
  provider: Provider;
  review: boolean;
  template?: string;
  researchQuery?: string;
  webResearch?: WebResearchMode;
  sourceDeckId?: string;
  source?: {name: string; text: string};
  answers?: { level?:string; duration?:string; image?:string; quiz?:'include'|'omit';
    quizInstruction?:string; imageInstruction?:string; imageSource?:'ai'|'own'|'none';
    ownImage?:{data:string;alt:string} };
};
export type Proposal = { id:string; slideId:string; baseVersion:number; before:Slide; after:Slide; status:'pending'|'applied'|'dismissed' };
export type Revision = { revision:number; at:string; reason:string; deck?:Deck };
export type StudioEvent = {
  seq:number; kind:'outline'|'slide'|'run'|'proposal'; revision:number;
  slideId?:string; runId?:string; ag?:unknown;
};
