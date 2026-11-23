import type { Deck, Locale, Slide } from './types';

export type TranslationReport = {
  sourceDeckId: string; sourceRevision: number; sourceLanguage: Locale; familyId: string;
  checkedSlides: number; translatedFields: number;
};
export type RelatedVersion = {id:string;title:string;language:Locale;revision:number;added:number;removed:number;reordered:boolean;writable?:boolean};
type Copy = Pick<Slide,'title'|'body'|'notes'>;
export type VersionComparison = {sourceLanguage:Locale;language:Locale;report:TranslationReport;slides:{before:Copy;after:Copy}[]};

export function compareVersion(source:Deck,translated:Deck): VersionComparison {
  const copy = ({title,body,notes}:Slide):Copy=>({title,body,notes});
  const originals = new Map(source.slides.map(slide=>[slide.id,slide]));
  return {sourceLanguage:source.language,language:translated.language,report:translated.translation!,
    slides:translated.slides.flatMap(slide=>{
      const original = originals.get(slide.id);
      return original ? [{before:copy(original),after:copy(slide)}] : [];
    })};
}
