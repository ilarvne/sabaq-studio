import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Locale, ResearchSource, WebResearchMode } from '@sabaq/lesson/types';
import { allowedProviderEndpoint } from '../access/provider-origins';

const endpoint = 'https://api.exa.ai/search';
const sourceLimit = 8;
const copy = {
  en: {
    found: 'I found these web sources.',
    empty: 'I couldn’t find usable web sources for this query. Try a more specific question.',
    unavailable: 'Exa search is unavailable right now. Try again in a moment.',
    rateLimit: 'Exa has reached its request limit. Try again later.',
    timeout: 'The web search took too long. Try a narrower question or use Web search.',
  },
  ru: {
    found: 'Вот найденные источники в интернете.',
    empty: 'По этому запросу не нашлось подходящих источников. Попробуйте уточнить вопрос.',
    unavailable: 'Поиск Exa сейчас недоступен. Повторите попытку чуть позже.',
    rateLimit: 'Достигнут лимит запросов Exa. Попробуйте позже.',
    timeout: 'Поиск занял слишком много времени. Уточните вопрос или выберите обычный веб-поиск.',
  },
  kk: {
    found: 'Интернеттен мына дереккөздер табылды.',
    empty: 'Бұл сұрауға жарамды дереккөздер табылмады. Сұрақты нақтылап көріңіз.',
    unavailable: 'Exa іздеуі қазір қолжетімсіз. Кейінірек қайта көріңіз.',
    rateLimit: 'Exa сұрауларының шегіне жетті. Кейінірек қайта көріңіз.',
    timeout: 'Іздеу тым ұзаққа созылды. Сұрақты нақтылаңыз немесе веб-іздеуді таңдаңыз.',
  },
};

export class WebResearchError extends Error {}
export const exaResearchAvailable = () => Boolean(process.env.EXA_API_KEY?.trim()) && allowedProviderEndpoint(endpoint);
type WebSource = Omit<ResearchSource, 'excerpt'> & { excerpt?: string };

const responseSchema = z.object({ results: z.array(z.unknown()).max(100) });
const sourceSchema = z.object({ title: z.string().nullish(), url: z.string().max(2048), highlights: z.array(z.string()).nullish() });

function oneLine(value: string, limit: number) {
  return [...value.replace(/\s+/gu, ' ').trim()].slice(0, limit).join('');
}

function sourceFrom(value: unknown): WebSource | undefined {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) return;
  const { title, url, highlights } = parsed.data;
  let link: URL;
  try { link = new URL(url); } catch { return; }
  if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) return;
  link.hash = '';
  const href = link.href;
  const excerpt = highlights?.map(highlight => oneLine(highlight, 420)).find(highlight => highlight.length >= 24);
  return {
    id: 'web-' + createHash('sha256').update(href).digest('hex').slice(0, 24),
    title: oneLine(title ?? '', 160) || link.hostname,
    url: href,
    ...(excerpt && { excerpt }),
  };
}

export async function searchExa(query: string, mode: WebResearchMode, locale: Locale, signal: AbortSignal) {
  const words = copy[locale];
  const key = process.env.EXA_API_KEY?.trim();
  if (!key || !allowedProviderEndpoint(endpoint)) throw new WebResearchError(words.unavailable);
  const deep = mode === 'research';
  const deadline = AbortSignal.timeout(deep ? 60_000 : 15_000);
  let payload: z.infer<typeof responseSchema>;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      signal: AbortSignal.any([signal, deadline]),
      body: JSON.stringify({
        query,
        type: deep ? 'deep' : 'auto',
        numResults: deep ? sourceLimit : 5,
        moderation: true,
        contents: { highlights: true },
      }),
    });
    if (!response.ok) throw new WebResearchError(response.status === 429 ? words.rateLimit : words.unavailable);
    payload = responseSchema.parse(await response.json());
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof WebResearchError) throw error;
    throw new WebResearchError(deadline.aborted ? words.timeout : words.unavailable);
  }

  const hits = new Map<string, WebSource>();
  for (const value of payload.results) {
    const source = sourceFrom(value);
    if (source && !hits.has(source.url)) hits.set(source.url, source);
    if (hits.size === sourceLimit) break;
  }
  const sources = [...hits.values()];
  return { sources, notice:sources.length ? words.found : words.empty };
}
