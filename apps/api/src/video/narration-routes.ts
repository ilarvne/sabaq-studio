import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { spokenNarration } from '@sabaq/lesson/narration';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';
import { elevenLabsVoice, synthesizeElevenLabs } from './elevenlabs';

const MAX_CACHED_BYTES = 12_000_000;
export const narrationPreviewInput = z.object({ version: z.number().int().nonnegative() }).strict();

export function registerNarration(app: FastifyInstance, studio: Studio) {
  const cache = new Map<string, Buffer>();
  const pending = new Map<string, Promise<Buffer>>();
  let cachedBytes = 0;

  app.get<{ Params: { id: string } }>('/api/decks/:id/narration', req => {
    studio.deck(req.params.id);
    return { enabled: !!elevenLabsVoice() };
  });
  app.post<{ Params: { id: string; slideId: string } }>('/api/decks/:id/narration/:slideId', async (req, reply) => {
    const voice = elevenLabsVoice();
    if (!voice) throw new ApiError(503, 'Hosted narration is unavailable.');
    const { version } = narrationPreviewInput.parse(req.body);
    const deck = studio.deck(req.params.id);
    const slide = deck.slides.find(candidate => candidate.id === req.params.slideId && candidate.status === 'ready');
    if (!slide) throw new ApiError(404, 'Slide is unavailable.');
    if (slide.version !== version) throw new ApiError(409, 'Wait until the speaker notes are saved.');
    const text = spokenNarration(slide.notes.trim(), deck.language);
    if (!text || text.length > 5000) throw new ApiError(422, 'Add speaker notes of up to 5,000 spoken characters.');
    const key = createHash('sha256').update(JSON.stringify([deck.id, slide.id, voice.voiceId, deck.language, text])).digest('hex');
    let audio = cache.get(key);
    if (!audio) {
      let job = pending.get(key);
      if (!job) {
        if (pending.size >= 3) throw new ApiError(429, 'Narration is busy. Try again shortly.');
        job = synthesizeElevenLabs({ ...voice, text, language: deck.language }).then(result => {
          while (cachedBytes + result.length > MAX_CACHED_BYTES && cache.size) {
            const [oldKey, oldAudio] = cache.entries().next().value!;
            cache.delete(oldKey);
            cachedBytes -= oldAudio.length;
          }
          cache.set(key, result);
          cachedBytes += result.length;
          return result;
        }).finally(() => pending.delete(key));
        pending.set(key, job);
      }
      audio = await job.catch(() => { throw new ApiError(502, 'ElevenLabs could not generate narration.'); });
    }
    return reply.type('audio/mpeg').header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').send(audio);
  });
}
