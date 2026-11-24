import type { JSONContent } from '@tiptap/core';
import type { AssistantCanvasScope } from '@sabaq/contracts/assistant';
import { slideChangeFields } from '@sabaq/contracts/schema';
import type { AssistantTool } from '@sabaq/agent/tools';
import { documentRuns } from '@sabaq/lesson/rich-text';
import type { Slide, SlideChanges } from '@sabaq/lesson/types';

export type ScopedAction = {action:AssistantTool; formatting?:Pick<SlideChanges,'richText'|'bodyRuns'>};
type TextRange = NonNullable<AssistantCanvasScope['selection']>;

function selectedFormatting(slide:Slide, field:'title'|'body', range:TextRange, replacement:string, expected:string): ScopedAction['formatting'] {
  const runs=field==='body' && slide.bodyRuns?.map(run=>run.text).join('')===slide.body ? slide.bodyRuns : undefined;
  const rich=slide.richText?.[field];
  if(!runs && !rich) return {};
  let offset=0, inserted=false;
  function replaceRun(text:string) {
    const start=offset;
    offset+=text.length;
    if(range.start>=offset || range.end<=start) return text;
    const value=text.slice(0,Math.max(0,range.start-start)) + (inserted ? '' : replacement) +
      text.slice(Math.min(text.length,range.end-start));
    inserted=true;
    return value;
  }
  if(rich) {
    if(documentRuns(rich).map(run=>run.text).join('')!==slide[field]) return;
    function replaceDocument(node:JSONContent):JSONContent|undefined {
      if(node.type==='text' && typeof node.text==='string') {
        const text=replaceRun(node.text);
        return text ? {...node,text} : undefined;
      }
      if(node.type==='hardBreak') {
        offset++;
        return node;
      }
      if(!node.content) return node;
      const children=node.content.flatMap((child,index)=>{
        if(index && ['doc','bulletList','orderedList','listItem'].includes(node.type ?? '')) offset++;
        const changed=replaceDocument(child);
        return changed ? [changed] : [];
      });
      return {...node,content:children};
    }
    const changed=replaceDocument(rich);
    if(!changed) return;
    const changedRuns=documentRuns(changed);
    if(changedRuns.map(run=>run.text).join('')!==expected) return;
    return {richText:{...slide.richText,[field]:changed},...(field==='body' && {bodyRuns:changedRuns})};
  }
  return {bodyRuns:runs?.flatMap(run=>{
    const text=replaceRun(run.text);
    return text ? [{...run,text}] : [];
  })};
}

export function scopeCanvasEdits(actions:AssistantTool[], slide:Slide, scope:AssistantCanvasScope):ScopedAction[] {
  if(scope.field==='object') {
    const action=actions.find(candidate=>candidate.tool==='edit_object' && candidate.slideId===slide.id && candidate.objectId===scope.objectId);
    return action ? [{action}] : [];
  }
  if(scope.field==='slide') return actions.flatMap(action=>
    action.tool==='edit_slide' || action.tool==='illustrate_slide' || action.tool==='remove_image'
      ? action.slideId===slide.id ? [{action}] : []
      : []);
  const {field,selection}=scope;
  for(const action of actions) {
    if(action.tool!=='edit_slide' || action.slideId!==slide.id) continue;
    const value=action.changes[field];
    if(value===undefined) continue;
    const source=slide[field];
    const text=selection ? source.slice(0,selection.start)+value+source.slice(selection.end) : value;
    const changes={[field]:text};
    if(text===source || !slideChangeFields.safeParse(changes).success) continue;
    const formatting=selection ? selectedFormatting(slide,field,selection,value,text) : {};
    if(!formatting) continue;
    return [{action:{tool:'edit_slide',slideId:slide.id,changes},formatting}];
  }
  return [];
}
