import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { compareVersion } from '@sabaq/contracts/language-version';
import type { Deck } from '@sabaq/lesson/types';
import type { StudioAccess } from '../access/access';
import type { MediaRoots } from '../media/powerpoint';
import { ApiError } from '../errors';
import type { Studio } from './studio';
import { relatedVersions, translateLesson } from './translation';

export const languageVersionInput = z.object({baseRevision:z.number().int().min(0),requestId:z.uuid(),language:z.enum(['kk','ru','en'])});
export const languageAlignInput = languageVersionInput.omit({language:true}).extend({sourceId:z.string().min(1).max(160),sourceRevision:z.number().int().min(0)});
type Route = {Params:{id:string}};

export function registerLanguageVersions(app:FastifyInstance,studio:Studio,access:StudioAccess,roots:MediaRoots) {
  const {store} = studio;
  const jobs = new Set<AbortController>();
  app.addHook('preClose',async()=>{for (const job of jobs) job.abort();});
  app.get<Route>('/api/decks/:id/language-versions',async req=>{
    const deck = studio.deck(req.params.id);
    const ids = access.visibleIds(req,false);
    const family = deck.translation?.familyId ?? deck.id;
    const rows = store.db.prepare("SELECT data FROM decks WHERE id=? OR json_extract(data,'$.translation.familyId')=?").all(family,family);
    const candidates = rows.map(row=>JSON.parse(String(row.data)) as Deck).filter(candidate=>!ids || ids.includes(candidate.id));
    if (access.principal(req)?.admin) for (const candidate of candidates) access.require(req,candidate.id,'read');
    const principal = access.principal(req);
    return relatedVersions(deck,candidates).map(version=>({...version,writable:!principal || access.permission(principal,version.id) !== 'view'}));
  });
  const authorize = (req:FastifyRequest,id:string,write:boolean)=>{if (access.enabled) access.require(req,id,write ? 'write' : 'read');};
  app.get<Route>('/api/decks/:id/language-versions/comparison',async req=>{
    const current = studio.deck(req.params.id);
    const link = current.translation;
    if (!link) throw new ApiError(404,'No translation report exists for this lesson.');
    authorize(req,link.sourceDeckId,false);
    const read = store.db.prepare('SELECT data FROM revisions WHERE deck_id=? AND revision=?');
    const source = read.get(link.sourceDeckId,link.sourceRevision), translated = read.get(current.id,0);
    if (!source || !translated) throw new ApiError(404,'The original translation snapshots are unavailable.');
    return compareVersion(JSON.parse(String(source.data)),JSON.parse(String(translated.data)));
  });
  for (const matching of [false,true]) {
    const route = '/api/decks/:id/language-versions' + (matching ? '/align' : '');
    app.post<Route>(route,async(req,reply)=>{
      const params = matching ? languageAlignInput.parse(req.body) : languageVersionInput.parse(req.body);
      const id = req.params.id, owner = access.principal(req);
      const otherId = 'sourceId' in params ? params.sourceId : id;
      authorize(req,otherId,false);
      const receipt = `language-version-${params.requestId}`;
      const signature = JSON.stringify(params);
      const replay = () => {
        const saved = store.operation<{signature:string;id:string}>(id,receipt);
        if (!saved) return;
        if (saved.signature !== signature) throw new ApiError(409,'This translation request was already used.');
        authorize(req,saved.id,false);
        return access.forViewer(req,studio.deck(saved.id));
      };
      const existing = replay();
      if (existing) return existing;
      const current = studio.deck(id), source = studio.deck(otherId);
      if (current.revision !== params.baseRevision || ('sourceRevision' in params && source.revision !== params.sourceRevision))
        throw new ApiError(409,'The lesson changed. Reopen language versions.');
      const release = studio.reserveTranslation(owner);
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(8*60_000)]);
      const disconnected = ()=>{if (!reply.raw.writableEnded) controller.abort();};
      reply.raw.once('close',disconnected);
      jobs.add(controller);
      try {
        const result = await translateLesson(source,'language' in params ? params.language : current.language,roots,signal,matching ? current : undefined);
        if (matching) access.claimEditor(req,id);
        const savedDeck = store.transaction(()=>{
          signal.throwIfAborted();
          authorize(req,id,true); authorize(req,otherId,false);
          const resumed = replay();
          if (resumed) return resumed;
          if (studio.deck(id).revision !== current.revision || studio.deck(otherId).revision !== source.revision)
            throw new ApiError(409,'The lesson changed during translation. Reopen language versions.');
          store.saveRevision(result,matching ? 'Language version structure aligned' : 'Translated lesson');
          if (!matching && owner) store.db.prepare('INSERT INTO deck_owners(deck_id,org,subject) VALUES(?,?,?)').run(result.id,owner.org,owner.subject);
          if(!matching) store.usage.attach(result,owner);
          if (matching) {
            store.appendEvent(result.id,'slide',result.revision);
            queueMicrotask(()=>studio.updates.emit(result.id));
          }
          store.recordOperation(id,receipt,{signature,id:result.id});
          reply.code(matching ? 200 : 201);
          return access.forViewer(req,result);
        });
        if (savedDeck.qualityReview?.state === 'pending') studio.requestQuality(savedDeck.id);
        return savedDeck;
      } finally {
        reply.raw.off('close',disconnected);
        jobs.delete(controller);
        release();
      }
    });
  }
}
