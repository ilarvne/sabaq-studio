import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { LessonCitation } from '@sabaq/contracts/retrieval';
import type { SourceFile, SourceFileDetail, SourceFileFormat } from '@sabaq/contracts/source-files';
import type { Principal } from '../access/access';
import { libraryFilePassages } from '../assistant/lesson-passages';
import { passageQueryExpression } from '../assistant/lesson-retrieval';
import { ApiError } from '../errors';
import type { StudioStore } from '../persistence/storage';

export const maxSourceText = 100_000;
const maxLibraryBytes = 250_000_000;
const maxLibraryFiles = 500;
const maxFileChunkCount = 3;
const fileFields = 'id,name,format,size,length(text) AS characterCount,created_at AS createdAt';
const notFound = () => new ApiError(404, 'Source file not found.');

type FileOwner = Pick<Principal, 'org' | 'subject'>;
const owner = (principal?: FileOwner) => [principal?.org ?? '', principal?.subject ?? ''] as const;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type SourceHit = Pick<LessonCitation, 'id' | 'excerpt' | 'label' | 'start' | 'end' | 'sourceFileId'> & { sourceFileId: string };
const hitFields = 'p.id,f.id AS sourceFileId,f.name AS label,p.start,p.end,p.excerpt';

export class SourceLibrary {
  constructor(private store: StudioStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS source_library_files (
        id TEXT PRIMARY KEY, org TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,
        format TEXT NOT NULL, size INTEGER NOT NULL, checksum TEXT NOT NULL, created_at TEXT NOT NULL,
        text TEXT NOT NULL, original BLOB NOT NULL, UNIQUE(org,subject,name,format,checksum)
      );
      CREATE INDEX IF NOT EXISTS source_library_owner ON source_library_files(org,subject,created_at DESC);
      CREATE TABLE IF NOT EXISTS source_library_chunks (
        rowid INTEGER PRIMARY KEY, file_id TEXT NOT NULL REFERENCES source_library_files(id) ON DELETE CASCADE,
        id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, excerpt TEXT NOT NULL, UNIQUE(file_id,id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS source_library_fts USING fts5(
        excerpt,content='source_library_chunks',content_rowid='rowid',tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS source_library_chunk_added AFTER INSERT ON source_library_chunks BEGIN
        INSERT INTO source_library_fts(rowid,excerpt) VALUES(new.rowid,new.excerpt);
      END;
      CREATE TRIGGER IF NOT EXISTS source_library_chunk_removed AFTER DELETE ON source_library_chunks BEGIN
        INSERT INTO source_library_fts(source_library_fts,rowid,excerpt) VALUES('delete',old.rowid,old.excerpt);
      END;
    `);
  }

  list(principal?: FileOwner): SourceFile[] {
    return this.store.db.prepare(`SELECT ${fileFields} FROM source_library_files WHERE org=? AND subject=? ORDER BY created_at DESC,rowid DESC`)
      .all(...owner(principal)) as SourceFile[];
  }

  details(id: string, principal?: FileOwner): SourceFileDetail {
    return this.file(id, principal, 'text') as SourceFileDetail;
  }

  original(id: string, principal?: FileOwner): SourceFile & { original: Uint8Array } {
    return this.file(id, principal, 'original') as SourceFile & { original: Uint8Array };
  }

  detailsFor(ids: readonly string[], principal?: FileOwner): SourceFileDetail[] {
    return [...new Set(ids)].map(id => this.details(id, principal));
  }

  private file(id: string, principal: FileOwner | undefined, include: 'text' | 'original') {
    const file = this.store.db.prepare(`SELECT ${fileFields},${include} FROM source_library_files WHERE org=? AND subject=? AND id=?`)
      .get(...owner(principal), id);
    if (!file) throw notFound();
    return file;
  }

  private duplicate(name: string, format: SourceFileFormat, checksum: string, principal?: FileOwner) {
    return this.store.db.prepare(`SELECT ${fileFields} FROM source_library_files WHERE org=? AND subject=? AND name=? AND format=? AND checksum=?`)
      .get(...owner(principal), name, format, checksum) as SourceFile | undefined;
  }

  findUpload(name: string, format: SourceFileFormat, original: Uint8Array, principal?: FileOwner) {
    return this.duplicate(name, format, digest(original), principal);
  }

  save(name: string, format: SourceFileFormat, original: Uint8Array, text: string, principal?: FileOwner): SourceFile {
    return this.store.transaction(() => this.insert(name, format, original, text, principal));
  }

  private insert(name: string, format: SourceFileFormat, original: Uint8Array, text: string, principal?: FileOwner): SourceFile {
    const checksum = digest(original);
    const existing = this.duplicate(name, format, checksum, principal);
    if (existing) return existing;
    const usage = this.store.db.prepare(`SELECT count(*) AS files,coalesce(sum(size),0) AS bytes FROM source_library_files WHERE org=? AND subject=?`)
      .get(...owner(principal))!;
    if (Number(usage.files) >= maxLibraryFiles || Number(usage.bytes) + original.byteLength > maxLibraryBytes)
      throw new ApiError(413, 'The source library is full. Remove a file to make room.');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.store.db.prepare(`INSERT INTO source_library_files(id,org,subject,name,format,size,checksum,created_at,text,original) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, ...owner(principal), name, format, original.byteLength, checksum, createdAt, text, original);
    const saveChunk = this.store.db.prepare(`INSERT INTO source_library_chunks(file_id,id,start,end,excerpt) VALUES(?,?,?,?,?)`);
    for (const chunk of libraryFilePassages({id,name,text})) saveChunk.run(id, chunk.id, chunk.start, chunk.end, chunk.excerpt);
    return {id,name,format,size:original.byteLength,characterCount:Array.from(text).length,createdAt};
  }

  saveLegacyAttachments(files: {name: string; text: string}[], principal?: FileOwner) {
    return this.store.transaction(() => files.map(file=>{
      const suffix = file.name.split('.').at(-1)?.toLowerCase();
      const format = suffix==='md' ? 'md' : 'txt';
      const name = suffix==='txt' || suffix==='md' ? file.name : file.name.slice(0, 156) + '.txt';
      return this.insert(name, format, Buffer.from(file.text,'utf8'), file.text, principal);
    }));
  }

  delete(id: string, principal?: FileOwner) {
    const result = this.store.db.prepare('DELETE FROM source_library_files WHERE org=? AND subject=? AND id=?').run(...owner(principal), id);
    if (!result.changes) throw notFound();
  }

  search(query: string, limit: number, principal?: FileOwner, ids?: readonly string[]): LessonCitation[] {
    const expression = passageQueryExpression(query);
    const selected = ids ? JSON.stringify(ids) : null;
    const hits = expression ? this.store.db.prepare(`SELECT ${hitFields}
      FROM source_library_fts JOIN source_library_chunks p ON p.rowid=source_library_fts.rowid JOIN source_library_files f ON f.id=p.file_id
      WHERE source_library_fts MATCH ? AND f.org=? AND f.subject=? AND (? IS NULL OR f.id IN (SELECT value FROM json_each(?)))
      ORDER BY rank,p.rowid LIMIT ?`).all(expression, ...owner(principal), selected, selected, limit * 8) as SourceHit[] : [];
    if (ids) {
      // A named attachment should still be represented on broad prompts such as “summarize”.
      for (const id of ids) {
        if (hits.some(hit=>hit.sourceFileId===id)) continue;
        const first = this.store.db.prepare(`SELECT ${hitFields} FROM source_library_chunks p JOIN source_library_files f ON f.id=p.file_id
          WHERE f.org=? AND f.subject=? AND f.id=? ORDER BY p.start LIMIT 1`).get(...owner(principal), id) as SourceHit | undefined;
        if (first) hits.push(first);
      }
    }
    const count = new Map<string,number>();
    const representatives: SourceHit[] = [];
    const additional: SourceHit[] = [];
    for (const hit of hits) {
      const seen = count.get(hit.sourceFileId) ?? 0;
      if (seen >= maxFileChunkCount) continue;
      count.set(hit.sourceFileId, seen + 1);
      if (ids && !seen) representatives.push(hit);
      else additional.push(hit);
    }
    return [...representatives,...additional].slice(0, limit).map(hit=>({...hit,kind:'source',field:'attachment.text'}));
  }

  deckSource(ids: readonly string[], notes: string | undefined, principal?: FileOwner) {
    const files = this.detailsFor(ids, principal);
    const name = files.map(file=>file.name).join(' · ').slice(0, 160);
    const excerpts = files.map(file=>files.length===1 && !notes ? file.text : `${file.name}\n${file.text}`);
    const text = [...excerpts, ...(notes ? [notes] : [])].join('\n\n');
    if (text.length > maxSourceText) throw new ApiError(413, 'The selected documents and notes exceed the 100,000-character lesson source limit.');
    return {name,text};
  }
}
