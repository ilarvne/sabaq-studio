import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { AssistantSnapshot } from '@sabaq/contracts/assistant';
import { z } from 'zod';
import type { StudioAccess } from '../access/access';
import { assistantCancelInput, assistantInput, type DeckAssistant } from './assistant';
import { assistantMemoryInput } from './assistant-memory';

const decideInput = z.object({action:z.enum(['apply','dismiss','restore'])});
type DeckRoute = { Params: { id: string } };

export function registerAssistantRoutes(app: FastifyInstance, assistant: DeckAssistant, access: StudioAccess) {
  app.get<DeckRoute>('/api/decks/:id/assistant', async (req) => assistant.get(req.params.id,access.principal(req)));
  app.get<DeckRoute>('/api/decks/:id/assistant/memory', async (req) => assistant.memory.list(req.params.id));
  app.post<DeckRoute>('/api/decks/:id/assistant/memory', async (req) =>
    assistant.memory.add(req.params.id,assistantMemoryInput.parse(req.body).text),
  );
  app.delete<{Params:{id:string;memoryId:string}}>('/api/decks/:id/assistant/memory/:memoryId', async (req) =>
    assistant.memory.remove(req.params.id,req.params.memoryId),
  );
  app.post<DeckRoute>('/api/decks/:id/assistant', async (req, reply) => {
    const {events,disconnect} = assistant.open(req.params.id,assistantInput.parse(req.body),access.principal(req));
    const output = new PassThrough({highWaterMark: 64 * 1024});
    let latest: AssistantSnapshot | undefined;
    let blocked = false;
    let finished = false;

    const authorized = () => {
      try {
        access.require(req,req.params.id,'write',false);
        return true;
      } catch {
        disconnect();
        latest = undefined;
        output.end();
        return false;
      }
    };
    const flush = () => {
      if (output.destroyed || output.writableEnded || blocked) return;
      if (latest && authorized()) {
        const line = JSON.stringify(latest) + '\n';
        latest = undefined;
        blocked = !output.write(line);
      }
      if (finished && !latest && !output.writableEnded) output.end();
    };
    output.on('drain', () => {
      blocked = false;
      flush();
    });
    reply.raw.once('close', () => {
      latest = undefined;
      output.destroy();
    });

    async function publish() {
      try {
        for await (const event of events) {
          if (!authorized()) break;
          if (!output.destroyed) {
            // Each event is a complete snapshot. A slow socket only needs the latest one.
            latest = event;
            flush();
          }
        }
      } catch (error) {
        req.log.error({err:error}, 'Assistant snapshot stream failed');
        output.destroy(error instanceof Error ? error : undefined);
      } finally {
        disconnect();
        finished = true;
        flush();
      }
    }
    const response = reply.header('X-Accel-Buffering','no').type('application/x-ndjson; charset=utf-8').send(output);
    // Provider work persists on the server when a browser leaves the response stream.
    void publish();
    return response;
  });
  app.post<DeckRoute>('/api/decks/:id/assistant/cancel', async (req) =>
    assistant.cancel(req.params.id,assistantCancelInput.parse(req.body).clientId,access.principal(req)),
  );
  app.post<{ Params: { id: string; pid: string } }>('/api/decks/:id/assistant/proposals/:pid', async (req,reply) => {
    const {conflict,snapshot}=assistant.decide(req.params.id,req.params.pid,decideInput.parse(req.body).action,access.principal(req));
    return reply.code(conflict ? 409 : 200).send(snapshot);
  });
}
