import type { FastifyInstance } from 'fastify';
import { z, type ZodType } from 'zod';
import { createInput, editInput, proposeInput, retryInput, slideSymbolInput } from '@sabaq/contracts/schema';
import { assistantCancelInput, assistantInput } from './assistant/assistant';
import { assistantMemoryInput } from './assistant/assistant-memory';
import { classroomCodeRoute, commentInput, deckRouteAction, grantInput } from './access/access';
import { exportJobInput } from './media/export-jobs';
import { biometricEnrollmentInput, videoStartInput } from './video/video';
import { narrationPreviewInput } from './video/narration-routes';
import { languageAlignInput, languageVersionInput } from './lessons/language-version-routes';

const revision = { type: 'integer', minimum: 0 };
const binaries = ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/pdf', 'image/png'];
type Parameter = { name: string; in: 'path' | 'query' | 'header'; required?: boolean; schema: object };
type Description = {
  summary: string; body?: ZodType | 'binary'; status?: number; parameters?: Parameter[];
  responseTypes?: string[]; errors?: Record<number, string>;
};

const core: Record<string, Description> = {
  'GET /api/openapi.json': { summary: 'Read the reference for this installation' },
  'GET /api/decks': { summary: 'List lessons visible to the session' },
  'POST /api/decks': { summary: 'Create a lesson and start its outline', body: createInput, status: 201,
    errors: { 409: 'Creation request or moderation confirmation needs attention.', 413: 'Source or picture is too large.',
      429: 'The user has two other generation jobs.', 503: 'The selected provider or moderation model is unavailable.' } },
  'GET /api/decks/:id': { summary: 'Read the current lesson snapshot' },
  'PATCH /api/decks/:id': { summary: 'Apply a slide or lesson operation with revision and replay checks', body: editInput,
    errors: { 409: 'Revision, slide version, or operation ID conflict.', 423: 'Another editor holds the lesson lease.' } },
  'POST /api/decks/:id/generate': { summary: 'Approve the outline or resume slide generation' },
  'POST /api/decks/:id/cancel': { summary: 'Stop generation and retain completed slides' },
  'POST /api/decks/:id/retry': { summary: 'Retry one unfinished slide', body: retryInput },
  'POST /api/decks/:id/outline/retry': { summary: 'Retry the outline from its saved checkpoint' },
  'POST /api/decks/:id/quality': { summary: 'Queue a quality check for ready slides' },
  'GET /api/decks/:id/events': { summary: 'Stream lesson events after the greater of after and Last-Event-ID',
    parameters: [{ name: 'after', in: 'query', schema: revision }, { name: 'Last-Event-ID', in: 'header', schema: revision }],
    responseTypes: ['text/event-stream'] },
  'GET /api/decks/:id/revisions': { summary: 'List saved lesson revisions' },
  'POST /api/decks/:id/revisions/:revision/restore': { summary: 'Restore, undo or redo a saved lesson revision',
    body: z.object({ baseRevision: z.number().int().nonnegative().optional(), intent: z.enum(['undo', 'redo', 'restore']).optional(),
      operationId: z.uuid().optional() }).optional(), errors: { 409: 'The active lesson changed or the operation conflicts.' } },
  'POST /api/decks/:id/exports': { summary: 'Queue or reuse an export of the specified ready revision',
    body: exportJobInput, status: 202, errors: { 409: 'The revision or requested content is not ready.' } },
  'GET /api/decks/:id/exports/:jobId': { summary: 'Read queued, running, ready, or failed export status' },
  'GET /api/decks/:id/exports/:jobId/file': { summary: 'Download a verified, revision-specific export',
    responseTypes: binaries, errors: { 409: 'The export is still pending or failed.' } },
  'GET /api/decks/:id/export/:format': { summary: 'Render and download the current revision synchronously', responseTypes: binaries,
    errors: { 409: 'The requested revision or content is not ready.', 422: 'Rendering failed.', 429: 'The renderer is busy.' } },
  'GET /api/decks/:id/assistant': { summary: 'Read the assistant conversation and pending edits' },
  'POST /api/decks/:id/assistant': { summary: 'Start or resume an assistant turn and stream full snapshots',
    body: assistantInput, responseTypes: ['application/x-ndjson'] },
  'POST /api/decks/:id/assistant/cancel': { summary: 'Stop an assistant turn', body: assistantCancelInput },
  'POST /api/decks/:id/assistant/memory': { summary: 'Save a private teaching preference', body: assistantMemoryInput },
  'POST /api/decks/:id/assistant/proposals/:pid': { summary: 'Apply, dismiss, or restore a batch proposal',
    body: z.object({ action: z.enum(['apply', 'dismiss', 'restore']) }),
    errors: { 409: 'The proposal is stale or a newer revision prevents restoration.' } },
  'POST /api/decks/:id/proposals': { summary: 'Propose a change to one slide', body: proposeInput },
  'PUT /api/decks/:id/access': { summary: 'Grant view or edit access to an account in this organization', body: grantInput },
  'POST /api/decks/:id/comments': { summary: 'Add a comment for users with lesson access', body: commentInput },
  'POST /api/decks/:id/images/symbol': { summary: 'Render a formula or classroom pictogram with its alternative text',
    body: slideSymbolInput },
  'POST /api/import/powerpoint-style': { summary: 'Extract a supported PowerPoint design', body: 'binary' },
  'POST /api/import/slides': { summary: 'Import pages as artwork or supported editable PowerPoint content', body: 'binary', status: 201 },
  'POST /api/sources/extract/:format': { summary: 'Extract document text and optional OCR', body: 'binary' },
  'GET /api/source-files': { summary: 'List your saved source files' },
  'POST /api/source-files/:format': { summary: 'Save and index an original source file', body:'binary', status:201,
    parameters:[{name:'name',in:'query',required:true,schema:{type:'string',maxLength:160}},
      {name:'ocr',in:'query',schema:{type:'string',enum:['alem']}}],
    errors:{413:'The file, extracted text, or personal library exceeds its size limit.',422:'The text could not be read or requires OCR consent.'} },
  'GET /api/source-files/:id': { summary: 'Read your source file metadata and extracted text' },
  'GET /api/source-files/:id/download': { summary: 'Download your original source file', responseTypes:['application/octet-stream'] },
  'DELETE /api/source-files/:id': { summary: 'Remove your source file and its search index', status:204 },
  'POST /api/media/transcriptions/:language': { summary: 'Transcribe an uploaded audio clip', body: 'binary' },
  'GET /api/decks/:id/language-versions': { summary: 'List related language versions the session can read' },
  'GET /api/decks/:id/language-versions/comparison': { summary: 'Compare the original and translated snapshots' },
  'POST /api/decks/:id/language-versions': { summary: 'Create a version using the requested language', body: languageVersionInput,
    status: 201, errors: { 409: 'The lesson or request ID changed.', 503: 'The translator is unavailable.' } },
  'POST /api/decks/:id/language-versions/align': { summary: 'Align structure while retaining existing translated edits',
    body: languageAlignInput, errors: { 409: 'A participating revision changed.' } },
  'GET /api/biometrics/self': { summary: 'Read your current avatar enrollment status' },
  'POST /api/biometrics/self/enrollment': { summary: 'Confirm the policy and request an operator enrollment link',
    body: biometricEnrollmentInput },
  'GET /api/decks/:id/video': { summary: 'Read current lecture render and avatar availability' },
  'GET /api/decks/:id/narration': { summary: 'Read hosted narration availability' },
  'POST /api/decks/:id/narration/:slideId': { summary: 'Synthesize saved speaker notes for a slide preview', body: narrationPreviewInput,
    responseTypes: ['audio/mpeg'] },
  'POST /api/decks/:id/video': { summary: 'Start or reuse a verified lecture job', body: videoStartInput,
    errors: { 403: 'The requested avatar lacks active consent.', 409: 'The lesson revision is stale or a job is active.',
      422: 'The scene settings do not fit the slides.', 503: 'Video processing or independent verification is unavailable.' } },
  'POST /api/decks/:id/video/cancel': { summary: 'Cancel an unfinished lecture render' },
  'GET /api/decks/:id/video/:key/file': { summary: 'Download a verified and authorized lecture', responseTypes: ['video/mp4'] },
};

function bodySchema(input: ZodType | 'binary') {
  if (input === 'binary') return {
    required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  };
  const { $schema, ...schema } = z.toJSONSchema(input, { io: 'input' });
  return { required: !input.isOptional(), content: { 'application/json': { schema } } };
}

function routeAccess(url: string, method: string, gateway: boolean) {
  if (url === classroomCodeRoute) return 'Public classroom code';
  if (url.startsWith('/api/biometrics/self')) return 'Signed-in biometric subject';
  if (url.startsWith('/api/admin/')) return 'System administrator';
  if (gateway && url.startsWith('/api/source-files')) return 'Signed-in file owner';
  if (url === '/api/organization/brand' || url.startsWith('/api/organization/media') ||
      (url === '/api/organization/templates' && method === 'POST')) return 'Organization administrator';
  if (!gateway) return 'Local workstation session';
  if (url.startsWith('/api/coedit/')) return 'Signed-in lesson editor';
  const access = deckRouteAction(url, method);
  if (access === 'read') return 'Signed-in lesson viewer or editor';
  if (access === 'write') return 'Signed-in lesson editor';
  if (access === 'manage') return 'Lesson owner or system administrator';
  return 'Signed-in gateway session';
}

export function registerApiReference(app: FastifyInstance, gateway: boolean) {
  const paths: Record<string, Record<string, object>> = {};
  app.addHook('onRoute', route => {
    if (!route.url.startsWith('/api/')) return;
    const names = [...route.url.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)].map(match => match[1]);
    const path = route.url.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, '{$1}');
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      if (method === 'HEAD') continue;
      const spec = core[method + ' ' + route.url];
      const access = routeAccess(route.url, method, gateway);
      const parameters: Parameter[] = names.map(name => ({
        name, in: 'path', required: true, schema: name === 'revision' ? revision : { type: 'string' },
      }));
      parameters.push(...spec?.parameters ?? []);
      const errors = { 400: 'Invalid request input.',
        ...(gateway && access !== 'Public classroom code' && { 401: 'Sign in through the gateway.', 403: 'Permission denied.' }),
        ...(names.length && { 404: 'The requested resource is unavailable.' }),
        ...spec?.errors,
      };
      const content = spec?.responseTypes && Object.fromEntries(spec.responseTypes.map(type => [type, {
        schema: { type: 'string', ...(binaries.includes(type) || type === 'video/mp4' || type === 'audio/mpeg' || type === 'application/octet-stream' ? { format: 'binary' } : {}) },
      }]));
      (paths[path] ??= {})[method.toLowerCase()] = {
        summary: spec?.summary ?? method + ' ' + path,
        'x-studio-access': access,
        ...(parameters.length && { parameters }),
        ...(spec?.body && { requestBody: bodySchema(spec.body) }),
        responses: {
          [spec?.status ?? 200]: { description: 'Successful response.', ...(content && { content }) },
          ...Object.fromEntries(Object.entries(errors).map(([status, description]) => [status, { description }])),
          default: { description: 'Request failed.' },
        },
      };
    }
  });
  app.get('/api/openapi.json', () => ({
    openapi: '3.1.0',
    info: {
      title: 'Sabaq Studio API', version: '0.1.0',
      description: 'Route inventory and core request schemas for this installation. Shared installations authenticate at the identity gateway.',
    },
    paths,
  }));
}
