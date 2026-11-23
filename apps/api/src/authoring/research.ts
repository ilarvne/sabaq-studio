import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GenerationHttpError } from './generation-retry';
import { allowedProviderEndpoint } from '../access/provider-origins';
import { isTemplate, templatePlan } from '@sabaq/lesson/lesson-templates';
import type { Deck, Locale, OutlineItem, ResearchSource, Slide, SourceExcerpt } from '@sabaq/lesson/types';

const copy = {
  en: { source: 'Public sources', opening: 'Read the sources and identify the main question.', closing: 'Compare the evidence', question: 'Which source best supports your conclusion? Explain your choice.' },
  ru: { source: 'Открытые источники', opening: 'Прочитайте источники и сформулируйте основной вопрос.', closing: 'Сравнение источников', question: 'Какой источник лучше подтверждает ваш вывод? Объясните выбор.' },
  kk: { source: 'Ашық дереккөздер', opening: 'Дереккөздерді оқып, негізгі сұрақты тұжырымдаңыз.', closing: 'Деректерді салыстыру', question: 'Қай дереккөз қорытындыңызды жақсырақ дәлелдейді? Таңдауыңызды түсіндіріңіз.' },
};
const defaultTopics = [
  'Water cycle evaporation and condensation', 'Seed germination and plant growth',
  'Круговорот воды в природе', 'Прорастание семян растений',
  'Табиғаттағы су айналымы', 'Өсімдік тұқымының өнуі',
];

// Only the operator's public vocabulary can cross the search boundary.
export function researchCapabilities() {
  const provider = process.env.STUDIO_RESEARCH_PROVIDER;
  const enabled = (provider === 'exa' && Boolean(process.env.EXA_API_KEY?.trim())) ||
    (provider === 'searxng' && allowedProviderEndpoint(process.env.STUDIO_SEARCH_URL));
  const topics = (process.env.STUDIO_RESEARCH_TOPICS?.split('|') ?? defaultTopics)
    .map(query => query.trim()).filter(query => query && query.length <= 200);
  return enabled ? [...new Set(topics)] : [];
}

const searchEnvelope = z.object({ results: z.array(z.unknown()).max(200) });
const hit = z.object({ title: z.string().trim().min(1), url: z.string(), highlights: z.array(z.string()).optional(), content: z.string().optional() });
function publicUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url.href;
  } catch { return; }
}
export async function retrievePublicSources(query: string, signal: AbortSignal): Promise<ResearchSource[]> {
  if (!researchCapabilities().includes(query)) throw new Error('The public query is unavailable.');
  const external = process.env.STUDIO_RESEARCH_PROVIDER === 'exa';
  const endpoint = external ? 'https://api.exa.ai/search' : process.env.STUDIO_SEARCH_URL!;
  const request: RequestInit = external
    ? { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXA_API_KEY! }, body: JSON.stringify({ query, numResults: 6, contents: { highlights: true } }) }
    : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ q: query, format: 'json' }) };
  const response = await fetch(endpoint, { ...request, method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]) });
  if (!response.ok) throw new GenerationHttpError(response.status,'Public search',response.headers.get('retry-after'));
  const results: ResearchSource[] = [];
  for (const value of searchEnvelope.parse(await response.json()).results) {
    const result = hit.safeParse(value);
    if (!result.success) continue;
    const { title, url, highlights, content } = result.data;
    const link = publicUrl(url);
    const passage = (external ? highlights?.find(text => text.trim().length >= 30) : content)?.trim();
    if (!link || !passage || passage.length < 30 || results.some(item => item.url === link)) continue;
    const excerpt = [...passage.replace(/\s+/gu, ' ')].slice(0, 520).join('');
    const key = createHash('sha256').update(link).digest('hex').slice(0, 24);
    results.push({ id: 'web-' + key, title: [...title].slice(0, 140).join(''), url: link, excerpt });
    if (results.length === 6) break;
  }
  if (!results.length) throw new Error('No citable sources were returned.');
  return results;
}

export function researchDocument(locale: Locale, sources: ResearchSource[]) {
  return { name: copy[locale].source, text: sources.map(source => source.excerpt).join('\n\n') };
}
export function researchOutline(deck: Deck, sources: ResearchSource[], count = sources.length + 2): OutlineItem[] {
  const t = copy[deck.language];
  const opening:OutlineItem = { id:'web-opening', title:deck.topic, summary:t.opening, purpose:t.opening, layout:'cover' };
  if (count <= 2) opening.sourceExcerptId = sources[0]?.id;
  if (count === 1) return [opening];
  const structure = templatePlan(isTemplate(deck.template) ? deck.template : 'archive', deck.language, deck.topic, count);
  const body = structure.slice(1,-1).map((stage, index):OutlineItem => {
    const source = sources[index % sources.length];
    return index < sources.length
      ? { id:source.id, title:source.title, summary:source.excerpt, purpose:source.excerpt.slice(0,400), layout:'quote' }
      : { ...stage, id:'web-activity-' + (index + 1), sourceExcerptId:source.id };
  });
  return [opening, ...body, { id:'web-reflection', title:t.closing, summary:t.question, purpose:t.question, layout:'body', assessment:true }];
}
export function researchSlide(deck: Deck, item: OutlineItem): Partial<Slide> {
  const sources = deck.research?.sources ?? [];
  let start = 0;
  for (const source of sources) {
    const end = start + [...source.excerpt].length;
    if ((item.sourceExcerptId ?? item.id) === source.id) {
      const evidence: SourceExcerpt = { id: source.id, source: source.title, url: source.url, start, end, excerpt: source.excerpt };
      return { title: item.title, body: item.summary, evidence: [evidence], notes: source.excerpt + '\n\n' + source.url };
    }
    start = end + 2;
  }
  return { title: item.title, body: item.summary, notes: item.summary };
}
