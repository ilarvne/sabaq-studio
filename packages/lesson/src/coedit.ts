import type { Slide } from './types';

export const coeditLabels={en:'Edit together',ru:'Редактировать вместе',kk:'Бірге өңдеу'};
export const coeditFields = ['title','body','notes'] as const;
export type CoeditField = typeof coeditFields[number];
export const coeditLimits = {title:1000,body:10000,notes:10000};

function plainDocument(node:unknown):boolean {
  if (!node || typeof node!=='object')return false;
  const value=node as Record<string,unknown>;
  return ['doc','paragraph','text'].includes(String(value.type)) &&
    (!value.marks || Array.isArray(value.marks) && value.marks.length===0) &&
    (!value.attrs || Object.values(value.attrs).every(attr=>attr===null || attr==='left')) &&
    (!value.content || Array.isArray(value.content) && value.content.every(plainDocument));
}
export function editableFields(slide:Slide):CoeditField[] {
  return coeditFields.filter(field=>field==='notes' || (!slide.importedPage &&
    (!slide.richText?.[field] || plainDocument(slide.richText[field])) &&
    (field!=='body' || !slide.bodyRuns?.some(run=>run.bold || run.italic || run.href))));
}
export type CoeditPeer = {id:string;name:string;field?:CoeditField;position?:string};
export type CoeditState = {room:string;sequence:number;update?:string;peers:CoeditPeer[];editable:CoeditField[]};
