import { z } from 'zod';
import type { CreateInput, Deck, OutlineItem, Slide, SourceExcerpt } from '@sabaq/lesson/types';
import { AlemOutputError, generate } from './alem';
import { completePlannedDiagram, compositionGuidance, generatedSlideSchema, slideComposition, type LessonSlideDraft } from './generate-slide';
import { composeDraft } from './compose';
import { unsupportedClaims } from '@sabaq/agent/evidence';
import { searchLesson } from '../assistant/lesson-retrieval';
import { fixtureSlide } from './lessons';
import { generateLocal } from './local-generation';
import type { StudioStore } from '../persistence/storage';
import { layoutWordBudget } from './layout-planner';
import { researchPassages, researchSlide } from './research';

const citations = z.array(z.string().max(80)).min(1).max(4);

function checkEvidence(draft:LessonSlideDraft & {citations:string[]}, references:Map<string,SourceExcerpt>) {
  const cited = [...new Set(draft.citations)];
  const evidence = cited.map(id=>references.get(id)).filter((ref):ref is SourceExcerpt=>Boolean(ref));
  const {title,body,notes,eyebrow,takeaway,cards,answer,table,chart,diagram}=draft;
  const projectedContent=[
    title,body,notes,eyebrow,takeaway,answer,...(cards ?? []).flatMap(card=>[card.title,card.text]),
    ...(table?.headers ?? []),...(table?.rows.flat() ?? []),...(chart?.categories ?? []),chart?.alt,
    ...(chart?.series ?? []).flatMap(series=>[series.name,...series.values]),...(diagram?.nodes ?? []),diagram?.alt,
  ];
  const gaps = unsupportedClaims(projectedContent.filter(value=>value!==undefined).join('\n'),evidence.map(ref=>ref.excerpt));
  const unknownCitations = cited.length - evidence.length;
  return {evidence,review:{...gaps,unknownCitations},unsupported:Boolean(gaps.numbers.length || gaps.quotations || unknownCitations)};
}

export async function groundedSlide(store:StudioStore, deck:Deck, item:OutlineItem, index:number, preferences:CreateInput['answers'], signal:AbortSignal):Promise<Partial<Slide>> {
  const publicSources = deck.research?.sources?.length ? researchPassages(deck.research.sources) : undefined;
  const primary = publicSources?.find(passage => passage.id === item.sourceExcerptId) ?? publicSources?.[index % publicSources.length];
  const extract = primary ? researchSlide(deck,{...item,sourceExcerptId:primary.id,summary:primary.excerpt})
    : fixtureSlide(deck,item,index,preferences);
  const references = new Map<string,SourceExcerpt>((extract.evidence ?? []).map(e => [e.id,e]));
  if (primary && publicSources) {
    for (const passage of publicSources) {
      references.set(passage.id,passage);
      if (references.size>=4) break;
    }
  } else {
    const found = await searchLesson(store,deck,[item.title,item.summary].join(' '),signal,8);
    for (const hit of found.hits) {
      if (hit.kind !== 'source' || [...references.values()].some(ref=>ref.excerpt===hit.excerpt)) continue;
      references.set(hit.id,{id:hit.id,source:hit.label,start:hit.start,end:hit.end,excerpt:hit.excerpt,...(hit.url && {url:hit.url})});
      if (references.size>=4) break;
    }
  }
  if (!references.size) return extract;
  const modelReferences = primary ? new Map([...references.values()].map((ref,index) => [`E${index + 1}`,ref])) : references;
  const passages = [...modelReferences].map(([id,{excerpt}])=>({id,excerpt}));
  const composition = slideComposition(item.layout, false, item.diagramKind);
  const response = composition.schema.extend({ citations });
  const complete = deck.provider === 'alem' ? generate : generateLocal;
  const context = {language:deck.language,outline:item.title,learningTask:item.summary,purpose:item.purpose,section:item.section,layout:item.layout,diagramKind:item.diagramKind,
    bodyWordBudget:layoutWordBudget(item.layout),approvedNarration:item.narrationDraft,preferences,passages};
  let repaired = false;
  async function repair(source:SourceExcerpt) {
    repaired = true;
    const draft = await complete(
      'Use the source excerpt to write a classroom slide in the requested language. Use plain text and short sentences. Preserve the teaching goal. Use no new names, numbers, dates, or quotations. Return exactly this JSON structure: {"title":"short slide title","body":"up to 40 words","notes":"two short teaching sentences"}.',
      {language:deck.language,topic:deck.topic,learningTask:item.summary,preferences,sourceExcerpt:source.excerpt},
      generatedSlideSchema,signal,
    );
    // The recovery request has exactly one source, so the server can attach it directly.
    return {...draft,citations:[passages[0].id]};
  }
  let draft = await complete(
    'Write a classroom slide in the specified language using only the supplied source passages. Keep the title short and body under 45 words. Give spoken teaching notes. Copy numbers, dates, and attributed quotations exactly from the cited passages. ' +
    compositionGuidance + composition.instruction + '\nAlways return a citations array with one to four IDs chosen exactly from passages. ' +
    (primary ? 'Example: "citations":["E1"]. ' : '') + 'Omit unused fields.',
    context,response,signal,
  ).catch(error => {
    if (primary && error instanceof AlemOutputError) return repair(primary);
    throw error;
  });
  let check = checkEvidence(draft,modelReferences);
  if (primary && !repaired && check.unsupported) {
    draft = await repair(primary);
    check = checkEvidence(draft,modelReferences);
  }
  if (check.unsupported) return {...extract,sourceReview:check.review};
  const composed = await completePlannedDiagram(draft,item.diagramKind,
    { ...context, passages:check.evidence.map(({excerpt}) => excerpt) },complete,signal);
  if (composed !== draft) {
    check = checkEvidence(composed,modelReferences);
    if (check.unsupported) return {...extract,sourceReview:check.review};
  }
  const slide = composeDraft(item,composed);
  if (publicSources) slide.notes = [slide.notes,...new Set(check.evidence.map(ref => ref.url))].filter(Boolean).join('\n\n');
  return {...slide,evidence:check.evidence};
}
