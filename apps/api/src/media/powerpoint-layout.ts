import { freeBounds, selectionBounds, type FreeId, type FreeItem, type FreeLayout } from '@sabaq/lesson/free-layout';

const media = new Set<FreeId>(['image', 'table', 'chart', 'diagram']);
const titlePlaceholder = /<p:ph\b[^>]*\btype="title"/;
const decorative = '<a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">' +
  '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext>';
const decorationLabel = ' [sabaq decorative]';
const officeShape = /<p:(sp|pic|graphicFrame|cxnSp)\b[^>]*>[\s\S]*?<\/p:\1>/g;
type GroupBox = Pick<FreeItem,'x'|'y'|'w'|'h'>;

export const decorativePowerPointName = (name: string) => name + decorationLabel;

function overlaps(first: FreeItem, second: FreeItem) {
  const a = freeBounds(first), b = freeBounds(second);
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function canReadVisibleTitleFirst(layout: FreeLayout) {
  const index = layout.items.findIndex(item => item.id === 'title');
  const title = layout.items[index];
  return !!title && !title.group && !title.rotation &&
    !layout.items.slice(0, index).some(item => item.id !== 'answer' && overlaps(title, item));
}

function markDecorative(drawing: string) {
  return drawing.replace(/<p:cNvPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p:cNvPr>)/,
    (_match, props: string, content = '') => {
      const extensions = content.includes('</a:extLst>')
        ? content.replace('</a:extLst>', decorative + '</a:extLst>')
        : content + '<a:extLst>' + decorative + '</a:extLst>';
      return '<p:cNvPr' + props.replace(/\sdescr="[^"]*"/, '') + '>' + extensions + '</p:cNvPr>';
    });
}

export function applyPowerPointDecorations(xml: string) {
  return xml.replace(/<p:cNvPr\b[^>]*?(?:\/>|>[\s\S]*?<\/p:cNvPr>)/g, properties => {
    const name = /\bname="([^"]*)"/.exec(properties);
    if (!name?.[1].endsWith(decorationLabel)) return properties;
    return markDecorative(properties.replace(name[0], () => 'name="' + name[1].slice(0,-decorationLabel.length) + '"'));
  });
}

function lastDrawingId(xml: string) {
  return Math.max(1, ...Array.from(xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g), match => Number(match[1])));
}

function groupedDrawing(id: number, box: GroupBox, degrees: number, members: string, name: string, alt?: string) {
  const x=Math.round(box.x*13.333*9144), y=Math.round(box.y*7.5*9144);
  const w=Math.max(1,Math.round(box.w*13.333*9144)), h=Math.max(1,Math.round(box.h*7.5*9144));
  const rotation=Math.round(((degrees%360+360)%360)*60000);
  const description=alt ? ' descr="' + alt.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '"' : '';
  return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="'+id+'" name="'+name+'"'+description+'/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'+
    '<p:grpSpPr><a:xfrm rot="'+rotation+'"><a:off x="'+x+'" y="'+y+'"/><a:ext cx="'+w+'" cy="'+h+'"/>'+
    '<a:chOff x="'+x+'" y="'+y+'"/><a:chExt cx="'+w+'" cy="'+h+'"/></a:xfrm></p:grpSpPr>'+members+'</p:grpSp>';
}

export function describeNativePowerPointDiagram(xml: string, box: GroupBox, alt: string) {
  const members: string[] = [];
  const marker = '<!--sabaq-diagram-group-->';
  const slide = xml.replace(officeShape, drawing => {
    if (!/<p:cNvPr\b[^>]*\bname="Diagram (?:type|connection|node \d+)"/.test(drawing)) return drawing;
    members.push(drawing);
    return members.length === 1 ? marker : '';
  });
  return members.length ? slide.replace(marker, () =>
    groupedDrawing(lastDrawingId(xml)+1, box, 0, members.join(''), 'Diagram', alt)) : slide;
}

function readingOrder<T>(entries: T[], members: (entry: T) => FreeItem[]) {
  const pending = entries.map(entry => {
    const items = members(entry);
    const position = selectionBounds(items);
    return { entry, items, position, priority: items.some(item => item.id === 'title') ? 0
      : items.every(item => media.has(item.id)) ? 2 : 1 };
  });
  const ordered: T[] = [];
  while (pending.length) {
    // Shape tree order also controls stacking. Only move a shape ahead of layers it cannot cover.
    const movable = pending.filter((candidate, index) => !pending.slice(0, index).some(previous =>
      candidate.items.some(item => previous.items.some(peer => overlaps(item, peer)))));
    movable.sort((a,b) => a.priority-b.priority || a.position.y-b.position.y || a.position.x-b.position.x);
    ordered.push(movable[0].entry);
    pending.splice(pending.indexOf(movable[0]), 1);
  }
  return ordered;
}

// These shapes are from our own PptxGenJS writer. Preserve the original XML, drawing IDs
// and relationship IDs, which keep pictures, charts, tables and hyperlinks editable.
export function arrangePowerPointShapes(xml:string, layout:FreeLayout, visibleTitleIsNative:boolean, diagramAlt?:string) {
  const byId=new Map<FreeId,string[]>();
  const firstMarker='<!--sabaq-slide-elements-->';
  const title=layout.items.find(item=>item.id==='title');
  let found=false;
  const stripped=xml.replace(officeShape, drawing=>{
    const name=/<p:cNvPr\b[^>]*\bname="Free\/([a-z0-9-]+)\//.exec(drawing);
    // PowerPoint title placeholders inherit their name and position from the slide master.
    // Keep the title semantic and override that transform with the teacher's placement.
    const isTitle=!!title && visibleTitleIsNative && titlePlaceholder.test(drawing);
    if(!name && !isTitle) return drawing;
    const id=isTitle ? 'title' : name![1] as FreeId;
    if(isTitle && title) {
      drawing=drawing.replace(/<a:xfrm>\s*<a:off[^>]*\/>\s*<a:ext[^>]*\/>\s*<\/a:xfrm>/,
        '<a:xfrm><a:off x="'+Math.round(title.x*13.333*9144)+'" y="'+Math.round(title.y*7.5*9144)+'"/>'+
        '<a:ext cx="'+Math.round(title.w*13.333*9144)+'" cy="'+Math.round(title.h*7.5*9144)+'"/></a:xfrm>');
    }
    if(id==='title' && !isTitle) drawing=markDecorative(drawing);
    const members=byId.get(id) ?? [];
    members.push(drawing);byId.set(id,members);
    if(found) return '';
    found=true; return firstMarker;
  });
  if(!found) return xml;
  let seq=lastDrawingId(xml);
  function render(item:FreeItem) {
    const draws=byId.get(item.id) ?? [];
    if(!draws.length) return '';
    if(draws.length===1 && !item.rotation) return draws[0];
    return groupedDrawing(++seq,item,item.rotation,draws.join(''),'Element '+item.id,item.id==='diagram' ? diagramAlt : undefined);
  }
  const seen=new Set<string>(), units:FreeItem[][]=[];
  for(const item of layout.items) {
    if(!byId.has(item.id)) continue;
    if(!item.group) {units.push([item]);continue;}
    if(seen.has(item.group)) continue;
    seen.add(item.group);
    units.push(layout.items.filter(other=>other.group===item.group && byId.has(other.id)));
  }
  const result=readingOrder(units,members=>members).map(members=>{
    const drawings=readingOrder(members,item=>[item]).map(render).join('');
    return members.length===1 ? drawings : groupedDrawing(++seq,selectionBounds(members),0,drawings,'Layout group');
  });
  return stripped.replace(firstMarker,()=>result.join(''));
}
