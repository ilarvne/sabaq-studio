import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deck } from '@sabaq/lesson/types';
import type { StudioStore } from '../persistence/storage';
import { ApiError } from '../errors';

export type Principal = { org: string; subject: string; admin: boolean; orgAdmin?: boolean };
type Permission = 'owner' | 'edit' | 'view' | 'admin';
const subject = z.string().trim().min(1).max(160).regex(/^[\p{L}\p{N}@_.:+-]+$/u);
export const grantInput = z.object({ subject, permission: z.enum(['edit', 'view']) }).strict();
export const commentInput = z.object({ text: z.string().trim().min(1).max(2500), slideId: z.string().max(160).optional() }).strict();
const digest = (text: string) => createHash('sha256').update(text).digest();

export const classroomCodeRoute = '/api/classroom-polls/:code';

export function deckRouteAction(route: string, method: string) {
  if (!route.startsWith('/api/decks/:id')) return;
  if (route.endsWith('/access') || route.includes('/access/')) return 'manage';
  const reads = method === 'GET' || method === 'HEAD';
  const editorData = route === '/api/decks/:id/assistant' || route.startsWith('/api/decks/:id/assistant/') || route === '/api/decks/:id/poll';
  if ((reads && !editorData) || route.endsWith('/comments') || route.endsWith('/comments/read') ||
      route.endsWith('/view-state') || route.endsWith('/presentation-start') || route.endsWith('/exports')) return 'read';
  return 'write';
}

export class StudioAccess {
  sharedEditor?: (deckId:string)=>string|undefined;
  private readonly gateway = process.env.STUDIO_GATEWAY_SECRET?.trim();
  readonly enabled = process.env.STUDIO_AUTH_MODE === 'gateway';
  private principals = new WeakMap<FastifyRequest, Principal>();
  constructor(private store: StudioStore) {
    if (process.env.STUDIO_AUTH_MODE && !['local', 'gateway'].includes(process.env.STUDIO_AUTH_MODE))
      throw new Error('Unknown STUDIO_AUTH_MODE.');
    if (!this.enabled && store.db.prepare('SELECT 1 FROM deck_owners UNION ALL SELECT 1 FROM org_media UNION ALL SELECT 1 FROM org_brands UNION ALL SELECT 1 FROM org_templates LIMIT 1').get())
      throw new Error('This database has account-owned lessons. Set STUDIO_AUTH_MODE=gateway.');
    if (this.enabled && (!this.gateway || this.gateway.length < 32))
      throw new Error('Gateway mode requires STUDIO_GATEWAY_SECRET (at least 32 characters).');
  }
  authenticate(req: FastifyRequest) {
    if (!this.enabled) return;
    const token = req.headers['x-studio-gateway'];
    if (typeof token !== 'string' || !timingSafeEqual(digest(token), digest(this.gateway!)))
      throw new ApiError(401, 'Sign in through the studio gateway.');
    const org = subject.safeParse(req.headers['x-studio-org']);
    const user = subject.safeParse(req.headers['x-studio-user']);
    if (!org.success || !user.success) throw new ApiError(401, 'Studio identity is missing.');
    this.principals.set(req, { org: org.data, subject: user.data, admin: req.headers['x-studio-role'] === 'system-admin',
      orgAdmin:req.headers['x-studio-role'] === 'org-admin' });
  }
  principal(req: FastifyRequest) { return this.principals.get(req); }
  permission(user: Principal, id: string): Permission | undefined {
    const owner = this.store.db.prepare('SELECT org,subject FROM deck_owners WHERE deck_id=?').get(id);
    if (user.admin && this.store.db.prepare('SELECT 1 FROM decks WHERE id=?').get(id)) return 'admin';
    if (!owner || owner.org !== user.org) return;
    if (owner.subject === user.subject) return 'owner';
    return this.store.db.prepare('SELECT permission FROM deck_grants WHERE deck_id=? AND subject=?')
      .get(id, user.subject)?.permission as 'edit' | 'view' | undefined;
  }
  require(req: FastifyRequest, id: string, action: 'read' | 'write' | 'manage', audit = true) {
    if (!this.enabled) return;
    const user = this.principal(req)!;
    const permission = this.permission(user, id);
    if (!permission || (action === 'write' && permission === 'view') || (action === 'manage' && permission !== 'owner' && permission !== 'admin'))
      throw new ApiError(403, 'Permission denied.');
    if (audit && user.admin) this.store.db.prepare('INSERT INTO admin_access(deck_id,org,subject,route,at) VALUES (?,?,?,?,?)')
      .run(id, user.org, user.subject, req.routeOptions.url ?? 'api', new Date().toISOString());
  }
  visibleIds(req: FastifyRequest, audit = true): string[] | undefined {
    if (!this.enabled) return;
    const user = this.principal(req)!;
    const rows = user.admin
      ? this.store.db.prepare('SELECT id FROM decks').all()
      : this.store.db.prepare(`SELECT deck_id AS id FROM deck_owners o WHERE o.org=? AND
          (o.subject=? OR EXISTS (SELECT 1 FROM deck_grants g WHERE g.deck_id=o.deck_id AND g.subject=?))`)
        .all(user.org, user.subject, user.subject);
    const ids = rows.map(row => String(row.id));
    if (audit && user.admin) for (const id of ids) this.require(req, id, 'read');
    return ids;
  }
  media(req: FastifyRequest, path: string) {
    if (!this.enabled) return;
    const org=this.principal(req)!.org;
    if (this.store.db.prepare('SELECT 1 FROM org_media WHERE org=? AND src=?').get(org,path)) return;
    const ids = this.visibleIds(req, false);
    const logo=this.store.db.prepare(`SELECT deck_id FROM revisions WHERE deck_id IN (SELECT value FROM json_each(?))
      AND json_extract(data,'$.brand.logo')=? LIMIT 1`).get(JSON.stringify(ids),path);
    if (logo) {this.require(req,String(logo.deck_id),'read');return;}
    // Only image fields establish access. A file name mentioned in lesson text grants no rights.
    const row = this.store.db.prepare(`SELECT r.deck_id FROM revisions r, json_each(r.data,'$.slides') slide
      WHERE r.deck_id IN (SELECT value FROM json_each(?)) AND (
        ? IN (json_extract(slide.value,'$.image.src'),json_extract(slide.value,'$.image.originalSrc'),json_extract(slide.value,'$.importedArtwork'))
        OR EXISTS (SELECT 1 FROM json_each(slide.value,'$.additionalImages') gallery
          WHERE ? IN (json_extract(gallery.value,'$.src'),json_extract(gallery.value,'$.originalSrc')))
      ) LIMIT 1`)
      .get(JSON.stringify(ids),path,path);
    if (row) { this.require(req,String(row.deck_id),'read'); return; }
    // Proposed images are visible only to accounts that can inspect the assistant's proposal.
    const proposals = this.store.db.prepare(`SELECT DISTINCT t.deck_id FROM assistant_turns t, json_each(t.data,'$.assistant.proposal.changes') change
      WHERE t.deck_id IN (SELECT value FROM json_each(?)) AND json_extract(change.value,'$.after.image.src')=?
        AND json_extract(t.data,'$.assistant.proposal.status')='pending'`).all(JSON.stringify(ids),path);
    const user = this.principal(req)!;
    const drafts = this.store.db.prepare('SELECT deck_id FROM lesson_image_assets WHERE src=? AND deck_id IN (SELECT value FROM json_each(?))').all(path,JSON.stringify(ids));
    const draft = [...proposals,...drafts].find(row => this.permission(user,String(row.deck_id)) !== 'view');
    if (!draft) throw new ApiError(404, 'Illustration not found.');
    this.require(req, String(draft.deck_id), 'write');
  }
  editor(req: FastifyRequest, id: string) {
    if (!this.enabled) return;
    const user = this.principal(req)!;
    const row = this.store.db.prepare('SELECT org,subject FROM edit_leases WHERE deck_id=? AND expires>?')
      .get(id, Date.now());
    return row && (row.org !== user.org || row.subject !== user.subject) ? String(row.subject) : undefined;
  }
  claimEditor(req: FastifyRequest, id: string) {
    if (!this.enabled) return;
    const user = this.principal(req)!;
    this.store.transaction(() => {
      const editor = this.sharedEditor?.(id) ?? this.editor(req,id);
      if (editor) throw new ApiError(423, 'This lesson is being edited by ' + editor + '.');
      this.store.db.prepare(`INSERT INTO edit_leases VALUES (?,?,?,?) ON CONFLICT(deck_id) DO UPDATE
        SET org=excluded.org,subject=excluded.subject,expires=excluded.expires`).run(id,user.org,user.subject,Date.now()+90000);
    });
  }
  forViewer(req: FastifyRequest, deck: Deck): Deck {
    const user = this.principal(req);
    if (!user) return deck;
    const editor = this.sharedEditor?.(deck.id) ?? this.editor(req,deck.id);
    return { ...deck, viewerPermission: this.permission(user, deck.id), ...(editor && { activeEditor: editor }) };
  }
  sourceList(decks: Deck[]) {
    const seen = new Set<string>();
    return decks.flatMap(deck => {
      if (!deck.source || deck.research || seen.has(deck.source.text)) return [];
      seen.add(deck.source.text);
      return [{ id: deck.id, name: deck.source.name }];
    });
  }
}
