import { narrationRanges } from './typography';
import type { Locale, Slide } from './types';

export const narrationPrompts:Record<Locale,string>={
  en:'Rewrite the speaker notes on this slide for spoken delivery.',
  ru:'Перепиши заметки этого слайда для устного выступления.',
  kk:'Осы слайдтың жазбаларын ауызша баяндауға лайықтап қайта жаз.',
};
export function narrationSource(slide:Pick<Slide,'notes'|'body'|'title'>) {
  return slide.notes.trim() || slide.body.trim() || slide.title.trim();
}
export function narrationParagraphs(slide: Pick<Slide, 'notes' | 'body' | 'title'>) {
  return narrationSource(slide).split(/\n+/u).map(line => line.trim()).filter(Boolean);
}

const rusUnits='ноль один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать'.split(' ');
const rusTens='ноль десять двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто'.split(' ');
const rusHundreds='ноль сто двести триста четыреста пятьсот шестьсот семьсот восемьсот девятьсот'.split(' ');
const kazUnits='нөл бір екі үш төрт бес алты жеті сегіз тоғыз'.split(' ');
const kazTens='нөл он жиырма отыз қырық елу алпыс жетпіс сексен тоқсан'.split(' ');
function ruForm(n:number,one:string,few:string,many:string) {
  const digit=n%10;
  return n%100>=11 && n%100<=14 ? many : digit===1 ? one : digit>=2 && digit<=4 ? few : many;
}
function belowThousand(n:number,language:'ru'|'kk',feminine:boolean):string {
  const h=Math.floor(n/100),tail=n%100,t=Math.floor(tail/10),u=tail%10;
  if(language==='kk') return [h>1 && kazUnits[h],h>0 && 'жүз',t>0 && kazTens[t],u>0 && kazUnits[u]].filter(Boolean).join(' ');
  const last=tail<20 ? tail : u;
  const unit=!last ? '' : feminine && last===1 ? 'одна' : feminine && last===2 ? 'две' : rusUnits[last];
  return [h>0 && rusHundreds[h],tail>=20 && rusTens[t],unit].filter(Boolean).join(' ');
}
function cardinal(raw:string,language:'ru'|'kk',feminine=false):string {
  const digits=language==='ru' ? rusUnits : kazUnits;
  if(raw.length>9 || /^0\d/u.test(raw)) return Array.from(raw,d=>digits[Number(d)]).join(' ');
  let n=Number(raw);
  if(!n) return digits[0];
  const words:string[]=[];
  for(const scale of [1_000_000,1000]) {
    const part=Math.floor(n/scale); n%=scale;
    if(!part) continue;
    if(!(language==='kk' && part===1 && scale===1000)) words.push(belowThousand(part,language,scale===1000));
    words.push(language==='kk' ? scale===1000 ? 'мың' : 'миллион' : scale===1000 ?
      ruForm(part,'тысяча','тысячи','тысяч') : ruForm(part,'миллион','миллиона','миллионов'));
  }
  if(n) words.push(belowThousand(n,language,feminine));
  return words.join(' ');
}

export function matchingLocalVoice<T extends {lang:string;localService:boolean}>(voices:readonly T[],language:Locale) {
  const matching=voices.filter(voice=>voice.localService===true && voice.lang.toLowerCase().split(/[-_]/u)[0]===language);
  const preferred={en:'en-us',ru:'ru-ru',kk:'kk-kz'}[language];
  return matching.find(voice=>voice.lang.toLowerCase().replace('_','-')===preferred) ?? matching[0];
}

const genitive=new Map([
  ...rusUnits.map((word,i)=>[word,'нуля одного двух трёх четырёх пяти шести семи восьми девяти десяти одиннадцати двенадцати тринадцати четырнадцати пятнадцати шестнадцати семнадцати восемнадцати девятнадцати'.split(' ')[i]] as const),
  ...rusTens.map((word,i)=>[word,'нуля десяти двадцати тридцати сорока пятидесяти шестидесяти семидесяти восьмидесяти девяноста'.split(' ')[i]] as const),
  ...rusHundreds.map((word,i)=>[word,'нуля ста двухсот трёхсот четырёхсот пятисот шестисот семисот восьмисот девятисот'.split(' ')[i]] as const),
  ['одна','одной'],['две','двух'],['тысяча','тысячи'],['тысячи','тысяч'],['миллион','миллиона'],['миллиона','миллионов'],
]);
function ruRangeNumber(raw:string) {return cardinal(raw,'ru').split(' ').map(word=>genitive.get(word) ?? word).join(' ');}
function kkRangeNumber(raw:string,from:boolean) {
  const words=cardinal(raw,'kk').split(' '), last=words.pop()!;
  const front=/[еәіөү][^аоыұяеәіөү]*$/u.test(last), voiceless=/[пфктсшщхцчқ]$/u.test(last);
  const suffix=from ? (/[мнң]$/u.test(last)?'н':voiceless?'т':'д')+(front?'ен':'ан') :
    (front ? voiceless?'к':'г' : voiceless?'қ':'ғ')+(front?'е':'а');
  return [...words,last+suffix].join(' ');
}
const operators={
  ru:{'+':'плюс','-':'минус','−':'минус','*':'умножить на','×':'умножить на','·':'умножить на','/':'разделить на','÷':'разделить на','=':'равно','≤':'меньше или равно','≥':'больше или равно','<':'меньше','>':'больше'},
  kk:{'+':'қосу','-':'азайту','−':'азайту','*':'көбейту','×':'көбейту','·':'көбейту','/':'бөлу','÷':'бөлу','=':'тең','≤':'кіші немесе тең','≥':'үлкен немесе тең','<':'кіші','>':'үлкен'},
};
export function spokenNarration(raw:string,language:Locale) {
  const ranges=narrationRanges(raw,language);
  if(language==='en') return ranges;
  const protectedPart=/(https?:\/\/[^\s]+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\x60[^\x60\n]+\x60|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/gu;
  return ranges.split(protectedPart).map((chunk,index)=>{
    if(index%2) return chunk;
    const ranged=language==='ru' ? chunk.replace(/(?<!\p{L})от (\d+) до (\d+)(?![\p{L}\d]|[.,]\d)/gu,(_m,a,b)=>'от '+ruRangeNumber(a)+' до '+ruRangeNumber(b)) :
      chunk.replace(/(?<![\p{L}\d])(\d+) бастап (\d+) дейін/gu,(_m,a,b)=>kkRangeNumber(a,true)+' '+kkRangeNumber(b,false)+' дейін');
    const text=ranged.replace(/(?<=[\p{L}\d)])(?:²|\^2(?!\d))/gu,language==='ru'?' в квадрате':' квадрат')
      .replace(/(?<=[\p{L}\d)])(?:³|\^3(?!\d))/gu,language==='ru'?' в кубе':' куб')
      .replace(/(?<=[\p{L}\d)])\s*([+=×·*÷/≤≥<>−])\s*(?=[\p{L}\d(+-])/gu,(_m,op:keyof typeof operators.ru)=>' '+operators[language][op]+' ')
      .replace(/(?<=\d)\s*-\s*(?=\d)|(?<=\p{L})\s+-\s+(?=[\p{L}\d])/gu,' '+operators[language]['-']+' ')
      .replace(/(?<![\p{L}\d])[-−](?=\d)/gu,'минус ');
    return text.replace(/(?<![\p{L}\d])((?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+))(?:([.,])(\d+))?(?:\s*(%))?(?![\p{L}\d])/gu,
      (_m,integer:string,_separator:string|undefined,fraction:string|undefined,pct:string|undefined)=>{
        const rawInteger=integer.replace(/\s/gu,'');
        const n=Number(rawInteger);
        let result=cardinal(rawInteger,language,!!fraction && language==='ru');
        if(fraction) {
          if(fraction.length<=3) {
            const num=Number(fraction),tail=String(num);
            if(language==='kk') result+=' бүтін '+['оннан','жүзден','мыңнан'][fraction.length-1]+' '+cardinal(tail,language);
            else {
              const denom=['десят','сот','тысячн'][fraction.length-1];
              const suffix=ruForm(num,'ая','ых','ых');
              result+=' '+ruForm(n,'целая','целых','целых')+' '+cardinal(tail,language,true)+' '+denom+suffix;
            }
          } else result+=(language==='ru'?' запятая ':' үтір ')+Array.from(fraction,d=>cardinal(d,language)).join(' ');
        }
        if(pct) result+=' '+(language==='kk'?'пайыз':fraction?'процента':ruForm(n,'процент','процента','процентов'));
        return result;
      });
  }).join('');
}

// Deterministic fallback for lists and presentation shorthand when the local model is unavailable.
export function spokenNotesDraft(raw:string,locale:Locale) {
  const sentences=raw.trim().split(/\n+/u).map(line=>line.trim().replace(/^\s*(?:[•▪–-]|\d{1,2}[.)])\s+/u,'')).filter(Boolean);
  const next={en:'Then',ru:'Затем',kk:'Содан кейін'}[locale];
  const imperative={
    en:/^(?:collect|compare|record|discuss|measure|try|look|observe|explain|show|find|ask|write|read|check)\b/iu,
    ru:/^(?:соберите|сравните|запишите|обсудите|измерьте|посмотрите|объясните|покажите|найдите|проверьте)(?!\p{L})/iu,
    kk:/^(?:салыстырыңыз|өлшеңіз|қараңыз|көрсетіңіз|табыңыз|тексеріңіз|жазыңыз)(?!\p{L})/iu,
  }[locale];
  const close=(text:string)=>/[.!?…»”]$/u.test(text) ? text : text+'.';
  return sentences.map((line,i)=>{
    const expanded=line.replace(/;\s*/gu,'. ').replace(/\be\.g\.\s*/giu,'for example, ').replace(/\bi\.e\.\s*/giu,'that is, ')
      .replace(/(?<!\p{L})т\.\s*е\.\s*/giu,'то есть ').replace(/(?<!\p{L})т\.\s*к\.\s*/giu,'потому что ');
    if(i>0 && imperative.test(expanded)) return next+' '+close(expanded[0].toLocaleLowerCase(locale)+expanded.slice(1));
    return close(expanded);
  }).join('\n');
}
