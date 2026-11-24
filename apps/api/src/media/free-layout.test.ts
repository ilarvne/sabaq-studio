import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import type { Deck } from '@sabaq/lesson/types';
import { alignFree, effectiveFreeLayout, freeBounds, freeImage, freeLayoutAfterAddingImages, freeLayoutAfterRemovingImage, groupFree, hasFreePhotoBackground, isFreeImageId, moveFree, resizeFree, selectedGroup, selectionBounds, stackFree, transformFree, type FreeLayout } from '@sabaq/lesson/free-layout';
import { editInput } from '@sabaq/contracts/schema';
import { createStudioServer } from '../app';
import { reviewSlides } from '../lessons/quality';
import { makePowerPoint } from './powerpoint';
import { catalogRoot } from '../runtime-paths';

test('group transforms preserve offsets, respect rotated bounds and snap to other elements', ()=>{
  const layout:FreeLayout={items:[
    {id:'title',x:8,y:20,w:10,h:10,rotation:0},
    {id:'body',x:28,y:20,w:10,h:10,rotation:0},
    {id:'answer',x:62,y:52,w:20,h:10,rotation:0},
  ]};
  const group=groupFree(layout,['title','body'],randomUUID());
  const ids=selectedGroup(group,['body']);
  assert.deepEqual(ids,['title','body']);
  const moved=moveFree(group,ids,24.4,12,true);
  assert.deepEqual(moved.guides.x,{position:62,start:32,end:62});
  assert.equal(moved.layout.items[0].x,32);
  assert.equal(moved.layout.items[1].x-moved.layout.items[0].x,20);
  assert.deepEqual(stackFree(group,ids,true).items.map(item=>item.id),['answer','title','body']);
  assert.equal(groupFree(group,ids).items.some(item=>item.group),false);
  for(const degrees of [45,90,-175,168]) {
    const turn=transformFree(group,ids,{degrees,scaleX:3.8,scaleY:6});
    for(const item of turn.items) {
      const b=freeBounds(item);
      assert.ok(b.x>=-.01 && b.y>=-.01 && b.x+b.w<=100.01 && b.y+b.h<=100.01);
    }
    assert.ok(editInput.safeParse({op:{kind:'slide',slideId:'slide',baseVersion:1,changes:{freeLayout:turn}}}).success);
  }
});

test('guides honor independent tolerances and span the final selection and target',()=>{
  const layout:FreeLayout={items:[
    {id:'title',x:10,y:12,w:20,h:12,rotation:0},
    {id:'body',x:42,y:57,w:10,h:12,rotation:0},
  ]};
  const snapped=moveFree(layout,['title'],12.6,.4,{x:.75,y:0});
  assert.deepEqual(snapped.guides,{x:{position:42,start:12.4,end:69}});
  assert.deepEqual(snapped.layout.items[0],{...layout.items[0],x:22,y:12.4});
  const bypassed=moveFree(layout,['title'],12.6,.4,{x:.5,y:0});
  assert.deepEqual(bypassed.guides,{});
  assert.equal(bypassed.layout.items[0].x,22.6);
  const centered=moveFree(layout,['title'],30.3,0,{x:.75,y:0});
  assert.deepEqual(centered.guides.x,{position:50,start:0,end:100});
  assert.equal(centered.layout.items[0].x+centered.layout.items[0].w/2,50);
  const clamped=moveFree(layout,['title'],-50,0,{x:.75,y:0});
  assert.deepEqual(clamped.guides,{});
  assert.equal(clamped.layout.items[0].x,0);
});

test('resizing keeps the opposite edge anchored and alignment treats a group as one object',()=>{
  const layout:FreeLayout={items:[
    {id:'title',x:10,y:12,w:30,h:14,rotation:0},
    {id:'body',x:25,y:38,w:32,h:11,rotation:0},
    {id:'answer',x:70,y:52,w:12,h:10,rotation:0},
  ]};
  const wider=resizeFree(layout,['title'],{x:1,y:0},10,0);
  assert.deepEqual(wider.items[0],{...layout.items[0],w:40});
  const smaller=resizeFree(layout,['title'],{x:-1,y:-1},6,0,true).items[0];
  assert.equal(smaller.x+smaller.w,40);
  assert.equal(smaller.y+smaller.h,26);
  assert.ok(Math.abs(smaller.w/smaller.h-30/14)<.001);
  assert.equal(resizeFree(layout,['title'],{x:-1,y:0},-100,0).items[0].x,0);
  assert.equal(alignFree(layout,['title'],'center').items[0].x,35);
  const grouped=groupFree(layout,['title','body'],randomUUID());
  const aligned=alignFree(grouped,['title','body','answer'],'right');
  assert.deepEqual(aligned.items.map(item=>item.x),[35,50,70]);
  assert.equal(aligned.items[0].y,12);
});

test('a saved photo grid expands in place and individual image geometry persists',async t=>{
  const app=createStudioServer({dbPath:':memory:'});t.after(()=>app.close());
  const deck=(await app.inject({method:'POST',url:'/api/decks',payload:{
    topic:'Field photos',language:'en',template:'blank',provider:'fixture',review:false,
  }})).json<Deck>();
  const original=deck.slides[0], url='/api/decks/'+deck.id;
  const image={src:'/assets/seedling-growth.webp',alt:'A seedling'};
  const additionalImages=[{...image,alt:'A leaf'},{...image,alt:'A stem'}];
  const frame={id:'image' as const,x:12,y:37,w:66,h:33,rotation:12};
  const legacy:FreeLayout={items:[
    {id:'title',x:6,y:5,w:88,h:17,rotation:0},
    {id:'body',x:6,y:23,w:88,h:10,rotation:0},
    frame,
  ]};
  const patch=(baseVersion:number,changes:object)=>app.inject({method:'PATCH',url,payload:{
    op:{kind:'slide',slideId:original.id,baseVersion,changes},
  }});
  const previous=await patch(original.version,{body:'Compare the plants.',image,additionalImages,layout:'image-grid',freeLayout:legacy});
  assert.equal(previous.statusCode,200);
  const slide=previous.json<Deck>().slides[0];
  assert.deepEqual(slide.freeLayout,legacy);
  const layout=effectiveFreeLayout(slide);
  const pictures=layout.items.filter(item=>isFreeImageId(item.id));
  assert.deepEqual(pictures.map(item=>item.id),['image','image-2','image-3']);
  assert.ok(pictures.every(item=>item.rotation===12));
  const bounds=selectionBounds(pictures), old=freeBounds(frame);
  assert.ok(Math.abs(bounds.x-old.x)<.002 && Math.abs(bounds.y-old.y)<.002);
  assert.ok(Math.abs(bounds.w-old.w)<.002 && Math.abs(bounds.h-old.h)<.002);
  assert.equal(freeImage(slide,'image-2')?.alt,'A leaf');
  assert.equal(freeImage(slide,'image-3')?.alt,'A stem');
  const single={...slide,additionalImages:[]};
  const appended=freeLayoutAfterAddingImages(single,additionalImages);
  assert.deepEqual(appended?.items.slice(0,legacy.items.length),legacy.items);
  assert.deepEqual(effectiveFreeLayout({...slide,freeLayout:appended}),appended);

  const onlySecond=moveFree(layout,['image-2'],3,-4,false).layout;
  const resized=resizeFree(onlySecond,['image-2'],{x:1,y:1},4,3);
  assert.deepEqual(resized.items.find(item=>item.id==='image'),pictures[0]);
  assert.deepEqual(resized.items.find(item=>item.id==='image-3'),pictures[2]);
  assert.notEqual(resized.items.find(item=>item.id==='image-2')?.w,pictures[1].w);
  const group=groupFree(resized,['image-2','image-3'],randomUUID());
  const ids=selectedGroup(group,['image-3']);
  assert.deepEqual(ids,['image-2','image-3']);
  const lowered=stackFree(group,ids,false);
  const persisted=await patch(slide.version,{freeLayout:lowered});
  assert.equal(persisted.statusCode,200);
  const saved=persisted.json<Deck>().slides[0];
  assert.deepEqual(saved.freeLayout,lowered);
  assert.deepEqual(effectiveFreeLayout(saved),lowered);

  const remaining=freeLayoutAfterRemovingImage(saved,'image-2');
  const removed=await patch(saved.version,{additionalImages:additionalImages.slice(1),freeLayout:remaining});
  assert.equal(removed.statusCode,200);
  const updated=removed.json<Deck>().slides[0];
  const newSlot=updated.freeLayout?.items.find(item=>item.id==='image-2');
  assert.deepEqual(newSlot,{...lowered.items.find(item=>item.id==='image-3'),id:'image-2'});
  assert.equal(freeImage(updated,'image-2')?.alt,'A stem');
  assert.equal(updated.freeLayout?.items.some(item=>item.id==='image-3'),false);
});

test('a diagram keeps native editable nodes in its chosen split position and a manual photo stays behind the text',async()=>{
  const deck=makeFixtureDeck('en');
  const image=deck.slides.find(s=>s.image)!.image!;
  const diagram={kind:'process' as const,nodes:['Observe','Record','Compare'],alt:'Three steps'};
  const shared={...deck.slides[0],image:undefined,design:undefined,diagram,title:'Collect evidence',body:'Use the field guide.'};
  const manual={...shared,diagram:undefined,image,layout:'image-full' as const,freeLayout:{items:[
    {id:'image' as const,x:0,y:0,w:100,h:100,rotation:0},
    {id:'title' as const,x:5,y:30,w:75,h:20,rotation:0},
    {id:'body' as const,x:5,y:55,w:75,h:14,rotation:0},
  ]}};
  assert.ok(hasFreePhotoBackground(manual,manual.freeLayout));
  assert.equal(hasFreePhotoBackground(manual,stackFree(manual.freeLayout,['image'],true)),false);
  deck.slides=[{...shared,layout:'body'},{...shared,layout:'split'},manual];
  const zip=await JSZip.loadAsync(await makePowerPoint(deck,{catalog:catalogRoot,generated:'.'}));
  const xml=await Promise.all([1,2,3].map(i=>zip.file('ppt/slides/slide'+i+'.xml')!.async('string')));
  const captionX=(slide:string)=>Number(slide.match(/name="Diagram type".*?<a:off x="(\d+)"/s)?.[1]);
  assert.ok(captionX(xml[1])>captionX(xml[0])+3_000_000);
  assert.match(xml[1],/name="Diagram node 3"/);
  assert.match(xml[1],/<a:t>Compare<\/a:t>/);
  const picture=xml[2].indexOf('Free/image/Slide illustration'),scrim=xml[2].indexOf('Free/image/Image contrast overlay');
  assert.ok(picture>=0 && scrim>picture && xml[2].indexOf('Free/title/title')>scrim);
  assert.match(xml[2],/<a:srgbClr val="FFFFFF"/);
});

test('teacher placements persist, pass through the quality checker and return to adaptive layout',async t=>{
  const app=createStudioServer({dbPath:':memory:'});t.after(()=>app.close());
  const deck=(await app.inject({method:'POST',url:'/api/decks',payload:{topic:'Geometry',language:'en',template:'blank',provider:'fixture',review:false}})).json<Deck>();
  const slide=deck.slides[0],url='/api/decks/'+deck.id;
  const layout=effectiveFreeLayout(slide);
  async function patch(baseVersion:number,freeLayout:FreeLayout|null) {
    return app.inject({method:'PATCH',url,payload:{op:{kind:'slide',slideId:slide.id,baseVersion,changes:{freeLayout}}}});
  }
  assert.equal((await patch(slide.version,layout)).statusCode,200);
  const saved=(await app.inject({url})).json<Deck>();
  assert.deepEqual(saved.slides[0].freeLayout,layout);
  let measured=0;
  const result=await reviewSlides(saved,{catalog:catalogRoot,generated:'.'}, {[slide.id]:saved.slides[0].version},new AbortController().signal,async snapshot=>{
    assert.deepEqual(snapshot.slides[0].freeLayout,layout);measured++;
    return {[slide.id]:['overlap']};
  });
  assert.ok(result.reports[slide.id].issues.includes('overlap'));assert.equal(measured,1);
  const restored=await patch(saved.slides[0].version,null);
  assert.equal(restored.statusCode,200);
  assert.equal(restored.json<Deck>().slides[0].layout,slide.layout);
  assert.equal(restored.json<Deck>().slides[0].freeLayout,null);
});

test('adaptive layout changes retain all inserted native data, the original illustration and teaching content in PowerPoint',async()=>{
  const deck=makeFixtureDeck('en');
  const chart=deck.slides.find(s=>s.chart)!.chart!;
  const table=deck.slides.find(s=>s.table)!.table!;
  const image=deck.slides.find(s=>s.image)!.image!;
  const content={...deck.slides[0],chart,table,image,design:{
    variant:'activity' as const,eyebrow:'Investigate',cards:[{title:'Check the trend',text:'Identify the largest change.'}],takeaway:'Compare both sources.',
  }};
  deck.slides=(['body','native-table','data-chart','split','quote','image-full'] as const).map(layout=>({...content,layout}));
  const zip=await JSZip.loadAsync(await makePowerPoint(deck,{catalog:catalogRoot,generated:'.'}));
  for(let index=0;index<deck.slides.length;index++) {
    const xml=await zip.file('ppt/slides/slide'+(index+1)+'.xml')!.async('string');
    for(const marker of ['<a:tbl>','<c:chart ','Slide illustration','Check the trend','Compare both sources.','Investigate'])
      assert.ok(xml.includes(marker),deck.slides[index].layout+' lost '+marker);
  }
});

test('PowerPoint preserves editable grouped content, layer order and rotations of charts and tables',async()=>{
  const deck=makeFixtureDeck('en');
  const chart=deck.slides.find(s=>s.chart)!.chart;
  const table=deck.slides.find(s=>s.table)!.table;
  const slide={...deck.slides.find(s=>s.chart)!,image:undefined,table,chart};
  deck.slides=[slide];
  let layout=effectiveFreeLayout(slide);
  layout=groupFree(layout,['title','body'],randomUUID());
  layout=stackFree(layout,['title','body'],true);
  layout=transformFree(layout,['table'],{degrees:32});
  layout=transformFree(layout,['chart'],{degrees:-17});
  // Where a chart overlaps text, the author-selected stacking order still controls the drawing.
  const body=layout.items.find(item=>item.id==='body')!;
  layout={items:layout.items.map(item=>item.id==='chart' ? {...item,x:body.x,y:body.y} : item)};
  slide.freeLayout=layout;
  const bytes=await makePowerPoint(deck,{catalog:catalogRoot,generated:'.'});
  const zip=await JSZip.loadAsync(bytes);
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(xml,/<p:grpSp>/);
  assert.match(xml,/name="Layout group"/);
  assert.match(xml,/name="Element chart"/);
  assert.match(xml,/name="Element table"/);
  assert.match(xml,/<a:xfrm rot="1920000"/);
  assert.match(xml,/<a:xfrm rot="20580000"/);
  assert.match(xml,/<a:tbl>/);assert.match(xml,/<c:chart /);
  assert.ok(xml.indexOf('name="Element chart"')<xml.indexOf('name="Layout group"'));
  assert.match(xml,/<p:ph[^>]+type="title"/);
});
