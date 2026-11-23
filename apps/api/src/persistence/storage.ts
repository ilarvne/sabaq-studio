import { UsageLog } from './usage';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { calendarDayFormatter, type LibraryActivity } from '@sabaq/contracts/library';
import type { AssistantMemoryEntry } from '@sabaq/contracts/assistant';
import type { OrganizationBrand } from '@sabaq/lesson/types';

type Collection = 'decks' | 'runs' | 'proposals';
interface JsonRow {
  data: string;
}
export interface StudioEvent {
  seq: number;
  kind: string;
  revision: number;
  [key: string]: unknown;
}

export class StudioStore {
  readonly db: DatabaseSync;
  readonly usage:UsageLog;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lesson_image_assets (
        deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, src TEXT NOT NULL, PRIMARY KEY(deck_id,src)
      );
      CREATE INDEX IF NOT EXISTS lesson_image_lookup ON lesson_image_assets(src);
      CREATE TABLE IF NOT EXISTS deck_owners (
        deck_id TEXT PRIMARY KEY REFERENCES decks(id), org TEXT NOT NULL, subject TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS owner_lookup ON deck_owners(org,subject);
      CREATE TABLE IF NOT EXISTS org_brands (org TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS org_media (
        id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS org_media_lookup ON org_media(org,src);
      CREATE TABLE IF NOT EXISTS org_templates (
        id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, active INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS org_template_name ON org_templates(org,name) WHERE active=1;
      CREATE TABLE IF NOT EXISTS deck_grants (
        deck_id TEXT NOT NULL REFERENCES deck_owners(deck_id), subject TEXT NOT NULL,
        permission TEXT NOT NULL CHECK(permission IN ('view','edit')), PRIMARY KEY(deck_id,subject)
      );
      CREATE TABLE IF NOT EXISTS deck_comment_reads (
        deck_id TEXT NOT NULL REFERENCES decks(id), org TEXT NOT NULL, subject TEXT NOT NULL, last_id INTEGER NOT NULL,
        PRIMARY KEY(deck_id,org,subject)
      );
      CREATE TABLE IF NOT EXISTS deck_views (
        deck_id TEXT NOT NULL REFERENCES decks(id), session TEXT NOT NULL, slide_id TEXT NOT NULL,
        completed INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY(deck_id,session)
      );
      CREATE TABLE IF NOT EXISTS edit_leases (
        deck_id TEXT PRIMARY KEY REFERENCES decks(id), org TEXT NOT NULL, subject TEXT NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_access (
        seq INTEGER PRIMARY KEY, deck_id TEXT, org TEXT NOT NULL, subject TEXT NOT NULL, route TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deck_comments (
        id INTEGER PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id), subject TEXT NOT NULL,
        slide_id TEXT, text TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        deck_id TEXT NOT NULL REFERENCES decks(id), seq INTEGER NOT NULL,
        data TEXT NOT NULL, PRIMARY KEY(deck_id,seq)
      );
      CREATE TABLE IF NOT EXISTS revisions (
        deck_id TEXT NOT NULL REFERENCES decks(id), revision INTEGER NOT NULL,
        data TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(deck_id,revision)
      );
      CREATE TABLE IF NOT EXISTS operations (
        deck_id TEXT NOT NULL REFERENCES decks(id), id TEXT NOT NULL,
        data TEXT NOT NULL, PRIMARY KEY(deck_id,id)
      );
      CREATE TABLE IF NOT EXISTS assistant_turns (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id TEXT NOT NULL REFERENCES decks(id), client_id TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(deck_id,client_id)
      );
      CREATE TABLE IF NOT EXISTS assistant_memory (
        deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(deck_id,id), UNIQUE(deck_id,text)
      );
    `);
    if (this.db.prepare("SELECT 1 FROM pragma_table_info('deck_views') WHERE name='subject'").get())
      this.transaction(()=>this.db.exec(`
        ALTER TABLE deck_views RENAME TO legacy_deck_views;
        CREATE TABLE deck_views (deck_id TEXT NOT NULL REFERENCES decks(id),session TEXT NOT NULL,slide_id TEXT NOT NULL,
          completed INTEGER NOT NULL,at TEXT NOT NULL,PRIMARY KEY(deck_id,session));
        INSERT INTO deck_views(deck_id,session,slide_id,completed,at)
          SELECT v.deck_id, CASE WHEN row_number() OVER (PARTITION BY v.deck_id,v.session ORDER BY v.rowid)=1
            THEN v.session ELSE lower(hex(randomblob(16))) END, v.slide_id,
            coalesce(json_extract(d.data,'$.slides[#-1].id')=v.slide_id,0),v.at
          FROM legacy_deck_views v JOIN decks d ON d.id=v.deck_id;
        DROP TABLE legacy_deck_views;
      `));
    this.usage=new UsageLog(this.db);
  }

  organizationBrand(org?:string): OrganizationBrand | undefined {
    const row=org && this.db.prepare('SELECT data FROM org_brands WHERE org=?').get(org);
    return row ? JSON.parse(String(row.data)) : undefined;
  }

  get<T>(collection: Collection, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${collection} WHERE id=?`).get(id) as
      | JsonRow
      | undefined;
    return row && (JSON.parse(row.data) as T);
  }

  all<T>(collection: Collection): T[] {
    return (
      this.db.prepare(`SELECT data FROM ${collection} ORDER BY rowid DESC`).all() as unknown as JsonRow[]
    ).map((row) => JSON.parse(row.data) as T);
  }

  libraryActivity(firstInstant: string, timeZone: string, visibleIds?: string[]): LibraryActivity[] {
    const formatDay = calendarDayFormatter(timeZone);
    const changes = this.db.prepare(`
      WITH changes AS (
        SELECT json_extract(data,'$.updatedAt') AS stamp,
               reason IN ('Created','Blank lesson') AS created,
               reason IN ('Teacher edit','Assistant edits applied','Assistant proposal applied','Assistant lesson redesign')
                 OR reason LIKE 'Restored revision %' AS edited
        FROM revisions WHERE ? IS NULL OR deck_id IN (SELECT value FROM json_each(?))
      )
      SELECT stamp, created, edited FROM changes WHERE stamp >= ? AND (created OR edited)
    `).all(visibleIds ? JSON.stringify(visibleIds) : null, visibleIds ? JSON.stringify(visibleIds) : null, firstInstant) as {stamp:string;created:number;edited:number}[];
    const days = new Map<string,LibraryActivity>();
    for (const change of changes) {
      const stamp = new Date(change.stamp);
      if (!Number.isFinite(stamp.getTime())) continue;
      const day = formatDay(stamp);
      const row = days.get(day) ?? {day,created:0,edited:0};
      row.created += change.created;
      row.edited += change.edited;
      days.set(day,row);
    }
    return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
  }

  put<T>(collection: Collection, id: string, value: T) {
    this.db
      .prepare(
        `INSERT INTO ${collection} (id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(id, JSON.stringify(value));
  }

  saveRevision<T extends { id: string; revision: number }>(deck: T, reason: string) {
    this.put('decks', deck.id, deck);
    this.db
      .prepare('INSERT INTO revisions(deck_id,revision,data,reason) VALUES(?,?,?,?)')
      .run(deck.id, deck.revision, JSON.stringify(deck), reason);
  }

  operation<T>(deckId: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT data FROM operations WHERE deck_id=? AND id=?')
      .get(deckId, id) as JsonRow | undefined;
    return row && (JSON.parse(row.data) as T);
  }
  recordOperation(deckId: string, id: string, data: unknown) {
    this.db
      .prepare('INSERT INTO operations(deck_id,id,data) VALUES(?,?,?)')
      .run(deckId, id, JSON.stringify(data));
  }

  assistantTurn<T>(deckId: string, clientId: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM assistant_turns WHERE deck_id=? AND client_id=?')
      .get(deckId, clientId) as JsonRow | undefined;
    return row && (JSON.parse(row.data) as T);
  }

  assistantTurns<T>(deckId: string): T[] {
    const rows = this.db.prepare('SELECT data FROM assistant_turns WHERE deck_id=? ORDER BY seq DESC LIMIT 60')
      .all(deckId) as unknown as JsonRow[];
    return rows.reverse().map(({ data }) => JSON.parse(data) as T);
  }

  saveAssistantTurn(deckId: string, clientId: string, value: unknown) {
    this.db.prepare(`INSERT INTO assistant_turns (deck_id,client_id,data) VALUES(?,?,?)
      ON CONFLICT(deck_id,client_id) DO UPDATE SET data=excluded.data`)
      .run(deckId, clientId, JSON.stringify(value));
  }

  assistantMemory(deckId: string): AssistantMemoryEntry[] {
    return this.db.prepare(`SELECT id,text,created_at AS createdAt FROM assistant_memory
      WHERE deck_id=? ORDER BY created_at DESC,id`).all(deckId) as AssistantMemoryEntry[];
  }

  saveAssistantMemory(deckId: string, entry: AssistantMemoryEntry) {
    this.db.prepare('INSERT INTO assistant_memory(deck_id,id,text,created_at) VALUES(?,?,?,?)')
      .run(deckId,entry.id,entry.text,entry.createdAt);
  }

  removeAssistantMemory(deckId: string, id: string) {
    this.db.prepare('DELETE FROM assistant_memory WHERE deck_id=? AND id=?').run(deckId,id);
  }

  appendEvent(
    deckId: string,
    kind: string,
    revision: number,
    data: Record<string, unknown> = {},
  ): StudioEvent {
    const { seq } = this.db
      .prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE deck_id=?')
      .get(deckId)!;
    const event = { ...data, seq: Number(seq), kind, revision };
    this.db
      .prepare('INSERT INTO events(deck_id,seq,data) VALUES(?,?,?)')
      .run(deckId, event.seq, JSON.stringify(event));
    return event;
  }

  events(deckId: string, after: number): StudioEvent[] {
    const rows = this.db
      .prepare('SELECT data FROM events WHERE deck_id=? AND seq>? ORDER BY seq')
      .all(deckId, after) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.data) as StudioEvent);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
