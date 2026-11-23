import type { JSONContent } from '@tiptap/core';
import type { Locale, Slide } from './types';

const glue='\u00a0';
const protectedText=/(\([+-]?\d+(?:\.\d+)?(?:\s*,\s*[+-]?\d+(?:\.\d+)?)+\)|https?:\/\/[^\s]+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\x60[^\x60\n]+\x60|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b)/gu;
const number=/((?<![\p{L}\p{N}.,])\d{1,3}(?:[ \u00a0\u202f]\d{3})+|(?<![\p{L}\p{N}.,])\d+)([.,]\d+)?(?![\p{L}\p{N}.,]\d)/gu;
const units=/(\d)[ \u00a0\u202f]*(%|₸|°[CFС]|мл|л|мг|кг|г|мм|см|км|м|mL|ml|L|kg|mg|mm|cm|km|m|g)(?![\p{L}\p{N}])/gu;
const russian=/(?<![\p{L}\p{N}])((?:без|для|под|при|над|ото|из|от|во|на|до|ко|по|об|со|за|у|в|с|к|о))[ \t]+(?=\S)/giu;
const kazakh=/(?<=\S)[ \t]+(да|де|та|те|мен|бен|пен|үшін|соң|дейін)(?![\p{L}\p{N}])/giu;
export function slideTypography(raw:string,locale:Locale) {
  return raw.split(protectedText).map((part,i)=>{
    if(i%2) return part;
    const quote=(text:string)=>locale==='en'?'“'+text+'”':'«'+text+'»';
    let value=part.replace(/"([^"\n]+)"|“([^”\n]+)”|«([^»\n]+)»/gu,(_m,a,b,c)=>quote(a??b??c));
    // Ranges are explicit. Leave arithmetic and signed values alone.
    value=value.replace(/(?<![\p{L}\p{N}])((?:1[0-9]|20)\d{2})\s*[-—–]\s*((?:1[0-9]|20)\d{2})(?!\d)/gu,'$1–$2')
      .replace(/\b([IVXLCDM]+)\s*[-—–]\s*([IVXLCDM]+)\b/gu,'$1–$2')
      .replace(/(\d+)\s*[-—–]\s*(\d+)(?=[ \t]+(?:сынып|класс|страниц|бет|grades?|pages?))/giu, '$1–$2')
      .replace(/(\b(?:grades?|pages?)[ \t]+)(\d+)[ \t]*[-—–][ \t]*(\d+)/giu,'$1$2–$3');
    if(locale==='en') value=value.replace(/(?<![\p{L}\d.,])(\d{1,3}(?:,\d{3})+)(?=\.\d|,(?!\d)|[^\d,]|$)/gu,match=>match.replace(/,/g,glue));
    value=value.replace(number,(match,integer:string,fraction:string|undefined,offset:number)=>{
      const digits=integer.replace(/[ \u00a0\u202f]/g,'');
      // A four-digit year in running prose retains its customary ungrouped form.
      const followedByUnit=/^[ \t\u00a0\u202f]*(?:%|₸|°[CFС]|мл|л|мг|кг|г|мм|см|км|м|mL|ml|L|kg|mg|mm|cm|km|m|g)(?![\p{L}\p{N}])/u.test(value.slice(offset+match.length));
      const year=integer===digits && !fraction && !followedByUnit && /^(?:1[6-9]|20|21)\d{2}$/.test(digits);
      if (/^0\d/.test(digits) || /[\p{L}_]/u.test(value[offset-1]??'')) return match;
      const grouped=year ? digits : digits.replace(/\B(?=(\d{3})+(?!\d))/g,glue);
      return grouped+(fraction ? (locale==='en'?fraction[0]:',')+fraction.slice(1) : '');
    }).replace(units,'$1'+glue+'$2');
    if(locale==='ru') value=value.replace(russian,'$1'+glue);
    if(locale==='kk') value=value.replace(kazakh,glue+'$1');
    return value;
  }).join('');
}

function bindRunSpaces<T extends {text?:string}>(runs:T[], locale:Locale):T[] {
  if (runs.length<2) return runs;
  // A mark can split a preposition from its noun or an amount from its unit.
  // Keep each replacement the same length so the original marks retain their ranges.
  const bind=(match:string)=>match.replace(/[ \t]/gu,glue);
  const text=runs.map(run=>run.text??'\n').join('').split(protectedText).map((part,index)=>{
    if (index%2) return part;
    const joined=part.replace(units,bind);
    if (locale==='ru') return joined.replace(russian,bind);
    if (locale==='kk') return joined.replace(kazakh,bind);
    return joined;
  }).join('');
  let offset=0;
  return runs.map(run=>{
    const start=offset;
    offset+=run.text?.length??1;
    return run.text===undefined ? run : {...run,text:text.slice(start,offset)};
  });
}

export function displaySlide(slide:Slide, locale:Locale):Slide {
  const format=(text:string)=>slideTypography(text,locale);
  const rich=(node:JSONContent):JSONContent=>({...node,...(node.text!==undefined && {text:format(node.text)}),
    ...(node.content && {content:bindRunSpaces(node.content,locale).map(rich)})});
  const bodyRuns=slide.bodyRuns && bindRunSpaces(slide.bodyRuns,locale).map(run=>({...run,text:format(run.text)}));
  const fromRuns=slide.bodyRuns?.map(run=>run.text).join('')===slide.body;
  return {...slide,title:format(slide.title),body:bodyRuns && fromRuns?bodyRuns.map(run=>run.text).join(''):format(slide.body),
    ...(bodyRuns && {bodyRuns}),...(slide.richText && {richText:{
      ...(slide.richText.title && {title:rich(slide.richText.title)}),...(slide.richText.body && {body:rich(slide.richText.body)})}}),
    ...(slide.answer && {answer:format(slide.answer)}),
    ...(slide.design && {design:{...slide.design,...(slide.design.eyebrow && {eyebrow:format(slide.design.eyebrow)}),
      ...(slide.design.takeaway && {takeaway:format(slide.design.takeaway)}),
      ...(slide.design.cards && {cards:slide.design.cards.map(card=>({title:format(card.title),text:format(card.text)}))})}}),
    ...(slide.table && {table:{headers:slide.table.headers.map(format),rows:slide.table.rows.map(row=>row.map(v=>format(String(v))))}}),
    ...(slide.diagram && {diagram:{...slide.diagram,nodes:slide.diagram.nodes.map(format)}}),
    ...(slide.chart && {chart:{...slide.chart,categories:slide.chart.categories.map(format),
      series:slide.chart.series.map(s=>({...s,name:format(s.name)}))}}),
  };
}

export function narrationRanges(raw:string, locale:Locale) {
  return raw.split(protectedText).map((part,i)=>{
    if (i%2) return part;
    return part.replace(/(?<![\p{L}\d])((?:1\d|20)\d{2}|[IVXLCDM]+)[ \t]*[-–—][ \t]*((?:1\d|20)\d{2}|[IVXLCDM]+)(?![\p{L}\d])|(\d+)[ \t]*[–—][ \t]*(\d+)|(\d+)[ \t]*-[ \t]*(\d+)(?=[ \t]+(?:сынып|класс|страниц|бет))/gu,
      (_match,a,b,c,d,e,f)=>{
        const first=a??c??e,last=b??d??f;
        return locale==='ru'?'от '+first+' до '+last : locale==='kk'?first+' бастап '+last+' дейін' : 'from '+first+' to '+last;
      });
  }).join('');
}
