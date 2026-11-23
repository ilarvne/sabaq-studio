import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudioServer} from '../app';
import type {Deck,PowerPointStyle} from '@sabaq/lesson/types';

test('a PowerPoint theme and slide master drive a new lesson and survive native PowerPoint export',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'sabaq-template-roundtrip-'));
  const app=createStudioServer({dbPath:':memory:',mediaRoot:dir});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const binary={'content-type':'application/octet-stream'};
  const create=async(topic:string,style?:PowerPointStyle)=>{
    const response=await app.inject({method:'POST',url:'/api/decks',payload:{topic,language:'kk',provider:'fixture',review:true,template:'blank',powerPointStyle:style}});
    assert.equal(response.statusCode,201,response.body);return response.json<Deck>();
  };
  const source=await create('Бастапқы слайд');
  const out=await app.inject({url:'/api/decks/'+source.id+'/export/pptx'});
  assert.equal(out.statusCode,200,out.body.slice(0,140));
  const zip=await JSZip.loadAsync(out.rawPayload);
  const part='ppt/theme/theme1.xml';
  let xml=await zip.file(part)!.async('string');
  xml=xml.replace(/<a:accent1>[\s\S]*?<\/a:accent1>/,'<a:accent1><a:srgbClr val="085F63"/></a:accent1>')
    .replace(/(<a:majorFont><a:latin typeface=")[^"]+/, '$1Noto Serif')
    .replace(/(<a:minorFont><a:latin typeface=")[^"]+/, '$1Golos Text');
  zip.file(part,xml);
  const bytes=await zip.generateAsync({type:'nodebuffer'});
  const parsed=await app.inject({method:'POST',url:'/api/import/powerpoint-style',headers:binary,payload:bytes});
  assert.equal(parsed.statusCode,200,parsed.body);
  const style=parsed.json<PowerPointStyle>();
  assert.equal(style.accent,'#085F63');assert.equal(style.headingFont,'Noto Serif');assert.equal(style.bodyFont,'Golos Text');
  assert.ok(style.layouts.length>0);
  const next=await create('Жаңа тақырып',style);
  assert.deepEqual(next.powerPointStyle,style);assert.equal(next.slides[0].layout,style.layouts[0].layout);
  const edit=await app.inject({method:'PATCH',url:'/api/decks/'+next.id,payload:{op:{
    kind:'slide',slideId:next.slides[0].id,baseVersion:0,changes:{body:'Тәжірибе жүргіземіз.',notes:'Задайте вопрос.'},
  }}});
  assert.equal(edit.statusCode,200,edit.body);
  const exported=await app.inject({url:'/api/decks/'+next.id+'/export/pptx'});
  assert.equal(exported.statusCode,200,exported.body.slice(0,140));
  const saved=await JSZip.loadAsync(exported.rawPayload),theme=await saved.file(part)!.async('string');
  assert.ok(theme.includes('Cambria'));assert.ok(theme.includes('Arial'));assert.ok(theme.includes('085F63'));
  const restored=await app.inject({method:'POST',url:'/api/import/slides?format=pptx&title=Copy&language=kk&mode=editable',headers:binary,payload:exported.rawPayload});
  assert.equal(restored.statusCode,201,restored.body);
  const slide=restored.json<Deck>().slides[0];
  assert.ok(!slide.importedPage);assert.equal(slide.title,'Жаңа тақырып');assert.equal(slide.body,'Тәжірибе жүргіземіз.');assert.equal(slide.notes,'Задайте вопрос.');
});

test('layouts keep their master association and can apply the second master to a slide',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'sabaq-template-masters-'));
  const app=createStudioServer({dbPath:':memory:',mediaRoot:dir});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const p='http://schemas.openxmlformats.org/presentationml/2006/main';
  const a='http://schemas.openxmlformats.org/drawingml/2006/main';
  const r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pr='http://schemas.openxmlformats.org/package/2006/relationships';
  const rel=(id:string,type:string,target:string)=>`<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const links=(...relations:string[])=>`<Relationships xmlns="${pr}">${relations.join('')}</Relationships>`;
  const zip=new JSZip();
  zip.file('ppt/presentation.xml',`<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldMasterIdLst>
    <p:sldMasterId id="1" r:id="master-a"/><p:sldMasterId id="2" r:id="master-b"/>
  </p:sldMasterIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',links(
    rel('master-b','slideMaster','slideMasters/second.xml'),rel('master-a','slideMaster','slideMasters/first.xml'),
  ));
  const addMaster=(file:string,name:string,paper:string,ink:string,accent:string,heading:string,layouts:string[])=>{
    zip.file('ppt/slideMasters/'+file+'.xml',`<p:sldMaster xmlns:p="${p}" xmlns:r="${r}">
      <p:cSld name="${name}"/><p:clrMap bg1="lt1" tx1="dk1"/>
      <p:sldLayoutIdLst>${layouts.map((layout,i)=>`<p:sldLayoutId id="${i+1}" r:id="${layout}"/>`).join('')}</p:sldLayoutIdLst>
    </p:sldMaster>`);
    zip.file('ppt/slideMasters/_rels/'+file+'.xml.rels',links(rel('theme','theme','../theme/'+file+'.xml'),
      ...layouts.toReversed().map(layout=>rel(layout,'slideLayout','../slideLayouts/'+layout+'.xml'))));
    zip.file('ppt/theme/'+file+'.xml',`<a:theme xmlns:a="${a}" name="${name} Theme"><a:themeElements>
      <a:clrScheme><a:lt1><a:srgbClr val="${paper}"/></a:lt1><a:dk1><a:srgbClr val="${ink}"/></a:dk1>
      <a:accent1><a:srgbClr val="${accent}"/></a:accent1></a:clrScheme>
      <a:fontScheme><a:majorFont><a:latin typeface="${heading}"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
    </a:themeElements></a:theme>`);
  };
  addMaster('first','Teaching','EDF4EB','203322','25664A','Arial',['cover','detail']);
  addMaster('second','Research','54213C','FFFFFF','FDB341','Noto Serif',['comparison']);
  for(const [file,name,type] of [['cover','Lesson cover','title'],['detail','Explanation','obj'],['comparison','Field comparison','twoObj']]) {
    zip.file('ppt/slideLayouts/'+file+'.xml',`<p:sldLayout xmlns:p="${p}" type="${type}"><p:cSld name="${name}"/></p:sldLayout>`);
  }
  const parsed=await app.inject({method:'POST',url:'/api/import/powerpoint-style',headers:{'content-type':'application/octet-stream'},
    payload:await zip.generateAsync({type:'nodebuffer'})});
  assert.equal(parsed.statusCode,200,parsed.body);
  const style=parsed.json<PowerPointStyle>();
  assert.deepEqual(style.layouts.map(({name,layout})=>[name,layout]),[
    ['Lesson cover','centered'],['Explanation','stacked'],['Field comparison','split'],
  ]);
  const entry=style.layouts[2];
  assert.equal(style.masters?.find(master=>master.id===entry.masterId)?.name,'Research');
  assert.equal(style.paper,'#EDF4EB');

  const response=await app.inject({method:'POST',url:'/api/decks',payload:{
    topic:'Field observation',language:'en',provider:'fixture',review:false,template:'blank',powerPointStyle:style,
  }});
  assert.equal(response.statusCode,201,response.body);
  const deck=response.json<Deck>(),slide=deck.slides[0],url='/api/decks/'+deck.id;
  assert.equal(slide.powerPointLayoutId,style.layouts[0].id);
  const unknown=await app.inject({method:'PATCH',url,payload:{op:{
    kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{powerPointLayoutId:'m30-l1'},
  }}});
  assert.equal(unknown.statusCode,400);
  const selected=await app.inject({method:'PATCH',url,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,
    changes:{powerPointLayoutId:entry.id,body:'Observe and compare.'}}}});
  assert.equal(selected.statusCode,200,selected.body);
  assert.equal(selected.json<Deck>().slides[0].layout,'split');
  const png=await app.inject({url:url+'/export/png?slideId='+slide.id});
  assert.equal(png.statusCode,200,png.body.slice(0,150));
  const corner=await sharp(png.rawPayload).extract({left:2,top:2,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.deepEqual([...corner],[0x54,0x21,0x3c]);
  const pptx=await app.inject({url:url+'/export/pptx'});
  assert.equal(pptx.statusCode,200);
  const output=await JSZip.loadAsync(pptx.rawPayload);
  const slideXml=await output.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(slideXml,/<p:bg>[\s\S]*?54213C[\s\S]*?<\/p:bg>/);
  assert.match(slideXml,/typeface="Cambria"/);
  assert.match(slideXml,/Observe and compare\./);
});
