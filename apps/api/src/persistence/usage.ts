import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Deck, Locale } from '@sabaq/lesson/types';
import type { UsageRow } from '@sabaq/contracts/usage';

const hour=3600_000;
const month=30*24*hour;
const key=(...parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
type Owner = {org:string;subject:string}|undefined;
type Kind = 'start'|'answer'|'approve'|'ready'|'edit'|'proposal'|'apply'|'undo'|'redo'|'restore'|'present'|'download'|'video_start'|'video_ready';
type Datum = {id:string;at:number;action:Kind;language:Locale;journey:string;org:string;actor:string;deck:string|null;ref:string|null;revision:number|null;target:number|null};

export class UsageLog {
  constructor(private db:DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS usage_journeys(
      id TEXT PRIMARY KEY, org TEXT NOT NULL, actor TEXT NOT NULL, deck TEXT UNIQUE, request_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS usage_events(
      id TEXT PRIMARY KEY, at INTEGER NOT NULL, language TEXT NOT NULL, slides INTEGER NOT NULL, action TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_context(
      event TEXT PRIMARY KEY REFERENCES usage_events(id), journey TEXT NOT NULL REFERENCES usage_journeys(id),
      ref TEXT, revision INTEGER, target INTEGER
    );
    CREATE INDEX IF NOT EXISTS usage_by_journey ON usage_context(journey);
    CREATE INDEX IF NOT EXISTS usage_by_date ON usage_events(at,action);
    CREATE TABLE IF NOT EXISTS usage_reverts(
      event TEXT NOT NULL REFERENCES usage_events(id), application TEXT NOT NULL REFERENCES usage_events(id),
      PRIMARY KEY(event,application)
    );`);
  }
  private identity(owner:Owner,seed:string) {
    const org=owner?.org ?? 'local';
    const actor=key(org,owner?.subject ?? 'workstation');
    return {id:key(actor,seed),actor,org};
  }
  started(seed:string,locale:Locale,owner:Owner,question?:'level'|'duration'|'image'|'quiz') {
    const {id,org,actor}=this.identity(owner,seed);
    this.db.prepare('INSERT OR IGNORE INTO usage_journeys(id,org,actor) VALUES(?,?,?)').run(id,org,actor);
    this.add(id,'start','once',locale,0);
    if(question) this.add(id,'answer',question,locale,0);
    return id;
  }
  previous(seed:string,owner:Owner) {
    return this.db.prepare('SELECT deck,request_hash AS hash FROM usage_journeys WHERE id=? AND deck IS NOT NULL')
      .get(this.identity(owner,seed).id) as {deck:string;hash:string}|undefined;
  }
  fingerprint(input:unknown) {return key(input);}
  attach(deck:Deck,owner:Owner,seed?:string,hash?:string) {
    const id=this.started(seed ?? deck.id,deck.language,owner);
    this.db.prepare('UPDATE usage_journeys SET deck=?,request_hash=? WHERE id=? AND (deck IS NULL OR deck=?)')
      .run(deck.id,hash ?? null,id,deck.id);
    if(deck.slides.length && deck.slides.every(slide=>slide.status==='ready')) this.deckEvent(deck,'ready','once');
  }
  private journey(deck:Deck) {
    const existing=this.db.prepare('SELECT id FROM usage_journeys WHERE deck=?').get(deck.id);
    if(existing) return String(existing.id);
    // Existing work can produce events; it has no observed creation start.
    const owner=this.db.prepare('SELECT org,subject FROM deck_owners WHERE deck_id=?').get(deck.id) as Owner;
    const {id,org,actor}=this.identity(owner,deck.id);
    this.db.prepare('INSERT OR IGNORE INTO usage_journeys(id,org,actor,deck) VALUES(?,?,?,?)').run(id,org,actor,deck.id);
    return id;
  }
  private add(journey:string,action:Kind,occurrence:string,language:Locale,slides:number,ref?:string,revision?:number,target?:number) {
    const id=key(journey,action,occurrence);
    this.db.exec('SAVEPOINT usage_event_write');
    try {
      this.db.prepare('INSERT OR IGNORE INTO usage_events(id,at,language,slides,action) VALUES(?,?,?,?,?)').run(id,Date.now(),language,slides,action);
      this.db.prepare('INSERT OR IGNORE INTO usage_context(event,journey,ref,revision,target) VALUES(?,?,?,?,?)')
        .run(id,journey,ref ? key(journey,ref) : null,revision ?? null,target ?? null);
      this.db.exec('RELEASE usage_event_write');
      return id;
    } catch(error) {
      this.db.exec('ROLLBACK TO usage_event_write; RELEASE usage_event_write');
      throw error;
    }
  }
  deckEvent(deck:Deck,action:Kind,occurrence:string,ref?:string,target?:number) {
    return this.add(this.journey(deck),action,occurrence,deck.language,deck.slides.length,ref,deck.revision,target);
  }
  restored(deck:Deck,target:number,action:'undo'|'redo'|'restore') {
    const journey=this.journey(deck);
    const event=this.deckEvent(deck,action,String(deck.revision),undefined,target);
    const applied=this.db.prepare(`SELECT c.revision,c.event FROM usage_context c JOIN usage_events e ON e.id=c.event
      WHERE c.journey=? AND e.action='apply'`).all(journey) as {revision:number;event:string}[];
    if(!applied.length) return;
    // Restore snapshots inherit the state of the restored revision; redo can reintroduce an AI edit.
    const revisions=this.db.prepare(`SELECT revision,reason FROM revisions WHERE deck_id=? AND reason LIKE 'Restored revision %'`).all(deck.id);
    const jumps=new Map(revisions.map(row=>[Number(row.revision),Number(String(row.reason).slice('Restored revision '.length))]));
    function ancestors(head:number) {
      const kept=new Set<number>();
      for(let rev=head;rev>=0;){kept.add(rev); const jump=jumps.get(rev); rev=jump!==undefined && jump<rev ? jump : rev-1;}
      return kept;
    }
    const before=ancestors(deck.revision-1),after=ancestors(target);
    const remember=this.db.prepare('INSERT OR IGNORE INTO usage_reverts VALUES(?,?)');
    for(const item of applied) if(before.has(item.revision) && !after.has(item.revision)) remember.run(event,item.event);
  }
  report(from:number,to:number,org?:string,language?:Locale,asOf=Date.now()):UsageRow[] {
    // Include prior starts, cross-language progress and outcomes after the cohort period.
    const data=this.db.prepare(`SELECT e.id,e.at,e.language,e.action,c.journey,c.ref,c.revision,c.target,j.org,j.actor,j.deck
      FROM usage_events e JOIN usage_context c ON c.event=e.id JOIN usage_journeys j ON j.id=c.journey
      WHERE e.at<=? AND (? IS NULL OR j.org=?) ORDER BY e.at,e.rowid`).all(asOf,org ?? null,org ?? null) as unknown as Datum[];
    const reverted=this.db.prepare(`SELECT r.event,r.application FROM usage_reverts r JOIN usage_events u ON u.id=r.event
      WHERE u.at<=?`).all(asOf);
    const undoIds=new Set(reverted.map(r=>String(r.event)));
    const revertedAt=new Map<string,number>();
    const stamps=new Map(data.map(e=>[e.id,e.at]));
    for(const r of reverted) {
      const at=stamps.get(String(r.event)),id=String(r.application);
      if(at!==undefined) revertedAt.set(id,Math.min(at,revertedAt.get(id) ?? Infinity));
    }
    const byJourney=new Map<string,Datum[]>(),firstStart=new Map<string,Datum>(),firstReady=new Map<string,Datum>();
    const observedStarts=new Set<string>();
    for(const e of data) {
      const all=byJourney.get(e.journey) ?? []; all.push(e); byJourney.set(e.journey,all);
      if(e.action==='start') {
        observedStarts.add(e.journey);
        if(!firstStart.has(e.actor)) firstStart.set(e.actor,e);
      }
      if(e.action==='ready' && observedStarts.has(e.journey) && !firstReady.has(e.actor)) firstReady.set(e.actor,e);
    }
    const groups=new Map<string,{row:UsageRow;times:number[];decks:Set<string>}>();
    for(const e of data) {
      if(e.at<from || e.at>=to || (language && e.language!==language)) continue;
      const id=key(e.org,e.language);
      let group=groups.get(id);
      if(!group) {
        group={row:{org:e.org,language:e.language,medianSeconds:null,firstReadyUsers:0,proposed:0,accepted:0,ready:0,video:0,openVideoWindows:0,started:0,finished:0,activeDecks:0,manualRollbacks:0},times:[],decks:new Set()};
        groups.set(id,group);
      }
      const {row,times,decks}=group;
      const related=byJourney.get(e.journey)!;
      if(e.deck) decks.add(e.deck);
      if(e.action==='start') {
        row.started++;
        if(related.some(out=>out.at>=e.at && ['present','download','video_ready'].includes(out.action))) row.finished++;
        const ready=firstReady.get(e.actor);
        if(firstStart.get(e.actor)?.id===e.id && ready) times.push((ready.at-e.at)/1000);
      } else if(e.action==='proposal') {
        row.proposed++;
        const applied=related.find(out=>out.action==='apply' && out.ref===e.ref && out.at>=e.at);
        if(applied && applied.at+60000<=asOf && (revertedAt.get(applied.id) ?? Infinity)>applied.at+60000) row.accepted++;
      } else if(e.action==='ready') {
        row.ready++;
        if(related.some(out=>out.action==='video_ready' && out.at>=e.at && out.at<=e.at+month)) row.video++;
        else if(asOf<e.at+month) row.openVideoWindows++;
      } else if(e.action==='restore' || e.action==='undo' && undoIds.has(e.id)) row.manualRollbacks++;
    }
    return [...groups.values()].map(({row,times,decks})=>{
      times.sort((a,b)=>a-b);
      const middle=Math.floor(times.length/2);
      return {...row,activeDecks:decks.size,firstReadyUsers:times.length,
        medianSeconds:times.length ? (times.length%2 ? times[middle] : (times[middle-1]+times[middle])/2) : null};
    }).sort((a,b)=>a.org.localeCompare(b.org)||a.language.localeCompare(b.language));
  }
}
