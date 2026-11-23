import { z } from 'zod';
import type { LessonCitation } from '@sabaq/contracts/retrieval';
import { allowedProviderEndpoint } from '../access/provider-origins';
import { readBounded } from '../media/bounded-response';

const embedUrl = new URL('https://llm.alem.ai/v1/embeddings');
const rerankUrl = new URL('https://llm.alem.ai/v1/rerank');
export const alemEmbeddingModel = 'text-1024';
const vectorSchema = z.array(z.number().finite()).length(1024);
const embedResponse = z.object({data:z.array(z.object({index:z.number().int().nonnegative(),embedding:vectorSchema}))});
const rerankResponse = z.object({results:z.array(z.object({
  index:z.number().int().nonnegative(),relevance_score:z.number().finite(),
}))});

async function post(url: URL, key: string, payload: object, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const response = await fetch(url,{
    method:'POST',redirect:'error',signal,
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Alem retrieval request failed (${response.status}).`);
  }
  const content = await readBounded(response,maxBytes);
  if (!content) throw new Error('Invalid Alem retrieval response size.');
  return JSON.parse(content.toString('utf8'));
}

export function alemEmbedder() {
  const key = process.env.ALEM_EMBEDDINGS_API_KEY?.trim();
  if (!key || !allowedProviderEndpoint(embedUrl.href)) return;
  return async (input: string[], signal: AbortSignal) => {
    const payload = {model:alemEmbeddingModel,input:input.length === 1 ? input[0] : input};
    const {data} = embedResponse.parse(await post(embedUrl,key,payload,signal,1024 * 1024));
    const sorted = data.sort((a,b)=>a.index - b.index);
    if (sorted.length !== input.length || sorted.some((entry,index)=>entry.index !== index)) {
      throw new Error('Alem returned invalid embedding indexes.');
    }
    return sorted.map(entry=>entry.embedding);
  };
}

export async function rerankWithAlem(query: string, hits: LessonCitation[], limit: number, signal: AbortSignal) {
  const key = process.env.ALEM_RERANK_API_KEY?.trim();
  if (hits.length < 2 || !key || !allowedProviderEndpoint(rerankUrl.href)) return;
  const topN = Math.min(limit,hits.length);
  const budget = AbortSignal.any([signal,AbortSignal.timeout(5000)]);
  const payload = {model:'reranker',query,documents:hits.map(hit=>hit.excerpt),top_n:topN};
  const {results} = rerankResponse.parse(await post(rerankUrl,key,payload,budget,256 * 1024));
  if (results.length !== topN || new Set(results.map(result=>result.index)).size !== topN ||
    results.some(result=>result.index >= hits.length)) throw new Error('Alem returned invalid reranking indexes.');
  return results.sort((a,b)=>b.relevance_score - a.relevance_score || a.index - b.index)
    .map(result=>hits[result.index]);
}
