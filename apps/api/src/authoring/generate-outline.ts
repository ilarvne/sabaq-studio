import { supportedClaims } from '@sabaq/agent/evidence';
import { imageSceneList } from '@sabaq/contracts/schema';
import { diagramKinds } from '@sabaq/lesson/diagram';
import { isTemplate, templatePlan } from '@sabaq/lesson/lesson-templates';
import { themePresets } from '@sabaq/lesson/themes';
import { deckThemes, slideLayouts, slideRoles, type CreateInput, type Locale, type SourceExcerpt, type Theme } from '@sabaq/lesson/types';
import { z } from 'zod';
import { AlemOutputError, generate } from './alem';
import { generationLayoutChoices, generationRoleGuide, retainRequestedChart, retainRequestedDiagram } from './layout-planner';
import { generateLocal } from './local-generation';

const text = z.string().trim().min(1).max(5000);
const planItem = z.object({
  title: text.max(160),
  summary: text.max(200),
  purpose: text.max(400),
  section: text.max(160).optional().catch(undefined),
  layout: z.enum(slideLayouts),
  visualDescription: text.max(400).optional().catch(undefined),
  imageScenes: imageSceneList.optional().catch(undefined),
  diagramKind: z.enum(diagramKinds).optional().catch(undefined),
  narrationDraft: text.max(2500).optional().catch(undefined),
  assessment: z.boolean().optional().catch(undefined),
  role: z.enum(slideRoles).optional().catch(undefined),
  sourceExcerptId: text.max(100).optional().catch(undefined),
});
const suggestedPlanItem = planItem.extend({ layout: planItem.shape.layout.optional().catch(undefined) });
const planTheme = z.enum(deckThemes).optional().catch(undefined);

// Sample the whole document at short lengths. Longer outlines receive consecutive windows.
function sourceWindow(passages:SourceExcerpt[],start:number,length:number,count:number) {
  const first=Math.floor(start*passages.length/count);
  const last=Math.max(first,Math.ceil((start+length)*passages.length/count)-1);
  const size=Math.min(8,last-first+1);
  return Array.from({length:size},(_,i)=>{
    const {id,excerpt}=passages[first + Math.round(i*(last-first)/Math.max(1,size-1))];
    return {id,excerpt};
  });
}

function groundOutlineItem(item:z.infer<typeof planItem>,passages:Pick<SourceExcerpt,'id'|'excerpt'>[],index:number) {
  const {sourceExcerptId,...content}=item;
  if (!passages.length) return content;
  const cited=passages.find(ref=>ref.id===sourceExcerptId);
  const written=[item.title,item.summary,item.section,item.purpose,item.visualDescription,...(item.imageScenes ?? []),item.narrationDraft].filter(Boolean).join('\n');
  if (cited && supportedClaims(written,[cited.excerpt])) return item;
  const passage=cited ?? passages[index % passages.length];
  const summary=passage.excerpt.slice(0,200);
  return {title:passage.excerpt.slice(0,160),summary,purpose:summary,layout:'body' as const,sourceExcerptId:passage.id,diagramKind:item.diagramKind};
}

export async function generateOutline(
  topic: string,
  language: string,
  count: number,
  signal?: AbortSignal,
  preferences?: CreateInput['answers'],
  template?: string,
  complete = generate,
  sourcePassages?: SourceExcerpt[],
) {
  const structure = isTemplate(template)
    ? templatePlan(template,language as Locale,topic,count).map(({ title, summary, layout }) => ({ title, task:summary, recommendedLayout:layout }))
    : undefined;
  const items: z.infer<typeof planItem>[] = [];
  let theme:Theme | undefined;
  // Limit each model response to the outline size that fits the local generation token budget.
  const batchLimit = complete === generateLocal || sourcePassages ? 3 : 10;
  const themeGuide = Object.fromEntries(deckThemes.filter(id=>id!=='newsprint').map(id => [id, themePresets[id].use]));
  const layouts = generationLayoutChoices(preferences?.image !== 'none' && preferences?.imageSource !== 'none');
  const closingCheck = preferences?.quiz !== 'omit' && /\b(?:finish|end|close|conclude)\b[^.!?;]{0,55}\b(?:question|quiz|recall|check)\b|(?:заверш|закончи)[^.!?;]{0,55}(?:вопрос|тест|провер)|(?:соңында|аяқта)[^.!?;]{0,55}(?:сұрақ|тест|тексер)/iu.test(topic);
  for (let start = 0; start < count; start += batchLimit) {
    const length = Math.min(batchLimit, count - start);
    const savesClosingCheck = closingCheck && start + length === count && count > 1;
    const closingRule = savesClosingCheck
      ? 'The final slide must be the requested quiz or recall question with assessment:true. Put any required diagram in an earlier slot and describe the actions or concepts it will show. '
      : '';
    const passages = sourcePassages?.length ? sourceWindow(sourcePassages,start,length,count) : [];
    const modelPassages = complete === generateLocal ? passages : passages.map(({excerpt},index) => ({id:`E${index + 1}`,excerpt}));
    const sourceField = modelPassages.length ? `,"sourceExcerptId":"${modelPassages[0].id}"` : '';
    const input = { topic, language, count:length, totalSlideCount:count, firstSlide:start + 1,
      earlierSlides:items.map(({title,section,role,layout,diagramKind}) => ({title,section,role,layout,diagramKind})), preferences,
      ...(structure && { template, structure:structure.slice(start, start + length) }), layouts, slideRoles:generationRoleGuide, theme, themeGuide,
      ...(modelPassages.length && {passages:modelPassages}) };
    const slotExample = `{"title":"...","summary":"...","purpose":"...","role":"role ID","layout":"layout ID"${sourceField}}`;
    const plan = await complete(
      `Return exactly ${length} slide entries, starting at slide ${start + 1}. Combine related ideas within the available slides. Slide roles and layouts are options, not a checklist. ` +
        closingRule + 'Design a presentation for this specific brief, audience and duration. Choose the progression, slide purposes and visual layouts yourself. ' +
        'Give each slide a concrete title, a one-sentence summary and a short purpose explaining why this particular slide belongs here. Keep each under 20 words. ' +
        'If grouping helps, name sections in the requested language and reuse the same section name for adjacent slides in that section. ' +
        'Give each slide one teaching role from slideRoles. Use the role and the supplied layout catalog to plan a visual sequence. Match the layout to what students must see: a single question or takeaway, a comparison, an illustration, exact table cells, or a pattern in supplied numeric data. Use a full-frame image only for a short, visually led opener or section divider. ' +
        'Choose a chart only when the brief or sources provide the actual categories and values. Choose a table only when multiple comparable fields are available. Provide a concrete visualDescription when an image layout is selected. Do not invent quotations or data to fill a layout. ' +
        (Object.hasOwn(layouts,'image-grid') ? 'Use image-grid only when comparing different views, specimens, or scenes visually supports the teaching task. For that layout supply imageScenes, an array of two or three distinct concrete image descriptions written in the lesson language. Request a single scene for other image layouts. ' : '') +
        'When the teacher requests an editable diagram or a visual sequence will clarify the lesson, set diagramKind to process, timeline, or mind-map on that slide. Put the sequence or concepts in its summary. A diagram uses native elements without requiring image assets. ' +
        'Avoid more than two consecutive uses of a layout unless the material or a specific teacher instruction calls for repetition. Highlight one principal conclusion, genuine quotation, or supplied quantity with the quote layout when appropriate. Prefer the specified classroom task over variety. ' +
        'When a user-selected template structure is supplied, retain its requested teaching tasks and use the recommended layout where it fits. Honour specific instructions, including quiz and image preferences. ' +
        'If including an assessment mark assessment:true. Include a visualDescription only when a particular image would help. Add a short spoken narrationDraft if useful. ' +
        (passages.length ? 'Base every slide on the supplied passages. Every slide must include sourceExcerptId, using the exact ID of its closest supporting passage. Keep factual numbers, dates and quotations faithful to that passage. ' : '') +
        'Return exactly count entries in the requested language starting at firstSlide, continuing the earlier slides without repeating content. Choose a theme suited to the brief. ' +
        `Return {"theme":"theme ID","slides":[${slotExample}]}. Add section, narrationDraft, visualDescription, imageScenes, diagramKind or assessment only when relevant.`,
      input,
      z.object({ slides:z.array(suggestedPlanItem).length(length), theme:planTheme }),
      signal,
    ).then(plan => {
      const last = plan.slides.at(-1);
      if (savesClosingCheck && (!last?.assessment || last.diagramKind) && complete !== generateLocal)
        throw new AlemOutputError('The required closing check is missing.');
      return plan;
    }).catch(async error => {
      if (!(error instanceof AlemOutputError) || complete === generateLocal) throw error;
      signal?.throwIfAborted();
      // Fixed slots keep the selected count without cutting requested content from the end.
      const keys = Array.from({length}, (_, index) => `slide${start + index + 1}`);
      const slots = z.object(Object.fromEntries(keys.map(key => [key,suggestedPlanItem])));
      const example = keys.map(key => `"${key}":${slotExample}`).join(',');
      const corrected = await complete(
        `The outline must fill exactly these ${length} slots. Combine related material to fit. ` +
          closingRule +
          'Use short plain-text titles, summaries and purposes in the requested language. Choose roles and layouts from the supplied catalogs. ' +
          'Retain the requested teaching tasks, charts with supplied data, editable diagrams and questions. Set diagramKind to process, timeline, or mind-map on each planned diagram, independently of image choices. ' +
          (Object.hasOwn(layouts,'image-grid') ? 'Only choose image-grid when imageScenes contains two or three distinct lesson-relevant views or subjects. ' : '') +
          'Mark an assessment with assessment:true. Keep supplied figures and quotations faithful to their sources. ' +
          (modelPassages.length ? 'Cite one supplied passage ID per slot in sourceExcerptId. ' : '') +
          `Return {"theme":"theme ID","slots":{${example}}}. Use the slot names shown.`,
        input,z.object({slots,theme:planTheme}),signal,
      );
      return {slides:keys.map(key => corrected.slots[key]),theme:corrected.theme};
    });
    items.push(...plan.slides.map((item,i) => {
      const stageIndex = start + i;
      const suggested = item.layout && Object.hasOwn(layouts,item.layout) ? item.layout : undefined;
      const roleLayout = !structure && item.role && (item.role !== 'opening' || stageIndex === 0)
        ? generationRoleGuide[item.role].layout : undefined;
      const layout = structure && stageIndex === 0 ? 'cover'
        : suggested && suggested !== 'body' ? suggested
        : roleLayout ?? suggested ?? structure?.[stageIndex]?.recommendedLayout ?? (stageIndex === 0 ? 'cover' : 'body');
      const sourceExcerptId = passages[modelPassages.findIndex(({id}) => id === item.sourceExcerptId)]?.id;
      return groundOutlineItem({ ...item, layout, sourceExcerptId }, passages, i);
    }));
    theme ??= plan.theme;
  }
  const planned = retainRequestedDiagram(items, topic, closingCheck);
  return {items:sourcePassages?.length ? planned : retainRequestedChart(planned,topic), theme};
}
