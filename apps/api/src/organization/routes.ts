import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { brandContrast } from '@sabaq/lesson/themes';
import { brandFonts, type Deck, type OrganizationBrand, type OrganizationTemplate } from '@sabaq/lesson/types';
import type { StudioAccess } from '../access/access';
import type { Studio } from '../lessons/studio';
import { ApiError } from '../errors';
import { normalizeLessonImage } from '../media/lesson-images';

const name = z.string().trim().min(1).max(120);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const brandInput = z.object({paper:color,ink:color,font:z.enum(brandFonts),logoId:z.uuid().optional()}).strict();
type Snapshot = Pick<Deck,'slides'|'outline'|'language'|'theme'|'brand'>;
type Id = {Params:{id:string}};

export function registerOrganization(app:FastifyInstance,studio:Studio,access:StudioAccess,mediaRoot:string) {
  const {store}=studio, db=store.db;
  const member=(req:FastifyRequest,admin=false)=>{
    const principal=access.principal(req);
    if (!principal || (admin && !principal.orgAdmin)) throw new ApiError(403,'Organization access is required.');
    return principal;
  };
  const templates=(org:string):OrganizationTemplate[]=>db.prepare(`SELECT id,name,
    json_extract(data,'$.language') AS language,json_array_length(data,'$.slides') AS slideCount
    FROM org_templates WHERE org=? AND active=1 ORDER BY rowid DESC`).all(org) as OrganizationTemplate[];
  app.get('/api/organization',async req=>{
    const user=member(req);
    return {admin:Boolean(user.orgAdmin),brand:store.organizationBrand(user.org) ?? null,templates:templates(user.org),
      assets:db.prepare('SELECT id,name,src FROM org_media WHERE org=? ORDER BY rowid DESC').all(user.org)};
  });
  app.put('/api/organization/brand',async req=>{
    const user=member(req,true);
    const input=brandInput.parse(req.body);
    if (brandContrast(input.paper,input.ink)<4.5) throw new ApiError(422,'Colors require a contrast ratio of at least 4.5:1.');
    const logo=input.logoId && db.prepare('SELECT src FROM org_media WHERE org=? AND id=?').get(user.org,input.logoId);
    if (input.logoId && !logo) throw new ApiError(404,'Logo not found.');
    const style:OrganizationBrand={paper:input.paper,ink:input.ink,font:input.font,...(logo && {logo:String(logo.src)})};
    db.prepare('INSERT INTO org_brands VALUES(?,?) ON CONFLICT(org) DO UPDATE SET data=excluded.data').run(user.org,JSON.stringify(style));
    return style;
  });
  app.register(async plugin=>{
    let running=0;
    plugin.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
    plugin.post<{Body:Buffer}>('/api/organization/media',{bodyLimit:10_000_000, onRequest:async req=>{member(req,true);}},async(req,reply)=>{
      const user=member(req,true), data=z.object({name}).parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw new ApiError(415,'Choose a PNG, JPEG or WebP.');
      if(running>=2) throw new ApiError(429,'The image worker is busy.');
      running++;
      try {
        const {src}=await normalizeLessonImage(req.body,mediaRoot,AbortSignal.timeout(30_000));
        const asset={id:randomUUID(),name:data.name,src};
        db.prepare('INSERT INTO org_media VALUES(?,?,?,?)').run(asset.id,user.org,asset.name,asset.src);
        return reply.code(201).send(asset);
      } finally {running--;}
    });
  });
  app.delete<Id>('/api/organization/media/:id',async req=>{
    const user=member(req,true);
    store.transaction(()=>{
      const removed=db.prepare('DELETE FROM org_media WHERE id=? AND org=? RETURNING src').get(req.params.id,user.org);
      if (!removed) throw new ApiError(404,'Image not found.');
      if (!db.prepare('SELECT 1 FROM org_media WHERE org=? AND src=?').get(user.org,removed.src)) {
        db.prepare("UPDATE org_brands SET data=json_remove(data,'$.logo') WHERE org=? AND json_extract(data,'$.logo')=?").run(user.org,removed.src);
      }
    });
    return {saved:true};
  });
  app.post('/api/organization/templates',async(req,reply)=>{
    const user=member(req,true);
    const input=z.object({deckId:z.string().min(1).max(160),revision:z.number().int().nonnegative(),name}).strict().parse(req.body);
    access.require(req,input.deckId,'manage');
    const deck=studio.deck(input.deckId);
    if (deck.revision!==input.revision || !deck.slides.length || deck.slides.some(s=>s.status!=='ready'))
      throw new ApiError(409,'Save all slides before publishing.');
    const brand=store.organizationBrand(user.org);
    if (!brand) throw new ApiError(409,'Save the organization style before publishing a template.');
    // Only slide content and speaker notes are published. Original sources, account metadata and private history stay with the lesson.
    const snapshot:Snapshot={language:deck.language,theme:deck.theme,brand,
      slides:deck.slides.map(({evidence,moderationNotice,...slide})=>({...slide,version:0})),
      outline:deck.outline.map(({sourceExcerptId,...item})=>item)};
    const id=randomUUID();
    store.transaction(()=>{
      db.prepare('UPDATE org_templates SET active=0 WHERE org=? AND name=? AND active=1').run(user.org,input.name);
      db.prepare('INSERT INTO org_templates VALUES(?,?,?,?,1)').run(id,user.org,input.name,JSON.stringify(snapshot));
    });
    return reply.code(201).send({id,name:input.name,language:deck.language,slideCount:snapshot.slides.length});
  });
  app.post<Id>('/api/organization/templates/:id/copies',async(req,reply)=>{
    const user=member(req), input=z.object({title:name,requestId:z.uuid()}).strict().parse(req.body);
    const hash=store.usage.fingerprint(['organization-template',req.params.id,input.title]);
    return store.transaction(()=>{
      const previous=store.usage.previous(input.requestId,user);
      if (previous) {
        if (previous.hash!==hash) throw new ApiError(409,'This request already created a different lesson.');
        return access.forViewer(req,studio.deck(previous.deck));
      }
      const row=db.prepare('SELECT data FROM org_templates WHERE org=? AND id=? AND active=1').get(user.org,req.params.id);
      if (!row) throw new ApiError(404,'Template not found.');
      const snapshot:Snapshot=JSON.parse(String(row.data));
      const ids=new Map(snapshot.slides.map(s=>[s.id,randomUUID()]));
      const deck:Deck={...snapshot,id:randomUUID(),slides:snapshot.slides.map(s=>({...s,id:ids.get(s.id)!})),
        outline:snapshot.outline.map(s=>({...s,id:ids.get(s.id) ?? randomUUID()})),title:input.title,topic:input.title,
        revision:0,updatedAt:new Date().toISOString(),phase:'editing',outlineStatus:'complete',provider:'fixture'};
      store.saveRevision(deck,'Created');
      db.prepare('INSERT INTO deck_owners VALUES(?,?,?)').run(deck.id,user.org,user.subject);
      store.usage.attach(deck,user,input.requestId,hash);
      reply.code(201);
      return access.forViewer(req,deck);
    });
  });
  return templates;
}
