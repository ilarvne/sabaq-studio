import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { z } from 'zod';
import { coeditFields,coeditLimits,editableFields,type CoeditPeer,type CoeditState } from '@sabaq/lesson/coedit';
import type { Slide } from '@sabaq/lesson/types';
import type { Principal,StudioAccess } from '../access/access';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';

const binary=(limit:number)=>z.string().min(1).max(limit).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const syncInput=z.object({session:z.uuid(),room:z.uuid().optional(),sequence:z.number().int().nonnegative().optional(),
  vector:binary(24_000).optional(),update:binary(64_000).optional(),
  cursor:z.object({field:z.enum(coeditFields),position:binary(300)}).nullable().optional()}).strict();
type Route={Params:{id:string;slide:string}};
type Presence={user:Principal;deck:string;slide:string;expires:number;peer:CoeditPeer};
type Stored={room:string;sequence:number;version:number;state:Uint8Array};
const from64=(value:string)=>Buffer.from(value,'base64');
const to64=(value:Uint8Array)=>Buffer.from(value).toString('base64');
const maxState=512_000;

function document(state?:Uint8Array,slide?:Slide) {
  const doc=new Y.Doc();
  for(const key of coeditFields){const type=doc.getText(key);if(slide)type.insert(0,slide[key]);}
  if(state)Y.applyUpdate(doc,state);
  return doc;
}
function validateUpdate(doc:Y.Doc,update:Uint8Array) {
  // Rich objects, embeds and arbitrary top-level keys have no representation in a slide's plain text.
  const {structs}=Y.decodeUpdate(update);
  if(structs.length>4000 || structs.some(s=>s instanceof Y.Item &&
     !(s.content instanceof Y.ContentString || s.content instanceof Y.ContentDeleted)))throw Error();
  Y.applyUpdate(doc,update);
  if(doc.store.pendingDs || doc.store.pendingStructs || [...doc.share.keys()].some(k=>!coeditFields.some(f=>f===k)))throw Error();
  for(const field of coeditFields){
    const text=doc.getText(field);
    if(text.length>coeditLimits[field] || text.toDelta().some((d:{insert:unknown;attributes?:unknown})=>typeof d.insert!=='string' || d.attributes))throw Error();
  }
}

export function registerCoedit(app:FastifyInstance,studio:Studio,access:StudioAccess) {
  const enabled=access.enabled && process.env.STUDIO_COEDIT==='1';
  if(!enabled)return false;
  const {store}=studio, db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS coedit_documents (
    deck TEXT NOT NULL REFERENCES decks(id), slide TEXT NOT NULL,room TEXT NOT NULL,sequence INTEGER NOT NULL,
    version INTEGER NOT NULL,state BLOB NOT NULL,PRIMARY KEY(deck,slide))`);
  const sessions=new Map<string,Presence>();
  function current(deck:string) {
    const result:Presence[]=[];
    for(const [id,presence] of sessions) {
      if(presence.expires<=Date.now()){sessions.delete(id);continue;}
      if(presence.deck!==deck)continue;
      if(!['owner','admin','edit'].includes(access.permission(presence.user,deck) ?? '')){sessions.delete(id);continue;}
      result.push(presence);
    }
    return result;
  }
  access.sharedEditor=id=>current(id)[0]?.user.subject;
  const persist=db.prepare(`INSERT INTO coedit_documents VALUES(?,?,?,?,?,?) ON CONFLICT(deck,slide) DO UPDATE SET
    room=excluded.room,sequence=excluded.sequence,version=excluded.version,state=excluded.state`);
  app.post<Route>('/api/coedit/:id/:slide/sync',{bodyLimit:95_000},async req=>{
    const {id,slide:slideId}=req.params;
    access.require(req,id,'write');
    const user=access.principal(req)!,input=syncInput.parse(req.body);
    const peers=current(id);
    const previous=sessions.get(input.session);
    if(previous && (previous.user.org!==user.org || previous.user.subject!==user.subject || previous.deck!==id || previous.slide!==slideId))
      throw new ApiError(409,'This session belongs to another editor.');
    if(!previous && (peers.length>=24 || sessions.size>=256))throw new ApiError(429,'The editing room is full.');
    if(access.editor(req,id))throw new ApiError(423,'The current editor must open shared editing first.');
    const deck=studio.deck(id), slide=deck.slides.find(s=>s.id===slideId && s.status==='ready');
    if(!slide || deck.phase!=='editing')throw new ApiError(409,'Open a ready slide to edit together.');
    let stored=db.prepare('SELECT room,sequence,version,state FROM coedit_documents WHERE deck=? AND slide=?').get(id,slideId) as Stored|undefined;
    if(!stored || slide.version!==stored.version){
      if(input.room)throw new ApiError(409,'The slide changed outside the room. Reopen the shared editor.');
      const doc=document(undefined,slide);
      stored={room:randomUUID(),sequence:0,version:slide.version,state:Y.encodeStateAsUpdate(doc)};doc.destroy();
      persist.run(id,slideId,stored.room,0,stored.version,stored.state);
    }
    if(input.room && input.room!==stored.room || input.update && !input.room)throw new ApiError(409,'Reopen the shared editor.');
    const editable=editableFields(slide),room=stored;
    let update:string|undefined, position=input.cursor?.position;
    if(input.sequence!==room.sequence || input.update || input.cursor || input.room===undefined){
      const doc=document(room.state);
      try{
        const vector=input.vector ? from64(input.vector) : undefined;
        if(vector)Y.decodeStateVector(vector);
        const relative=input.cursor && Y.decodeRelativePosition(from64(input.cursor.position));
        if(input.update){
          const bytes=from64(input.update);
          let changed=false;
          doc.on('update',()=>{changed=true;});
          validateUpdate(doc,bytes);
          if(changed){
            const changes:Partial<Pick<Slide,'title'|'body'|'notes'>>={};
            for(const field of coeditFields){
              const value=doc.getText(field).toString();
              if(slide[field]===value)continue;
              if(!editable.includes(field))throw new ApiError(422,'Use the ordinary editor to preserve this rich text.');
              changes[field]=value;
            }
            const state=Y.encodeStateAsUpdate(doc);
            if(state.byteLength>maxState)throw new ApiError(413,'This editing room reached its size limit.');
            store.transaction(()=>{
              if(Object.keys(changes).length)studio.saveSharedText(deck,slideId,slide.version,changes);
              room.sequence++;room.version=slide.version;room.state=state;
              persist.run(id,slideId,room.room,room.sequence,room.version,state);
            });
          }
        }
        if(input.sequence!==room.sequence || !input.room){
          update=to64(Y.encodeStateAsUpdate(doc,vector));
        }
        if(input.cursor && relative){
          const cursor=Y.createAbsolutePositionFromRelativePosition(relative,doc);
          if(cursor?.type!==doc.getText(input.cursor.field))position=undefined;
        }
      }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(422,'Invalid collaborative edit.');}
      finally{doc.destroy();}
    }
    const peer:CoeditPeer={id:input.session,name:user.subject,...(position && input.cursor && {field:input.cursor.field,position})};
    sessions.set(input.session,{deck:id,slide:slideId,user,expires:Date.now()+8000,peer});
    db.prepare('DELETE FROM edit_leases WHERE deck_id=? AND org=? AND subject=?').run(id,user.org,user.subject);
    const result:CoeditState={room:room.room,sequence:room.sequence,update,editable,
      peers:peers.filter(p=>p.slide===slideId && p.peer.id!==input.session).map(p=>p.peer)};
    return result;
  });
  app.post<Route>('/api/coedit/:id/:slide/leave',async req=>{
    const {session}=z.object({session:z.uuid()}).parse(req.body);
    const owner=access.principal(req)!,p=sessions.get(session);
    if(p && p.user.org===owner.org && p.user.subject===owner.subject && p.deck===req.params.id && p.slide===req.params.slide)sessions.delete(session);
    return {saved:true};
  });
  return true;
}
