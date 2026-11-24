import type { CanvasObject, Slide } from './types';

export const freeImageIds = ['image','image-2','image-3'] as const;
export type FreeImageId = typeof freeImageIds[number];
export const freeIds = ['title','body','eyebrow','card-0','card-1','card-2','takeaway','answer','image','table','chart','diagram','image-2','image-3'] as const;
export type FreeId = typeof freeIds[number];
export type FreeBox = {x:number;y:number;w:number;h:number;rotation:number};
export type FreeItem = FreeBox & {id:FreeId;group?:string};
export type FreeLayout = {items:FreeItem[]};
type Axis = 'x' | 'y';
type Guide = {position:number;start:number;end:number};
export type FreeGuides = Partial<Record<Axis,Guide>>;
export const slideRatio=16/9;
const rad=(degrees:number)=>degrees*Math.PI/180;
const round=(n:number)=>Math.round(n*1000)/1000;
const clamp=(n:number,low:number,high:number)=>Math.max(low,Math.min(high,n));

export function isFreeImageId(id:FreeId):id is FreeImageId {
  return freeImageIds.some(imageId=>imageId===id);
}

export function freeImage(slide:Pick<Slide,'image'|'additionalImages'>,id:FreeImageId) {
  const index=freeImageIds.indexOf(id);
  return index===0 ? slide.image : slide.additionalImages?.[index-1];
}

export function freeElements(slide:Slide):FreeId[] {
  if (slide.importedPage) return slide.image ? ['image'] : ['title'];
  const ids:FreeId[]=['title','body'];
  if(slide.design?.eyebrow || (!slide.design && slide.lessonPart && slide.lessonPart!=='lesson')) ids.push('eyebrow');
  (slide.design?.cards ?? []).slice(0,3).forEach((_,i)=>ids.push(freeIds[3+i]));
  if(slide.design?.takeaway) ids.push('takeaway');
  if(slide.answer) ids.push('answer');
  ids.push(...freeImageIds.filter(id=>freeImage(slide,id)));
  if(slide.table) ids.push('table');
  if(slide.chart) ids.push('chart');
  if(slide.diagram) ids.push('diagram');
  return ids;
}

export function freeBounds(box:FreeBox) {
  const a=rad(box.rotation), c=Math.abs(Math.cos(a)), s=Math.abs(Math.sin(a));
  const w=box.w*c+box.h*s/slideRatio, h=box.h*c+box.w*s*slideRatio;
  return {x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h};
}

export function fitFreeBox<T extends FreeBox>(item:T):T {
  let w=clamp(item.w,2,100), h=clamp(item.h,2,100);
  const rotation=round(((item.rotation+180)%360+360)%360-180);
  const bounds=freeBounds({...item,w,h,rotation});
  const ratio=Math.min(1,100/bounds.w,100/bounds.h);
  w*=ratio; h*=ratio;
  const halfW=bounds.w*ratio/2, halfH=bounds.h*ratio/2;
  const cx=clamp(item.x+item.w/2,halfW,100-halfW),cy=clamp(item.y+item.h/2,halfH,100-halfH);
  return {...item,x:round(cx-w/2),y:round(cy-h/2),w:round(w),h:round(h),rotation};
}

export function fitCanvasObject<T extends CanvasObject>(object: T): T {
  if (object.kind !== 'artwork') return fitFreeBox(object);
  const w = clamp(object.w,.1,100);
  const h = clamp(object.h,.1,100);
  return { ...object, w, h,
    x: round(clamp(object.x, -w/2, 100-w/2)),
    y: round(clamp(object.y, -h/2, 100-h/2)),
    rotation: round(((object.rotation+180)%360+360)%360-180),
  };
}

function splitLegacyImageFrame(frame:FreeItem,ids:FreeImageId[]) {
  // The saved frame contained every picture. Keep its gap, center, angle, and layer order.
  const gap=Math.min(1.1,frame.w/(ids.length*2));
  const width=(frame.w-gap*(ids.length-1))/ids.length;
  const angle=rad(frame.rotation);
  return ids.map((id,index)=>{
    const distance=(width+gap)*index+(width-frame.w)/2;
    return {...frame,id,w:round(width),
      x:round(frame.x+(frame.w-width)/2+distance*Math.cos(angle)),
      y:round(frame.y+distance*Math.sin(angle)*slideRatio)};
  });
}

// Saved geometry uses percentages of a 16:9 canvas. Existing elements can be added or removed by subsequent content edits.
export function effectiveFreeLayout(slide:Slide):FreeLayout {
  const ids=freeElements(slide);
  let saved=slide.freeLayout?.items.filter(item=>ids.includes(item.id)) ?? [];
  const images=ids.filter(isFreeImageId);
  const frame=saved.find(item=>item.id==='image');
  if(images.length>1 && frame && frame.w>=.6 && !saved.some(item=>item.id==='image-2' || item.id==='image-3')) {
    saved=saved.flatMap(item=>item===frame ? splitLegacyImageFrame(frame,images) : [item]);
  }
  const missing=ids.filter(id=>!saved.some(item=>item.id===id));
  const defaults=ids.filter(id=>id!=='title');
  const cols=defaults.length>4 ? 3 : defaults.length>1 ? 2 : 1;
  const rows=Math.max(1,Math.ceil(defaults.length/cols));
  return {items:[...saved,...missing.map(id=>{
    if(id==='title') return {id,x:5,y:5,w:90,h:17,rotation:0};
    const pos=defaults.indexOf(id);
    return {id,x:5+(pos%cols)*91/cols,y:26+Math.floor(pos/cols)*69/rows,w:91/cols-3,h:69/rows-3,rotation:0};
  })]};
}

export function freeLayoutAfterRemovingImage(slide:Slide,id:FreeImageId):FreeLayout|undefined {
  if(!slide.freeLayout) return;
  const removedIndex=freeImageIds.indexOf(id);
  return {items:effectiveFreeLayout(slide).items.flatMap(item=>{
    if(item.id===id) return [];
    const index=isFreeImageId(item.id) ? freeImageIds.indexOf(item.id) : -1;
    return index>removedIndex ? [{...item,id:freeImageIds[index-1]}] : [item];
  })};
}

export function freeLayoutAfterAddingImages(slide:Slide,additionalImages:NonNullable<Slide['additionalImages']>):FreeLayout|undefined {
  if(!slide.freeLayout || additionalImages.length<=(slide.additionalImages?.length ?? 0)) return;
  const existing=effectiveFreeLayout(slide);
  const defaults=effectiveFreeLayout({...slide,additionalImages,freeLayout:null});
  const added=defaults.items.filter(item=>isFreeImageId(item.id) && !existing.items.some(previous=>previous.id===item.id));
  return {items:[...existing.items,...added]};
}

export function selectionBounds(items:FreeItem[]) {
  const boxes=items.map(freeBounds);
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
}

export function selectedGroup(layout:FreeLayout,ids:FreeId[]) {
  const groups=new Set(layout.items.filter(item=>ids.includes(item.id) && item.group).map(item=>item.group));
  return layout.items.filter(item=>ids.includes(item.id) || item.group && groups.has(item.group)).map(item=>item.id);
}

function groupedItems(items:FreeItem[]) {
  const groups=new Map<string,FreeItem[]>();
  for(const item of items) {
    const key=item.group?'group:'+item.group:item.id;
    const group=groups.get(key) ?? [];
    group.push(item);
    groups.set(key,group);
  }
  return groups;
}

export function moveFree(
  layout:FreeLayout,ids:FreeId[],dx:number,dy:number,snap:boolean|Record<Axis,number>,
):{layout:FreeLayout;guides:FreeGuides} {
  const picked=layout.items.filter(item=>ids.includes(item.id));
  if(!picked.length) return {layout,guides:{}};
  const moving=selectionBounds(picked);
  const peers=snap ? [...groupedItems(layout.items.filter(item=>!ids.includes(item.id))).values()].map(selectionBounds) : [];
  const canvas={x:0,y:0,w:100,h:100};

  function movement(axis:Axis,delta:number) {
    const size=axis==='x'?'w':'h';
    const minimum=-moving[axis], maximum=100-moving[axis]-moving[size];
    const tolerance=typeof snap==='boolean' ? (snap ? 1.35 : 0) : snap[axis];
    let distance=tolerance, result=clamp(delta,minimum,maximum);
    let target:{position:number;peer:typeof moving}|undefined;
    if(tolerance>0) for(const peer of [canvas,...peers]) {
      for(const fraction of [0,0.5,1]) {
        const position=peer[axis]+peer[size]*fraction;
        for(const anchor of [0,0.5,1]) {
          const alignedDelta=position-moving[axis]-moving[size]*anchor;
          const difference=Math.abs(alignedDelta-delta);
          if(difference>=distance || alignedDelta<minimum-1e-6 || alignedDelta>maximum+1e-6) continue;
          result=clamp(alignedDelta,minimum,maximum);
          distance=difference;
          target={position,peer};
        }
      }
    }
    return {delta:result,target};
  }

  const x=movement('x',dx), y=movement('y',dy);
  const guides:FreeGuides={};
  for(const [axis,along,across] of [['x',x,y],['y',y,x]] as const) {
    if(!along.target) continue;
    const {position,peer}=along.target;
    const crossAxis=axis==='x'?'y':'x', crossSize=axis==='x'?'h':'w';
    const start=Math.min(moving[crossAxis]+across.delta,peer[crossAxis]);
    const end=Math.max(moving[crossAxis]+moving[crossSize]+across.delta,peer[crossAxis]+peer[crossSize]);
    guides[axis]={position,start:clamp(start,0,100),end:clamp(end,0,100)};
  }
  if(!x.delta && !y.delta) return {layout,guides};
  return {layout:{items:layout.items.map(item=>ids.includes(item.id) ?
    {...item,x:round(item.x+x.delta),y:round(item.y+y.delta)} : item)},guides};
}

export function transformFree(layout:FreeLayout,ids:FreeId[],change:{scaleX?:number;scaleY?:number;degrees?:number}) {
  const selected=layout.items.filter(item=>ids.includes(item.id));
  if(!selected.length) return layout;
  const b=selectionBounds(selected),cx=b.x+b.w/2,cy=b.y+b.h/2;
  const sx=clamp(change.scaleX ?? 1,.05,20),sy=clamp(change.scaleY ?? 1,.05,20),a=rad(change.degrees ?? 0);
  const transformed=selected.map(item=>{
    const dx=(item.x+item.w/2-cx)*sx*slideRatio,dy=(item.y+item.h/2-cy)*sy;
    const w=Math.max(2,item.w*sx),h=Math.max(2,item.h*sy);
    return {...item,w,h,x:cx+(dx*Math.cos(a)-dy*Math.sin(a))/slideRatio-w/2,
      y:cy+dx*Math.sin(a)+dy*Math.cos(a)-h/2,rotation:item.rotation+(change.degrees ?? 0)};
  });
  // Fit the group as one box so hitting a slide edge does not separate grouped objects.
  const extent=selectionBounds(transformed),scale=Math.min(1,100/extent.w,100/extent.h);
  const left=clamp(extent.x,0,100-extent.w*scale),top=clamp(extent.y,0,100-extent.h*scale);
  const updates=new Map(transformed.map(item=>[item.id,fitFreeBox({...item,w:item.w*scale,h:item.h*scale,
    x:left+(item.x-extent.x)*scale,y:top+(item.y-extent.y)*scale})]));
  return {items:layout.items.map(item=>updates.get(item.id) ?? item)};
}

export function stackFree(layout:FreeLayout,ids:FreeId[],front:boolean):FreeLayout {
  const moved=layout.items.filter(item=>ids.includes(item.id)),others=layout.items.filter(item=>!ids.includes(item.id));
  return {items:front ? [...others,...moved] : [...moved,...others]};
}

export function groupFree(layout:FreeLayout,ids:FreeId[],group?:string):FreeLayout {
  const items=layout.items.map(item=>{
    if(!ids.includes(item.id)) return item;
    const {group:previous,...rest}=item;
    return group ? {...rest,group} : rest;
  });
  if(!group) return {items};
  const first=items.findIndex(item=>ids.includes(item.id));
  return {items:[...items.slice(0,first),...items.filter(item=>ids.includes(item.id)),...items.slice(first).filter(item=>!ids.includes(item.id))]};
}

export function hasFreePhotoBackground(slide:Slide,layout:FreeLayout) {
  const back=layout.items[0];
  return slide.layout==='image-full' && !slide.importedPage && back?.id==='image' &&
    back.rotation===0 && back.x<.1 && back.y<.1 && back.w>99.8 && back.h>99.8;
}

export type ResizeEdge={x:-1|0|1;y:-1|0|1};

export function resizeFree(layout:FreeLayout,ids:FreeId[],edge:ResizeEdge,dx:number,dy:number,proportional=false):FreeLayout {
  const picked=layout.items.filter(item=>ids.includes(item.id));
  if(!picked.length) return layout;
  const before=selectionBounds(picked);
  // A tilted selection has an axis-aligned outline. Keep its proportions to preserve rotation.
  const uniform=proportional || picked.some(item=>item.rotation%180!==0);
  function scale(axis:'x'|'y',size:'w'|'h',delta:number) {
    if(!edge[axis]) return 1;
    return 1+edge[axis]*delta/before[size];
  }
  let sx=scale('x','w',dx),sy=scale('y','h',dy);
  if(uniform) sx=sy=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;
  const maxScale=(pos:number,size:number,dir:number)=>dir>0?(100-pos)/size:dir<0?(pos+size)/size:2*Math.min(pos+size/2,100-pos-size/2)/size;
  const maxX=maxScale(before.x,before.w,edge.x),maxY=maxScale(before.y,before.h,edge.y);
  if(uniform) sx=sy=clamp(sx,.05,Math.min(maxX,maxY));
  else {sx=clamp(sx,.05,maxX);sy=clamp(sy,.05,maxY);}
  const scaled=transformFree(layout,ids,{scaleX:sx,scaleY:sy});
  const after=selectionBounds(scaled.items.filter(item=>ids.includes(item.id)));
  const anchor=(pos:number,size:number,direction:number)=>pos+(1-direction)*size/2;
  return moveFree(scaled,ids,
    anchor(before.x,before.w,edge.x)-anchor(after.x,after.w,edge.x),
    anchor(before.y,before.h,edge.y)-anchor(after.y,after.h,edge.y),false).layout;
}

export type FreeAlignment='left'|'center'|'right'|'top'|'middle'|'bottom';
export function alignFree(layout:FreeLayout,ids:FreeId[],alignment:FreeAlignment):FreeLayout {
  const picked=layout.items.filter(item=>ids.includes(item.id));
  if(!picked.length) return layout;
  const groups=groupedItems(picked);
  const axis=['left','center','right'].includes(alignment)?'x':'y';
  const size=axis==='x'?'w':'h';
  const offset=alignment==='center'||alignment==='middle'?.5:alignment==='right'||alignment==='bottom'?1:0;
  const target=groups.size===1?{x:0,y:0,w:100,h:100}:selectionBounds(picked);
  const position=target[axis]+target[size]*offset;
  let result=layout;
  for(const members of groups.values()) {
    const bounds=selectionBounds(members);
    const delta=position-bounds[axis]-bounds[size]*offset;
    result=moveFree(result,members.map(item=>item.id),axis==='x'?delta:0,axis==='y'?delta:0,false).layout;
  }
  return result;
}
