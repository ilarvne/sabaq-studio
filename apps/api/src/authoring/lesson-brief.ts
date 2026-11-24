import type {CreateInput, Deck, OutlineItem, Slide, SpeechProfile} from '@sabaq/lesson/types';
import {z} from 'zod';
import { eligibleForIllustration, planIllustratedOutline, requestedImageMode } from './image-mode';
import { isImageLayout, planOutlineLayouts } from './layout-planner';

const labels={
  en:{image:'An illustration showing',check:'Check your understanding',question:(topic:string)=>`Which example illustrates ${topic}, and why?`,summary:'Lesson summary',recall:(topic:string)=>`Summarize what we learned about ${topic}.`,answer:'Explain your reasoning and support it with an example from the lesson.'},
  ru:{image:'Иллюстрация по теме',check:'Контрольный вопрос',question:(topic:string)=>`Какой пример иллюстрирует тему «${topic}» и почему?`,summary:'Итог урока',recall:(topic:string)=>`Подведите итог по теме «${topic}».`,answer:'Объясните свой ответ и приведите пример из урока.'},
  kk:{image:'Тақырыпты бейнелейтін сурет',check:'Бақылау сұрағы',question:(topic:string)=>`«${topic}» тақырыбын қандай мысалмен түсіндіруге болады? Неліктен?`,summary:'Сабақ қорытындысы',recall:(topic:string)=>`«${topic}» тақырыбы бойынша білгеніңізді қорытындылаңыз.`,answer:'Жауабыңызды түсіндіріп, сабақтан мысал келтіріңіз.'},
};

export function completeBrief(deck:Deck,items:OutlineItem[],answers?:CreateInput['answers']):OutlineItem[] {
  const t=labels[deck.language];
  const mode = requestedImageMode(deck.imageMode, answers);
  const allowImages = deck.imageSource !== 'none' && mode !== 'none';
  const direction = answers?.imageInstruction?.trim();
  const isAssessment = (item:OutlineItem) => item.assessment || item.role === 'reflection' ||
    /check your understanding|assessment|quiz|контрольн.*вопрос|вопрос для проверки|бақылау сұра|тексеру сұра/iu.test(item.title);
  const candidate=items.findIndex(isAssessment);
  const checkIndex=candidate >= 0 ? candidate : items.length - 1;
  const brief = items.map((original,index)=>{
    let item=original;
    if(answers?.quiz==='include' && index===checkIndex) {
      const question=answers.quizInstruction?.trim();
      if (question || candidate < 0) {
        const summary=question || t.question(deck.topic);
        item={...item,title:candidate < 0 ? t.check : item.title,summary,purpose:summary,assessment:true,narrationDraft:summary};
      } else item={...item,assessment:true};
    } else if(answers?.quiz==='omit' && isAssessment(item)) {
      const summary=t.recall(deck.topic);
      item={...item,title:t.summary,summary,purpose:summary,narrationDraft:summary,assessment:false};
    }
    const eligible = allowImages && eligibleForIllustration(item);
    const visualDescription=!eligible ? undefined : deck.imageSource==='own'
      ? index===0 ? deck.ownIllustration?.alt || undefined : undefined
      : [item.visualDescription,mode==='auto' ? direction : undefined].filter(Boolean).join(' ').slice(0,400) || undefined;
    const imageScenes = eligible && deck.imageSource !== 'own' && item.layout==='image-grid' ? item.imageScenes : undefined;
    return {...item,visualDescription,imageScenes,
      narrationDraft:item.narrationDraft ?? item.summary};
  });
  const layouts = deck.provider === 'fixture' || deck.powerPointStyle ? brief
    : planOutlineLayouts(brief, index => allowImages && (deck.imageSource !== 'own' || index === 0 && !!deck.ownIllustration),
      mode === 'auto' && deck.imageSource !== 'own' && !direction);
  if (!allowImages || deck.imageSource==='own' || (mode!=='illustrated' && mode!=='image-led')) return layouts;
  return planIllustratedOutline(layouts,mode).map((item,index)=>{
    if (!eligibleForIllustration(item) || (!isImageLayout(item.layout) && !(index===0 && item.layout==='cover'))) return item;
    // The gallery already has a scene for each frame. The optional brief adjusts all of them.
    const scene = item.visualDescription || (item.imageScenes?.length ? undefined : t.image+' «'+item.title+'».');
    return {...item,visualDescription:[scene,direction].filter(Boolean).join(' ').slice(0,400) || undefined};
  });
}

export function completeAssessment(deck:Deck,item:OutlineItem,slide:Partial<Slide>,answers?:CreateInput['answers']):Partial<Slide> {
  if (answers?.quiz==='omit') return {...slide, answer:undefined};
  if (!item.assessment) return slide;
  return {...slide,title:item.title,body:item.summary,answer:slide.answer || labels[deck.language].answer};
}

const profile=z.object({org:z.string().optional(),subject:z.string().optional(),language:z.enum(['en','ru','kk']),
  voice:z.string().regex(/^[\w.-]{1,100}$/),wordsPerMinute:z.number().min(40).max(400)}).strict();

export function configuredSpeechProfile(language:Deck['language'],owner?:{org:string;subject:string}):SpeechProfile|undefined {
  let value:unknown;
  try {value=JSON.parse(process.env.STUDIO_NARRATION_PROFILES ?? '[]');} catch {return;}
  const profiles=z.array(profile).max(500).safeParse(value);
  if(!profiles.success) return;
  const selected=profiles.data.filter(p=>p.language===language && (!p.org || p.org===owner?.org) &&
    (!p.subject || p.org && p.subject===owner?.subject)).sort((a,b)=>Number(!!b.subject)-Number(!!a.subject)||Number(!!b.org)-Number(!!a.org))[0];
  if(selected) return {voice:selected.voice,language,wordsPerMinute:selected.wordsPerMinute};
}
