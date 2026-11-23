import { z } from 'zod';
import type { LessonCitation, LessonSearchResult } from '@sabaq/contracts/retrieval';
import type { Deck } from '@sabaq/lesson/types';
import { alemEmbedder, alemEmbeddingModel, rerankWithAlem } from './alem-retrieval';
import { findLocalModel, loopbackService } from './local-model';
import { lessonPassages } from './lesson-passages';
import type { StudioStore } from '../persistence/storage';

const initialized = new WeakSet<StudioStore>();
const indexFormat = 2;
const candidateLimit = 32;
const embeddingBatchSize = 24;

function initialize(store: StudioStore) {
  if (initialized.has(store)) return;
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS lesson_search_state (
      deck_id TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE, revision INTEGER NOT NULL, format INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lesson_passages (
      rowid INTEGER PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, field TEXT NOT NULL, slide_id TEXT, url TEXT,
      start INTEGER NOT NULL, end INTEGER NOT NULL, excerpt TEXT NOT NULL,
      model_digest TEXT, vector BLOB, UNIQUE(deck_id,id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS lesson_passages_fts USING fts5(
      excerpt, content='lesson_passages', content_rowid='rowid', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS lesson_passages_insert AFTER INSERT ON lesson_passages BEGIN
      INSERT INTO lesson_passages_fts(rowid,excerpt) VALUES(new.rowid,new.excerpt);
    END;
    CREATE TRIGGER IF NOT EXISTS lesson_passages_delete AFTER DELETE ON lesson_passages BEGIN
      INSERT INTO lesson_passages_fts(lesson_passages_fts,rowid,excerpt) VALUES('delete',old.rowid,old.excerpt);
    END;
  `);
  initialized.add(store);
}

function syncPassages(store: StudioStore, deck: Deck) {
  const state = store.db.prepare('SELECT revision,format FROM lesson_search_state WHERE deck_id=?').get(deck.id);
  if (state?.revision === deck.revision && state.format === indexFormat) return;
  if (state && Number(state.revision) > deck.revision) throw new Error('The lesson changed during retrieval.');
  const existing = new Set(store.db.prepare('SELECT id FROM lesson_passages WHERE deck_id=?').all(deck.id).map(row=>row.id));
  const write = store.db.prepare(`INSERT INTO lesson_passages(deck_id,id,kind,label,field,slide_id,start,end,excerpt,url)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(deck_id,id) DO UPDATE SET label=excluded.label,url=excluded.url
    WHERE label<>excluded.label OR url IS NOT excluded.url`);
  for (const hit of lessonPassages(deck)) {
    write.run(deck.id,hit.id,hit.kind,hit.label,hit.field,hit.slideId ?? null,hit.start,hit.end,hit.excerpt,hit.url ?? null);
    existing.delete(hit.id);
  }
  const remove = store.db.prepare('DELETE FROM lesson_passages WHERE deck_id=? AND id=?');
  for (const id of existing) remove.run(deck.id,id);
  store.db.prepare(`INSERT INTO lesson_search_state(deck_id,revision,format) VALUES(?,?,?)
    ON CONFLICT(deck_id) DO UPDATE SET revision=excluded.revision,format=excluded.format`).run(deck.id,deck.revision,indexFormat);
}

const stopWords = new Set(`a an the is are was were be of at to by on and or in with it we my me your this that for from can do does did how what where when which who why would could show find search tell please lesson slide source document says
и или в во с из на от что как где когда какой какая какие по у о об это для ли мне мой моя про найти найди слайд урок источник документ пожалуйста
мен пен бен да де та те не бұл ол қай қалай қандай неге туралы үшін ма ме ба бе па пе сабақ слайд дереккөз құжат`.split(/\s+/u));

export function passageQueryExpression(query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(words.filter(word=>!stopWords.has(word)))].slice(0,32);
  return terms.map(word=>{
    // A prefix preserves common case/number suffix variants in Russian and Kazakh.
    if (/^\p{Script=Cyrillic}{6,}$/u.test(word)) return `"${word.slice(0,-2)}"*`;
    return `"${word}"`;
  }).join(' OR ');
}

type PassageRow = Omit<LessonCitation,'slideId' | 'url'> & {slideId: string | null; url: string | null};
const projection = 'p.id,p.kind,p.label,p.field,p.slide_id AS slideId,p.url,p.start,p.end,p.excerpt';
function citation(row: PassageRow): LessonCitation {
  const {slideId,url,...hit} = row;
  return {...hit,...(slideId && {slideId}),...(url && {url})};
}

const embeddings = z.object({embeddings:z.array(z.array(z.number().finite()).min(1).max(16384)).max(embeddingBatchSize)});

async function embedLocally(origin: URL, model: string, input: string[], signal: AbortSignal) {
  const response = await fetch(new URL('/api/embed',origin),{
    method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model,input,truncate:true,options:{num_ctx:1024,num_thread:4}}),
  });
  if (!response.ok) throw new Error('Embedding worker unavailable.');
  return embeddings.parse(await response.json()).embeddings;
}

type Embed = (input: string[], signal: AbortSignal) => Promise<number[][]>;

async function semanticRanking(store: StudioStore, deck: Deck, query: string, digest: string, embed: Embed, signal: AbortSignal) {
  const encode = async (input: string[])=>{
    const vectors = await embed(input,signal);
    if (vectors.length !== input.length) throw new Error('Embedding count mismatch.');
    return vectors.map(vector=>{
      const norm = Math.sqrt(vector.reduce((sum,value)=>sum + value * value,0));
      if (!Number.isFinite(norm) || !norm) throw new Error('Invalid embedding norm.');
      return Float32Array.from(vector,value=>value / norm);
    });
  };
  const [needle] = await encode([query]);
  const pending = store.db.prepare(`SELECT id,excerpt FROM lesson_passages WHERE deck_id=? AND (model_digest IS NOT ? OR vector IS NULL)`)
    .all(deck.id,digest) as {id:string;excerpt:string}[];
  const save = store.db.prepare('UPDATE lesson_passages SET model_digest=?,vector=? WHERE deck_id=? AND id=?');
  for (let i=0;i<pending.length;i+=embeddingBatchSize) {
    const batch = pending.slice(i,i+embeddingBatchSize);
    const vectors = await encode(batch.map(row=>row.excerpt));
    if (vectors.some(vector=>vector.length !== needle.length)) throw new Error('Incompatible embedding dimensions.');
    // Content-bound IDs prevent an in-flight result from overwriting an edited passage.
    store.transaction(()=>batch.forEach((row,index)=>save.run(digest,Buffer.from(vectors[index].buffer),deck.id,row.id)));
  }
  const rows = store.db.prepare(`SELECT ${projection},p.vector FROM lesson_passages p WHERE p.deck_id=? AND p.model_digest=?`)
    .all(deck.id,digest) as unknown as (PassageRow & {vector:Uint8Array})[];
  return rows.flatMap(({vector,...row})=>{
    if (vector.byteLength !== needle.byteLength) return [];
    const values = new Float32Array(Uint8Array.from(vector).buffer);
    let score = 0;
    for (let i=0;i<needle.length;i++) score += needle[i] * values[i];
    return score >= 0.42 ? [{hit:citation(row),score}] : [];
  }).sort((a,b)=>b.score - a.score || a.hit.id.localeCompare(b.hit.id)).slice(0,candidateLimit).map(item=>item.hit);
}

async function denseHits(store: StudioStore, deck: Deck, query: string, signal: AbortSignal, allowAlem?: boolean) {
  const budget = AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  const alem = allowAlem && alemEmbedder();
  if (alem) {
    try { return await semanticRanking(store,deck,query,`alem:${alemEmbeddingModel}`,alem,budget); }
    catch { signal.throwIfAborted(); }
  }
  const model = process.env.STUDIO_EMBEDDING_MODEL?.trim();
  const origin = loopbackService(process.env.STUDIO_EMBEDDING_URL || process.env.STUDIO_OLLAMA_URL || 'http://127.0.0.1:11434');
  if (!model || !origin || budget.aborted) return;
  // Inspect the installed tag before transmitting text. A local Ollama daemon can also host cloud aliases.
  const tag = await findLocalModel(origin,model,budget);
  if (!tag) return;
  const queryText = /^qwen3-embedding(?::|$)/i.test(tag.name)
    ? 'Instruct: Given a classroom question, retrieve passages from a lesson that answer it.\nQuery: ' + query
    : query;
  return semanticRanking(store,deck,queryText,tag.digest,(input,signal)=>embedLocally(origin,tag.name,input,signal),budget);
}

/** Search one revision of one lesson. Both ranked lists contain only server-derived passages. */
export async function searchLesson(store: StudioStore, deck: Deck, query: string, signal: AbortSignal, limit = 5,
  {allowAlem = false}: {allowAlem?: boolean} = {}): Promise<LessonSearchResult> {
  signal.throwIfAborted();
  const text = query.trim().slice(0,6000);
  const expression = passageQueryExpression(text);
  if (!expression) return {mode:'lexical',hits:[]};
  initialize(store);
  const lexical = store.transaction(()=>{
    syncPassages(store,deck);
    const rows = store.db.prepare(`SELECT ${projection} FROM lesson_passages_fts JOIN lesson_passages p ON p.rowid=lesson_passages_fts.rowid
      WHERE lesson_passages_fts MATCH ? AND p.deck_id=? ORDER BY rank,p.rowid LIMIT ?`)
      .all(expression,deck.id,candidateLimit) as unknown as PassageRow[];
    return rows.map(citation);
  });
  let semantic: LessonCitation[] | undefined;
  try { semantic = await denseHits(store,deck,text,signal,allowAlem); }
  catch { signal.throwIfAborted(); } // Missing, slow, or incompatible workers leave the local text search usable.
  signal.throwIfAborted();
  const scores = new Map<string,{hit:LessonCitation;score:number}>();
  for (const ranking of [lexical,semantic ?? []]) {
    ranking.forEach((hit,index)=>{
      const item = scores.get(hit.id) ?? {hit,score:0};
      item.score += 1 / (60 + index + 1);
      scores.set(hit.id,item);
    });
  }
  const candidates: LessonCitation[] = [];
  const hitLimit = Math.min(8,Math.max(1,limit));
  const shortlistLimit = allowAlem ? candidateLimit : hitLimit;
  const seen = new Set<string>();
  for (const {hit} of [...scores.values()].sort((a,b)=>b.score - a.score)) {
    if (seen.has(hit.excerpt)) continue;
    candidates.push(hit);
    seen.add(hit.excerpt);
    if (candidates.length >= shortlistLimit) break;
  }
  let reranked: LessonCitation[] | undefined;
  if (allowAlem) {
    try { reranked = await rerankWithAlem(text,candidates,hitLimit,signal); }
    catch { signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  const current = store.db.prepare('SELECT revision FROM lesson_search_state WHERE deck_id=?').get(deck.id);
  if (current?.revision !== deck.revision) throw new Error('The lesson changed during retrieval.');
  return {mode:semantic ? 'hybrid' : 'lexical',hits:reranked ?? candidates.slice(0,hitLimit)};
}
