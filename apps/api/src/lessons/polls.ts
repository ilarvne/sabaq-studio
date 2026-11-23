import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ClassroomPoll, ClassroomQuestion } from '@sabaq/contracts/poll';
import { ApiError } from '../errors';
import type { Studio } from './studio';

const prompt = z.strictObject({
  kind:z.enum(['poll','quiz','words']), question:z.string().trim().min(1).max(220),
  options:z.array(z.string().trim().min(1).max(80)).min(2).max(12),
  correct:z.number().int().nonnegative().optional(),
}).refine(input => new Set(input.options).size === input.options.length &&
  (input.kind === 'quiz' ? input.correct !== undefined && input.correct < input.options.length : input.correct === undefined));
const vote = z.strictObject({choice:z.number().int().nonnegative()});
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nextCode = () => [...randomBytes(8)].map(byte => alphabet[byte & 31]).join('');
const lifetime = 60 * 60 * 1000;
type Session = { deckId:string; stats:ClassroomPoll; key:Buffer; ballots:Map<string,number> };
type DeckRoute = {Params:{id:string}};
type CodeRoute = {Params:{code:string}};
const signature = (key:Buffer, id:string) => createHmac('sha256',key).update(id).digest('base64url');
function voter(req:FastifyRequest, key:Buffer) {
  const cookie = /(?:^|;\s*)sabaq_ballot=([a-f0-9]{32})\.([\w-]{43})(?:;|$)/u.exec(req.headers.cookie ?? '');
  return cookie && timingSafeEqual(Buffer.from(cookie[2]),Buffer.from(signature(key,cookie[1]))) ? cookie[1] : undefined;
}

export function registerPolls(app:FastifyInstance, studio:Studio) {
  const active = new Map<string,Session>();
  const prune = () => { for (const [code,session] of active) if (session.stats.expires <= Date.now()) active.delete(code); };
  const timer = setInterval(prune,60000);
  timer.unref();
  app.addHook('onClose', async () => {clearInterval(timer);active.clear();});
  const forDeck = (deckId:string) => {prune();return [...active.values()].find(s => s.deckId===deckId);};
  const byCode = (code:string) => {
    prune();
    const session = active.get(code);
    if (!session) throw new ApiError(404,'This poll has ended or the code is incorrect.');
    return session;
  };
  app.get<DeckRoute>('/api/decks/:id/poll', async req => ({poll:forDeck(req.params.id)?.stats ?? null}));
  app.post<DeckRoute>('/api/decks/:id/poll', async (req,reply) => {
    const input = prompt.parse(req.body);
    const deck = studio.deck(req.params.id);
    if (forDeck(deck.id)) throw new ApiError(409,'Close the current poll before starting another.');
    if (active.size >= 256) throw new ApiError(429,'All classroom polling rooms are in use.');
    let code = nextCode();
    while (active.has(code)) code = nextCode();
    const stats:ClassroomPoll = {...input, language:deck.language, code, expires:Date.now()+lifetime, counts:input.options.map(()=>0)};
    active.set(code,{deckId:deck.id,stats,key:randomBytes(32),ballots:new Map()});
    return reply.code(201).send(stats);
  });
  app.delete<DeckRoute>('/api/decks/:id/poll', async (req,reply) => {
    const current = forDeck(req.params.id);
    if (current) active.delete(current.stats.code);
    return reply.code(204).send();
  });
  app.get<CodeRoute>('/api/classroom-polls/:code', async (req,reply) => {
    const session = byCode(req.params.code);
    let id = voter(req,session.key);
    if (!id) {
      id = randomBytes(16).toString('hex');
      const value = id+'.'+signature(session.key,id);
      const secure = req.protocol==='https' ? '; Secure' : '';
      reply.header('Set-Cookie','sabaq_ballot='+value+'; Path=/api/classroom-polls/'+session.stats.code+
        '; HttpOnly; SameSite=Strict; Max-Age=3600'+secure);
    }
    const {kind,question,language,options}:ClassroomQuestion = session.stats;
    return {kind,question,language,options,choice:session.ballots.get(id) ?? null};
  });
  app.post<CodeRoute>('/api/classroom-polls/:code', {bodyLimit:512}, async (req,reply) => {
    const session = byCode(req.params.code);
    const id = voter(req,session.key);
    if (!id) throw new ApiError(403,'Open the classroom question before answering.');
    const {choice} = vote.parse(req.body);
    if (choice>=session.stats.options.length) throw new ApiError(400,'Select an available answer.');
    const previous = session.ballots.get(id);
    if (previous === undefined && session.ballots.size >= 300) throw new ApiError(429,'This classroom is full.');
    if (previous !== choice) {
      if (previous !== undefined) session.stats.counts[previous]--;
      session.stats.counts[choice]++;
      session.ballots.set(id,choice);
    }
    return reply.send({choice});
  });
}
