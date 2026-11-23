import { unsupportedQuantitiesAndDates } from './measurements';

// These checks cover exact figures and attributed wording; teachers still review interpretations.
export function unsupportedClaims(text:string, excerpts:string[]) {
  const normalize = (value:string)=>value.normalize('NFKC').replace(/\s+/gu,' ').trim();
  const numerals = (value:string)=>value.matchAll(/[+−-]?\d+(?:[.,]\d+)?/gu);
  const numberKey = (value:string)=>value.replace('−','-').replace(',','.');
  const corpus = excerpts.map(normalize);
  const known = new Set(corpus.flatMap(value=>[...numerals(value)].map(match=>numberKey(match[0]))));
  const claims = normalize(text.replace(/\[\[E\d+\]\]/g,'').replace(/^\d+\.\s/gm,''));
  const unmatched = unsupportedQuantitiesAndDates(claims,corpus);
  for (const match of numerals(claims)) {
    if (!known.has(numberKey(match[0])) && !unmatched.some(token=>match.index>=token.start && match.index<token.start+token.value.length))
      unmatched.push({key:match[0],value:match[0],start:match.index});
  }
  const numbers = [...new Set(unmatched.sort((a,b)=>a.start-b.start).map(token=>token.value))];
  const quotations = claims.matchAll(/“([^”]{3,})”|«([^»]{3,})»|"([^"]{3,})"/gu);
  return {numbers,quotations:[...quotations].filter(match=>!corpus.some(excerpt=>excerpt.includes(match[1] ?? match[2] ?? match[3]))).length};
}

export function supportedClaims(text:string, excerpts:string[]) {
  const missing = unsupportedClaims(text,excerpts);
  return !missing.numbers.length && !missing.quotations;
}

/** Attach each run of inline citations to the preceding claim, including adjacent joint citations. */
export function supportedCitedClaims(reply: string, excerpts: ReadonlyMap<string, string>) {
  const markers = /\[\[E\d+\]\](?:[ \t,]*\[\[E\d+\]\])*/gu;
  let position = 0;
  let marked = false;
  for (const match of reply.matchAll(markers)) {
    const group = [...match[0].matchAll(/\[\[(E\d+)\]\]/gu)].map(key => excerpts.get(key[1]));
    if (group.some(value => value === undefined)) return false;
    if (!supportedClaims(reply.slice(position, match.index), group as string[])) return false;
    marked = true;
    position = match.index + match[0].length;
  }
  // A single source can support an unmarked answer. Multiple sources need explicit
  // attribution for numbers and direct quotations, even when their union contains both.
  const tail = reply.slice(position);
  if (!marked && excerpts.size === 1) return supportedClaims(tail, [...excerpts.values()]);
  return supportedClaims(tail, []);
}
