import { freeIds, freeBounds } from '@sabaq/lesson/free-layout';
import { diagramAltLimit, diagramKinds, diagramLabelLimit } from '@sabaq/lesson/diagram';
import { z } from 'zod';
import { deckThemes, imageModes, imageStyles, maxLessonSlides, slideLayouts, slidePictograms, slideRoles } from '@sabaq/lesson/types';

const id = z.string().min(1).max(160);
const single = z.string().max(1000);
const layout = z.enum(slideLayouts);
const theme = z.enum(deckThemes);
const outline = z
  .array(z.object({ id, title: single.min(1), summary: single, purpose:z.string().max(400).optional(), section:z.string().max(160).optional(), visualDescription:z.string().max(400).optional(), narrationDraft:z.string().max(2500).optional(), assessment:z.boolean().optional(), layout, role: z.enum(slideRoles).optional(), sourceExcerptId: id.optional() }))
  .min(1)
  .max(maxLessonSlides)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Outline IDs must be unique',
  );
const run = z.object({
  text: z.string().max(10000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.url({ protocol: /^https?$/ }).optional(),
});
export const imageCropInput = z.object({
  x:z.number().min(0).max(100), y:z.number().min(0).max(100), zoom:z.number().min(1).max(5),
  radius:z.number().min(0).max(50), aspect:z.enum(['original','wide','square','portrait']),
}).strict();
const formulaSource = z.object({source:z.literal('formula'),latex:z.string().trim().min(1).max(500)});
const pictogramSource = z.object({source:z.literal('pictogram'),icon:z.enum(slidePictograms)});
export const slideSymbolInput = z.discriminatedUnion('source', [
  formulaSource.extend({alt:single.trim().min(1)}).strict(),
  pictogramSource.extend({alt:single.trim().min(1)}).strict(),
]);
const image = z.object({
  originalSrc:z.string().regex(/^\/(?:assets\/[a-z0-9-]+\.webp|api\/media\/[0-9a-f]{64}\.png)$/u).optional(),
  crop:imageCropInput.optional(),
  src: z
    .string()
    .startsWith('/')
    .regex(/^\/(?!\/)[^\\]*$/)
    .max(1000),
  alt: single,
  decorative: z.boolean().optional(),
  provenance: z.discriminatedUnion('source', [
    z.object({source: z.literal('upload')}),
    formulaSource,
    pictogramSource,
    z.object({source: z.literal('catalog'), asset: id}),
    z.object({source: z.literal('generated'), model: id.optional(), review:z.object({
      model:id, modelDigest:id, imageSha256:z.hash('sha256'), constraintsSha256:z.hash('sha256'),
    }).optional()}),
  ]).optional(),
});
const table = z
  .object({
    headers: z.array(single).min(1).max(30),
    rows: z.array(z.array(z.union([single, z.number()])).max(30)).max(100),
  })
  .refine(
    (t) => t.rows.every((row) => row.length === t.headers.length),
    'Table rows must match the number of headers',
  );
const freeItem = z.object({
  id:z.enum(freeIds),group:z.uuid().optional(),x:z.number().min(-50).max(100),y:z.number().min(-50).max(100),
  w:z.number().min(.1).max(100),h:z.number().min(.1).max(100),rotation:z.number().min(-180).max(180),
}).strict().refine(item=>{
  const box=freeBounds(item);
  return box.x>=-.01 && box.y>=-.01 && box.x+box.w<=100.01 && box.y+box.h<=100.01;
},'Free-layout elements must fit the slide');
const freeLayout=z.object({items:z.array(freeItem).min(1).max(freeIds.length)}).strict()
  .refine(layout=>new Set(layout.items.map(item=>item.id)).size===layout.items.length,'Each element must have a unique position')
  .refine(layout=>{
    const seen=new Set<string>();
    let current:string|undefined;
    for(const item of layout.items) {
      if(current!==item.group && item.group && seen.has(item.group)) return false;
      current=item.group;
      if(current) seen.add(current);
    }
    return true;
  },'A group must occupy consecutive layers');
const diagram = z.object({
  kind:z.enum(diagramKinds),nodes:z.array(z.string().trim().min(1).max(diagramLabelLimit)).min(3).max(7),
  alt:z.string().trim().max(diagramAltLimit).optional(),
}).strict();
const chart = z
  .object({
    categories: z.array(single).min(1).max(100),
    series: z
      .array(z.object({ name: single, values: z.array(z.number()).max(100) }))
      .min(1)
      .max(12),
    alt: single,
  })
  .refine(
    (c) => c.series.every((s) => s.values.length === c.categories.length),
    'Chart series must match categories',
  );

const themeColor=z.string().regex(/^#[0-9a-f]{6}$/i);
const typeface=z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} _.-]+$/u);
const masterId=z.string().regex(/^m[1-9][0-9]?$/);
const templateLayoutId=z.string().regex(/^m[1-9][0-9]?-l[1-9][0-9]?$/);
const name=z.string().trim().min(1).max(100);
const templateVisualStyle={paper:themeColor,ink:themeColor,accent:themeColor,tint:themeColor,headingFont:typeface,bodyFont:typeface};
export const powerPointStyleInput=z.object({
  name,...templateVisualStyle,
  masters:z.array(z.object({id:masterId,name,...templateVisualStyle}).strict()).min(1).max(16).optional(),
  layouts:z.array(z.object({id:templateLayoutId.optional(),masterId:masterId.optional(),name,layout:z.enum(['centered','split','stacked'])}).strict()).min(1).max(32),
}).strict().refine(style=>{
  if(!style.masters) return style.layouts.every(layout=>!layout.id && !layout.masterId);
  const masters=new Set(style.masters.map(master=>master.id));
  return masters.size===style.masters.length && new Set(style.layouts.map(layout=>layout.id)).size===style.layouts.length &&
    style.layouts.every(layout=>layout.id && layout.masterId && masters.has(layout.masterId) && layout.id.startsWith(layout.masterId+'-'));
},'Each named layout must belong to a master in the imported design');
export const createInput = z.object({
  slideCount: z.number().int().min(1).max(maxLessonSlides).optional(),
  imageMode: z.enum(imageModes).optional(),
  imageStyle: z.enum(imageStyles).optional(),
  powerPointStyle:powerPointStyleInput.optional(),
  creationId:z.uuid().optional(),
  moderationConfirmation: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  topic: z.string().trim().min(1).max(500),
  language: z.enum(['kk', 'ru', 'en']),
  provider: z.enum(['fixture', 'alem', 'local']),
  review: z.boolean(),
  template: single.optional(),
  sourceDeckId: id.optional(),
  sourceFileIds: z.array(z.uuid()).min(1).max(10).optional(),
  sourceNotes: z.string().trim().min(1).max(100000).optional(),
  researchQuery: z.string().trim().min(1).max(200).optional(),
  source: z
    .object({
      name: single.min(1),
      text: z
        .string()
        .min(1)
        .max(100000)
        .refine((s) => s.trim().length > 0),
    })
    .optional(),
  answers: z
    .object({ level: single.optional(), duration: single.optional(), image: single.optional(),
      quiz:z.enum(['include','omit']).optional(),quizInstruction:z.string().trim().max(240).optional(),
      imageSource:z.enum(['ai','own','none']).optional(),imageInstruction:z.string().trim().max(240).optional(),
      ownImage:z.object({data:z.string().min(4).max(13_333_336).regex(/^[A-Za-z0-9+/]+={0,2}$/u),alt:z.string().trim().max(400)}).strict().optional() })
    .optional(),
}).superRefine((data, ctx) => {
  if (data.sourceFileIds && (data.source || data.sourceDeckId || data.researchQuery || data.template === 'blank'))
    ctx.addIssue({code:'custom',path:['sourceFileIds'],message:'Choose either library files or another source mode.'});
  if (data.sourceNotes && !data.sourceFileIds)
    ctx.addIssue({code:'custom',path:['sourceNotes'],message:'Select source files to include notes.'});
});
export const slideChangeFields = z
  .object({
    powerPointLayoutId:templateLayoutId.nullable(),
    title: single,
    body: z.string().max(10000),
    bodyRuns: z.array(run).max(1000),
    notes: z.string().max(10000),
    richText: z.object({
      title: z.record(z.string(), z.unknown()).optional(),
      body: z.record(z.string(), z.unknown()).optional(),
    }),
    image,
    additionalImages: z.array(image).max(2),
    table,
    chart,
    diagram,
    freeLayout:freeLayout.nullable(),
    answer: single,
    design: z.object({
      variant: z.enum(slideRoles).optional(),
      numbered: z.boolean().optional(),
      theme: z.literal('deck').optional(),
      eyebrow: z.string().max(60).optional(),
      takeaway: z.string().max(180).optional(),
      cards: z.array(z.object({title:z.string().max(45), text:z.string().max(140)})).max(3).optional(),
    }).strict(),
    layout,
  }).partial().strict();
const changes = slideChangeFields
  .refine((value) => Object.keys(value).length > 0, 'No changes provided');
export const editInput = z.object({
  operationId: id.optional(),
  baseRevision: z.number().int().min(0).optional(),
  op: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('slide'), slideId: id, baseVersion: z.number().int().min(0), changes }),
    z.object({ kind: z.literal('deck'), title: single.min(1).optional(), theme: theme.optional(), imageStyle:z.enum(imageStyles).nullable().optional() }),
    z.object({ kind: z.literal('outline'), outline }),
    z.object({ kind: z.literal('reorder'), slideIds: z.array(id).max(maxLessonSlides) }),
    z.object({kind:z.literal('copySlides'),slideIds:z.array(id).min(1).max(maxLessonSlides),sourceDeckId:id,sourceRevision:z.number().int().nonnegative(),afterId:id.optional()}),
    z.object({kind:z.literal('removeSlides'),slideIds:z.array(id).min(1).max(maxLessonSlides)}),
    z.object({ kind: z.literal('add'), afterId: id.optional(), newSlideId: z.uuid().optional(), diagram:diagram.optional() }),
    z.object({ kind: z.literal('duplicate'), slideId: id }),
    z.object({ kind: z.literal('remove'), slideId: id }),
  ]),
});
export const proposeInput = z.object({ slideId: id, instruction: z.string().trim().min(1).max(1500) });
export const decideInput = z.object({ action: z.enum(['apply', 'dismiss']) });
export const retryInput = z.object({ slideId: id });
