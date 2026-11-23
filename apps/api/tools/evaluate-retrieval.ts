import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { performance } from 'node:perf_hooks';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { alemEmbedder, alemEmbeddingModel } from '../src/assistant/alem-retrieval';
import { searchLesson } from '../src/assistant/lesson-retrieval';
import { StudioStore } from '../src/persistence/storage';

const passages = {
  en: ['Roots absorb water from the soil.', 'The Moon orbits the Earth.', 'Evaporation turns liquid water into vapor.', 'A thermometer measures temperature.'],
  ru: ['Корни поглощают влагу из почвы.', 'Луна вращается вокруг Земли.', 'При испарении жидкая вода превращается в пар.', 'Термометр измеряет температуру.'],
  kk: ['Тамыр топырақтан су сіңіреді.', 'Ай Жерді айналады.', 'Булану кезінде сұйық су буға айналады.', 'Термометр температураны өлшейді.'],
};
const questions = {
  en: ['How does moisture enter a plant?', 'What goes around our planet?', 'How can a puddle disappear into the air?', 'Which instrument tells us how hot it is?'],
  ru: ['Как влага попадает в растение?', 'Какой спутник движется вокруг нашей планеты?', 'Куда со временем исчезает лужа?', 'Каким прибором узнают, насколько тепло?'],
  kk: ['Өсімдік ылғалды қайдан алады?', 'Ғаламшарымыздың табиғи серігі қандай?', 'Шалшықтың суы ауаға қалай кетеді?', 'Ауаның жылуын қандай құралмен білеміз?'],
};
const args = parseArgs({options:{corpus:{type:'string'},'lexical-only':{type:'boolean'},alem:{type:'boolean'}}}).values;
const localeSchema = z.enum(['en','ru','kk']);
const id = z.string().trim().min(1).max(160);
const corpusSchema = z.array(z.strictObject({
  id, language:localeSchema,
  passages:z.array(z.strictObject({id,text:z.string().trim().min(1).max(6000)})).min(1).max(40),
  questions:z.array(z.strictObject({query:z.string().trim().min(1).max(600),language:localeSchema,relevant:z.array(id).max(40)})).min(1).max(500),
})).min(1).max(500);
const defaults = (['en','ru','kk'] as Locale[]).map(language=>({
  id:language,language,passages:passages[language].map((text,i)=>({id:String(i),text})),
  questions:questions[language].map((query,i)=>({query,language,relevant:[String(i)]})),
}));
const corpus = corpusSchema.parse(args.corpus ? JSON.parse(await readFile(args.corpus,'utf8')) : defaults);
if (new Set(corpus.map(lesson=>lesson.id)).size!==corpus.length) throw Error('Lesson IDs must be unique.');
for (const lesson of corpus) {
  const ids=new Set(lesson.passages.map(p=>p.id));
  if (ids.size!==lesson.passages.length || lesson.questions.some(q=>q.relevant.some(label=>!ids.has(label))))
    throw Error('Each lesson needs distinct passage IDs and valid relevance labels.');
}

if (args.alem && args['lexical-only']) throw Error('Choose either --alem or --lexical-only.');
if (args.alem && !alemEmbedder()) throw Error('Alem evaluation requires ALEM_EMBEDDINGS_API_KEY and an approved origin in gateway mode.');
const model = args.alem ? alemEmbeddingModel : process.env.STUDIO_EMBEDDING_MODEL || 'bge-m3:latest';
const modes = args['lexical-only'] ? ['lexical'] as const : ['lexical','hybrid'] as const;
for (const mode of modes) {
  const allowAlem = args.alem && mode === 'hybrid';
  process.env.STUDIO_EMBEDDING_MODEL = mode === 'hybrid' && !allowAlem ? model : '';
  const store = new StudioStore(':memory:');
  try {
    for (const lesson of corpus) {
      const deck:Deck = {
        id:lesson.id,topic:'',title:'',language:lesson.language,theme:'notebook',revision:1,updatedAt:new Date().toISOString(),
        provider:'fixture',phase:'editing',outline:[],slides:lesson.passages.map(({id,text})=>({
          id,title:'',body:text,notes:'',status:'ready',version:1,layout:'body',lessonPart:'',
        })),
      };
      store.saveRevision(deck,'Evaluation');
      const languages=new Set(lesson.questions.map(question=>question.language));
      for (const language of languages) {
        let top1=0,top3=0,reciprocal=0,usedHybrid=0,answerable=0,negativeReturnedCandidates=0;
        const times:number[]=[];
        const queries=lesson.questions.filter(q=>q.language===language);
        for (const question of queries) {
          const begin=performance.now();
          const result=await searchLesson(store,deck,question.query,AbortSignal.timeout(40000),3,{allowAlem});
          times.push(Math.round(performance.now()-begin));
          if(result.mode==='hybrid') usedHybrid++;
          if(question.relevant.length) {
            answerable++;
            const rank=result.hits.findIndex(hit=>hit.slideId && question.relevant.includes(hit.slideId))+1;
            if(rank===1) top1++;
            if(rank) {top3++;reciprocal+=1/rank;}
          } else if(result.hits.length) negativeReturnedCandidates++;
        }
        console.log(JSON.stringify({mode,lesson:lesson.id,sourceLanguage:lesson.language,queryLanguage:language,
          model:mode==='hybrid'?model:undefined,queries:queries.length,answerable,top1,top3,
          mrrAt3:answerable?reciprocal/answerable:null,unanswerable:queries.length-answerable,negativeReturnedCandidates,
          usedHybrid,latencyMs:times}));
        if(mode==='hybrid' && usedHybrid!==queries.length) process.exitCode=1;
      }
    }
  } finally {store.db.close();}
}
