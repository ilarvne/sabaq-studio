import { supportedClaims } from '@sabaq/agent/evidence';
import { slideChangeFields } from '@sabaq/contracts/schema';
import type { DiagramKind } from '@sabaq/lesson/diagram';
import { isTemplate } from '@sabaq/lesson/lesson-templates';
import type { CreateInput, Deck, Layout, OutlineItem } from '@sabaq/lesson/types';
import { z } from 'zod';
import { illustrationCatalog, imageRequestSchema } from '../media/visuals';
import { generate } from './alem';
import { isImageLayout, layoutWordBudget } from './layout-planner';

const text = z.string().trim().min(1).max(5000);
export const generatedSlideSchema = z.object({
  title: text.max(180),
  body: text.max(1200),
  notes: text.max(2500),
});
export type GeneratedText = z.infer<typeof generatedSlideSchema>;

export const lessonSlideSchema = generatedSlideSchema.extend({
  eyebrow: text.max(60).optional().catch(undefined),
  takeaway: text.max(180).optional().catch(undefined),
  cards: z.array(z.object({ title: text.max(45), text: text.max(140) })).max(3).optional().catch(undefined),
  answer: text.max(220).optional().catch(undefined),
  illustration: imageRequestSchema.optional().catch(undefined),
  numbered: z.boolean().optional(),
  table: slideChangeFields.shape.table.refine(table => table === undefined || table.rows.length > 0).catch(undefined),
  chart: slideChangeFields.shape.chart.catch(undefined),
  diagram: slideChangeFields.shape.diagram.catch(undefined),
});

export type LessonSlideDraft = z.infer<typeof lessonSlideSchema>;

export const compositionGuidance = 'Compose for the approved layout and keep projected text within bodyWordBudget. Put fuller explanations into speaker notes. ' +
      'Choose at most one main visual. Use supplied measurements for charts and never invent quotations or attribution. If a planned visual lacks the required material, omit it. ';

const visualSlots = {
  title: 'title (concise slide heading)',
  body: 'body (projected copy within the word budget)',
  notes: 'notes (spoken teaching explanation and optional cues)',
  eyebrow: 'eyebrow (up to 60 characters)',
  takeaway: 'takeaway (up to 180 characters, adds information to the body)',
  cards: 'cards (up to 3 objects with title up to 45 and text up to 140 characters)',
  numbered: 'numbered (true only when cards have a required sequence)',
  answer: 'answer (optional answer revealed during a check for understanding, up to 220 characters)',
  table: 'table ({headers,rows}, every row the same width)',
  chart: 'chart ({categories,series:[{name,values}],alt}, each series the same length)',
  diagram: 'diagram ({kind,nodes,alt}, kind is timeline, process or mind-map, with 3–7 short nodes)',
  illustration: 'illustration ({asset,prompt,alt,place,period})',
} satisfies Record<keyof typeof lessonSlideSchema.shape, string>;

const layoutFocus: Partial<Record<Layout, string>> = {
  cover: 'Make the subtitle state the lesson question or learning outcome.',
  quote: 'Lead with the principal conclusion, a supplied number, or a verifiable quotation. Do not invent an attribution.',
  centered: 'Keep attention on one self-contained question or instruction.',
  split: 'Use peer comparisons, a process diagram or one media slot where material supports it. Keep parallel pieces equally concise.',
  stacked: 'Lead with the idea, then add steps, observations or evidence where useful.',
  'native-table': 'Use column labels and comparable rows to make exact details readable. Do not duplicate table cells in the body.',
  'data-chart': 'Use a chart with the supplied data. If comparison needs exact values and a chart would distort the task, use a table.',
};

export function slideComposition(layout: Layout, allowIllustration: boolean, diagramKind?: DiagramKind) {
  const core = { title:true, body:true, notes:true, eyebrow:true, answer:true } as const;
  const imageLayout = isImageLayout(layout);
  const flexible = layout === 'body' || layout === 'stacked' || layout === 'split';
  const supportsIllustration = imageLayout || flexible || layout === 'cover' || layout === 'centered' || layout === 'quote';
  const fields: Partial<Record<keyof typeof lessonSlideSchema.shape,true>> = {
    ...core,
    ...(layout !== 'cover' && !imageLayout && { takeaway:true }),
    ...(diagramKind ? { diagram:true } : {
      ...(flexible && { cards:true, numbered:true, diagram:true, table:true, chart:true }),
      ...(layout === 'native-table' && { table:true }),
      ...(layout === 'data-chart' && { chart:true, table:true }),
      ...(allowIllustration && supportsIllustration && { illustration:true }),
    }),
  };
  const schema = lessonSlideSchema.pick(fields);
  const slots = (Object.keys(fields) as (keyof typeof visualSlots)[]).map(key => visualSlots[key]);
  const focus = diagramKind ? diagramInstruction(diagramKind) : layoutFocus[layout] ?? (imageLayout
    ? 'Write an image-supported slide. Keep the projected text distinct from the image description.'
    : 'Present a clear explanation with a concrete example or supporting content when material is available.');
  return { schema, instruction: `${focus}\nReturn title, body and notes. Use only these fields:\n- ${slots.join('\n- ')}` };
}

function diagramInstruction(kind:DiagramKind) {
  return `Include a native ${kind} diagram. Its diagram field must contain kind:"${kind}", nodes (3–7 distinct, short labels in the requested language) and a descriptive alt. Put the actual concepts or actions into the labels. For a worked example, use the simplest valid setup, and check that each step follows from the previous step and obeys the rule being taught.`;
}

export async function completePlannedDiagram<T extends LessonSlideDraft>(
  draft:T, kind:DiagramKind | undefined, context:object, complete:typeof generate, signal:AbortSignal,
):Promise<T> {
  if (!kind || draft.diagram?.kind === kind && new Set(draft.diagram.nodes).size === draft.diagram.nodes.length) return draft;
  signal.throwIfAborted();
  const diagramField = slideChangeFields.shape.diagram.nonoptional().refine(diagram =>
    diagram.kind === kind && new Set(diagram.nodes).size === diagram.nodes.length);
  const {diagram} = await complete(
    `${diagramInstruction(kind)} Use the supplied topic and teaching goal. When passages are supplied, every factual label must be supported by those passages. Never invent measurements or quotations. Return only the diagram field.`,
    {...context,diagramKind:kind,slideCopy:{title:draft.title,body:draft.body}},z.object({diagram:diagramField}),signal,
  );
  return {...draft,diagram};
}

export async function generateSlide(
  deck: Pick<Deck, 'topic' | 'language' | 'outline' | 'template' | 'imageMode'>,
  item: OutlineItem,
  index: number,
  signal: AbortSignal,
  preferences?: CreateInput['answers'],
  allowIllustration = false,
  allowImageGeneration = false,
  complete = generate,
) {
  const slide = slideComposition(item.layout, allowIllustration, item.diagramKind);
  const composition = deck.imageMode === 'image-led'
    ? ' Select a single visual subject for a widescreen background. Keep the subject towards the right and leave the left side quiet for editable slide text.'
    : deck.imageMode === 'illustrated' ? ' Choose a supporting scene for a portrait crop alongside editable slide text.' : '';
  const illustrationInstruction = allowIllustration && !item.diagramKind
    ? (composition || ' If a picture advances the classroom task, include an illustration.') + ' Use a catalog asset only when its exact scene matches.' +
      (allowImageGeneration ? ' For a new scene, give a concrete English image prompt and concise alt text in the requested lesson language. Describe the subject and action. When the lesson specifies a place or period, include those in the corresponding fields. Omit names, recognizable faces, lettering and logos.' : ' Omit illustration if the catalog has no relevant scene.')
    : ' Omit illustration.';
  const context = {
    topic: deck.topic, language: deck.language, slide: index + 1, layout:item.layout, bodyWordBudget:layoutWordBudget(item.layout),
    purpose:item.purpose, section:item.section, role:item.role, assessment:item.assessment, diagramKind:item.diagramKind,
    outlineTitle: item.title, outlineSummary: item.summary, visualDescription:item.visualDescription, approvedNarration:item.narrationDraft,
    outline:deck.outline.map(({ title, section }) => ({title,section})), preferences,
  };
  const draft = await complete(
    'Compose one slide in the requested language. Preserve the approved topic and intent. Use plain text and put teaching cues in notes. ' +
      compositionGuidance +
      'Use an answer only when there is something to reveal. Honour the teacher’s quiz preference. ' + illustrationInstruction +
      ' ' + slide.instruction + ' Omit unused fields.',
    { ...context,
      ...(isTemplate(deck.template) && { template:deck.template }),
      ...(allowIllustration && !item.diagramKind && { illustrations: illustrationCatalog }),
    },
    slide.schema,
    signal,
  );
  if (draft.chart && !supportedClaims(draft.chart.series.flatMap(series => series.values).join(' '), [deck.topic,item.summary])) {
    return { ...draft, chart: undefined };
  }
  return completePlannedDiagram(draft,item.diagramKind,context,complete,signal);
}

export function reviseSlide(language: string, slide: GeneratedText, instruction: string) {
  return generate(
    'Revise this lesson slide as requested, preserving all unrelated text and using the specified language. Format: {"title":"...","body":"...","notes":"..."}.',
    { language, instruction, title: slide.title, body: slide.body, notes: slide.notes },
    generatedSlideSchema,
  );
}
