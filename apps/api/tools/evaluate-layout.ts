import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { reviewSlides } from '../src/lessons/quality';
import { catalogRoot, defaultMediaRoot } from '../src/runtime-paths';

const opts=parseArgs({options:{manifest:{type:'string'},database:{type:'string'},gate:{type:'boolean'}}}).values;
if (Boolean(opts.manifest)!==Boolean(opts.database)) throw Error('Supply both --manifest and --database for reference snapshots.');
const selection=z.array(z.strictObject({deck:z.string().min(1),revision:z.number().int().nonnegative(),subject:z.string().min(1).max(140)})).min(1).max(500);
const references=opts.manifest ? selection.parse(JSON.parse(await readFile(opts.manifest,'utf8'))) : [];
const db=opts.database ? new DatabaseSync(resolve(opts.database),{readOnly:true}) : undefined;
const media=opts.database ? resolve(dirname(resolve(opts.database)),'media') : defaultMediaRoot;
const counts={kk:0,ru:0,en:0};
const subjects=new Set<string>(), topics=new Set<string>();
const checked=new Set<string>();
let slides=0, failed=0, unreviewed=0;
try {
  const fixtures=(['kk','ru','en'] as Locale[]).map(lang=>makeFixtureDeck(lang));
  const decks: Iterable<{deck:Deck;subject:string}>=db ? (function*(){
    const lookup=db.prepare('SELECT data FROM revisions WHERE deck_id=? AND revision=?');
    for(const ref of references){
      if(checked.has(ref.deck)) throw Error('Choose one revision per distinct lesson.');
      checked.add(ref.deck);
      const row=lookup.get(ref.deck,ref.revision);
      if(!row) throw Error('Requested lesson revision is missing: '+ref.deck);
      yield {deck:JSON.parse(String(row.data)) as Deck,subject:ref.subject};
    }
  })() : fixtures.map(deck=>({deck,subject:'measurements'}));
  for(const {deck,subject} of decks){
    counts[deck.language]++;
    subjects.add(subject);
    topics.add(deck.topic.trim().toLocaleLowerCase(deck.language));
    const review=await reviewSlides(deck,{catalog:catalogRoot,generated:media},{},AbortSignal.timeout(60000));
    const issues=Object.entries(review.reports).filter(([,report])=>report.issues.length)
      .map(([id,report])=>({id,issues:report.issues}));
    const incomplete=deck.slides.length-review.slides.length;
    slides+=review.slides.length;
    failed+=issues.length;
    unreviewed+=review.state==='unavailable' ? deck.slides.length : incomplete;
    console.log(JSON.stringify({deck:deck.id,revision:deck.revision,language:deck.language,state:review.state,incomplete,issues}));
  }
  const extendedCoverage=counts.kk===40 && counts.ru===40 && counts.en===20 && subjects.size>=8 && topics.size===100;
  console.log(JSON.stringify({source:db?'reference snapshots':'bundled classroom fixture translations',counts,subjects:subjects.size,
    topics:topics.size,readySlides:slides,slidesWithIssues:failed,unreviewed,extendedCoverage}));
  if(opts.gate && (!extendedCoverage || failed || unreviewed)) process.exitCode=1;
}finally{db?.close();}
