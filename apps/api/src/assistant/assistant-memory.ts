import { z } from 'zod';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';

const maxEntries = 12;
const maxRecalled = 8;
export const assistantMemoryInput = z.object({text:z.string().trim().min(1).max(400)});
const recallSchema = z.object({ids:z.array(z.string()).max(maxRecalled)});

export { findLocalModel, loopbackService } from './local-model';
import { loopbackService } from './local-model';

export class AssistantMemory {
  private syncing = new Map<string, Promise<unknown>>();

  constructor(private studio: Studio) {}

  list(deckId: string) {
    this.studio.deck(deckId);
    return {memory:this.studio.store.assistantMemory(deckId)};
  }

  add(deckId: string, text: string) {
    return this.studio.store.transaction(()=>{
      const current = this.list(deckId);
      if (current.memory.some(entry=>entry.text === text)) return current;
      if (current.memory.length >= maxEntries) throw new ApiError(422,'Remove a preference before adding another.');
      this.studio.store.saveAssistantMemory(deckId,{id:crypto.randomUUID(),text,createdAt:new Date().toISOString()});
      return this.list(deckId);
    });
  }

  async remove(deckId: string, id: string) {
    this.studio.deck(deckId);
    this.studio.store.removeAssistantMemory(deckId,id);
    await this.index(deckId);
    return this.list(deckId);
  }

  async recall(deckId: string, query: string, signal: AbortSignal) {
    if (this.list(deckId).memory.length === 0) return [];
    const ids = await this.index(deckId,query,signal);
    const current = this.list(deckId).memory;
    signal.throwIfAborted();
    const tokens = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const rank = (entry:typeof current[number]) => {
      const semantic = ids.indexOf(entry.id);
      if (semantic >= 0) return 1000-semantic;
      const words = new Set(entry.text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
      return [...words].filter(word=>tokens.has(word)).length;
    };
    return current.sort((a,b)=>rank(b)-rank(a)).slice(0,maxRecalled).map(entry=>entry.text);
  }

  private async index(deckId: string, query?: string, signal?: AbortSignal): Promise<string[]> {
    const origin = loopbackService(process.env.STUDIO_MEM0_URL);
    if (!origin) return [];
    const previous = this.syncing.get(deckId);
    const work = (async()=>{
      await previous;
      if (signal?.aborted) return [];
      try {
        const timeout = AbortSignal.timeout(query ? 7000 : 2000);
        const response = await fetch(new URL('/recall',origin),{
          method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
          signal:signal ? AbortSignal.any([timeout,signal]) : timeout,
          body:JSON.stringify({scope:deckId,entries:this.list(deckId).memory,query}),
        });
        if (!response.ok) return [];
        const result = recallSchema.safeParse(await response.json());
        return result.success ? result.data.ids : [];
      } catch {
        return [];
      }
    })();
    this.syncing.set(deckId,work);
    try { return await work; }
    finally { if (this.syncing.get(deckId) === work) this.syncing.delete(deckId); }
  }
}
