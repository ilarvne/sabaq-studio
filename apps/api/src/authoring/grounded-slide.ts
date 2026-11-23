import { z } from 'zod';
import type { CreateInput, Deck, OutlineItem, Slide, SourceExcerpt } from '@sabaq/lesson/types';
import { compositionGuidance, lessonSlideSchema } from './alem';
import { composeDraft } from './compose';
import { unsupportedClaims } from '@sabaq/agent/evidence';
import { searchLesson } from '../assistant/lesson-retrieval';
import { fixtureSlide } from './lessons';
import { generateLocal } from './local-generation';
import type { StudioStore } from '../persistence/storage';

const response = lessonSlideSchema.omit({illustration:true}).extend({ citations:z.array(z.string().max(80)).min(1).max(4) });

export async function groundedSlide(store:StudioStore, deck:Deck, item:OutlineItem, index:number, preferences:CreateInput['answers'], signal:AbortSignal):Promise<Partial<Slide>> {
  const extract = fixtureSlide(deck,item,index,preferences);
  const references = new Map<string,SourceExcerpt>((extract.evidence ?? []).map(e => [e.id,e]));
  const found = await searchLesson(store,deck,[item.title,item.summary].join(' '),signal,8);
  for (const hit of found.hits) {
    if (hit.kind !== 'source' || [...references.values()].some(ref=>ref.excerpt===hit.excerpt)) continue;
    references.set(hit.id,{id:hit.id,source:hit.label,start:hit.start,end:hit.end,excerpt:hit.excerpt,...(hit.url && {url:hit.url})});
    if (references.size>=4) break;
  }
  if (!references.size) return extract;
  const draft = await generateLocal(
    'Write a classroom slide in the specified language using only the supplied source passages. Keep the title short and body under 45 words. Give spoken teaching notes. Copy numbers, dates, and attributed quotations exactly from the cited passages. ' +
    compositionGuidance + ' Return title, body, notes and citations (an array of source IDs used). Optional content fields are table ({headers,rows}), chart ({categories,series:[{name,values}],alt}), diagram ({kind,nodes,alt}), cards ([{title,text}], max 3), numbered, eyebrow, takeaway and answer. Omit unused fields.',
    {language:deck.language,outline:item.title,learningTask:item.summary,purpose:item.purpose,section:item.section,layout:item.layout,approvedNarration:item.narrationDraft,preferences,
      passages:[...references.values()].map(({id,excerpt})=>({id,excerpt}))},response,signal,
  );
  const evidence = [...new Set(draft.citations)].map(id=>references.get(id)).filter((ref):ref is SourceExcerpt=>Boolean(ref));
  const {title,body,notes,eyebrow,takeaway,cards,answer,table,chart,diagram}=draft;
  const projectedContent=[
    title,body,notes,eyebrow,takeaway,answer,...(cards ?? []).flatMap(card=>[card.title,card.text]),
    ...(table?.headers ?? []),...(table?.rows.flat() ?? []),...(chart?.categories ?? []),chart?.alt,
    ...(chart?.series ?? []).flatMap(series=>[series.name,...series.values]),...(diagram?.nodes ?? []),diagram?.alt,
  ];
  const gaps = unsupportedClaims(projectedContent.filter(value=>value!==undefined).join('\n'),evidence.map(ref=>ref.excerpt));
  const unknownCitations = new Set(draft.citations).size - evidence.length;
  if (gaps.numbers.length || gaps.quotations || unknownCitations) return {...extract,sourceReview:{...gaps,unknownCitations}};
  return {...composeDraft(item,draft),evidence};
}
