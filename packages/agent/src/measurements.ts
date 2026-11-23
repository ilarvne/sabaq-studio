// Only match explicit quantities and calendar dates. Plain numbers remain covered by supportedClaims.
const unitGroups = [
  ['ml','мл','milliliters','millilitres','миллилитров'], ['l','л','liters','litres','литров'],
  ['mm','мм'],['cm','см'],['m','м','metres','meters'],['km','км'],['mg','мг'],['g','грамм','grams'],['kg','кг'],
  ['°c','°с'],['°f'],['%','percent','процентов','пайыз'],
];
const units = new Map(unitGroups.flatMap(group=>group.map(alias=>[alias,group[0]] as const)));
const quantity = new RegExp('([+−-]?\\d+(?:[.,]\\d+)?)\\s*('+[...units.keys()].sort((a,b)=>b.length-a.length).join('|')+')(?=$|[^\\p{L}\\p{N}])','giu');
const months = [
  ['january','января','январь','қаңтар'],['february','февраля','февраль','ақпан'],
  ['march','марта','март','наурыз'],['april','апреля','апрель','сәуір'],
  ['may','мая','май','мамыр'],['june','июня','июнь','маусым'],
  ['july','июля','июль','шілде'],['august','августа','август','тамыз'],
  ['september','сентября','сентябрь','қыркүйек'],['october','октября','октябрь','қазан'],
  ['november','ноября','ноябрь','қараша'],['december','декабря','декабрь','желтоқсан'],
];
const monthNumber=new Map(months.flatMap((group,i)=>group.map(name=>[name,i+1] as const)));
const monthNames=[...monthNumber.keys()].join('|');
const forward=new RegExp('(?<![\\p{L}\\d])(?:(\\d{4})\\s+жылғы\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+('+monthNames+')(?![\\p{L}])(?:[,]?\\s+(\\d{4})(?!\\d))?','giu');
const american=new RegExp('(?<![\\p{L}])('+monthNames+')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?!\\d)','giu');
type Token={key:string;value:string;start:number};
function tokens(text:string, evidence:boolean) {
  const result:Token[]=[];
  function add(key:string,match:RegExpExecArray) {
    result.push({key,value:match[0],start:match.index});
  }
  function date(match:RegExpExecArray,day:string,month:number,year?:string) {
    if (year) add('date:'+year+'-'+month+'-'+Number(day),match);
    if (!year || evidence) add('date:'+month+'-'+Number(day),match);
  }
  for(const match of text.matchAll(quantity)) {
    const [,value,unit]=match;
    add('quantity:'+value.replace(',','.').replace('−','-')+':'+units.get(unit.toLowerCase()),match);
  }
  for(const match of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu)) date(match,match[3],Number(match[2]),match[1]);
  for(const match of text.matchAll(/(?<!\d)(\d{1,2})[.](\d{1,2})[.](\d{4})(?!\d)/gu)) date(match,match[1],Number(match[2]),match[3]);
  for(const match of text.matchAll(forward)) date(match,match[2],monthNumber.get(match[3].toLowerCase())!,match[1]??match[4]);
  for(const match of text.matchAll(american)) date(match,match[2],monthNumber.get(match[1].toLowerCase())!,match[3]);
  return result;
}

export function unsupportedQuantitiesAndDates(claim:string, excerpts:string[]) {
  const known=new Set(excerpts.flatMap(text=>tokens(text,true).map(token=>token.key)));
  return tokens(claim,false).filter(token=>!known.has(token.key));
}
