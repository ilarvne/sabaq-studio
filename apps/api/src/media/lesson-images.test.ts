import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import JSZip from 'jszip';
import type { Deck, SlideImage } from '@sabaq/lesson/types';
import { defaultImageCrop } from '@sabaq/lesson/image-crop';
import { createStudioServer } from '../app';

const blank={topic:'Light and shadow',language:'en',provider:'fixture',review:true,template:'blank'};

test('a three-image grid keeps each description, renders each image, and respects deck access',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lesson-image-grid-'));
  const before={STUDIO_AUTH_MODE:process.env.STUDIO_AUTH_MODE,STUDIO_GATEWAY_SECRET:process.env.STUDIO_GATEWAY_SECRET};
  const token='test-token-lesson-grid-00000000000';
  process.env.STUDIO_AUTH_MODE='gateway';
  process.env.STUDIO_GATEWAY_SECRET=token;
  const app=createStudioServer({dbPath:join(dir,'db.sqlite'),mediaRoot:join(dir,'media')});
  t.after(async()=>{
    await app.close();
    for(const [name,value] of Object.entries(before)) {
      if(value===undefined) delete process.env[name];
      else process.env[name]=value;
    }
    await rm(dir,{recursive:true,force:true});
  });
  const person=(subject:string)=>({'x-studio-gateway':token,'x-studio-user':subject,'x-studio-org':'school'});
  const owner=person('teacher'),viewer=person('reader'),outsider=person('outsider');
  const create=async(headers:ReturnType<typeof person>)=>(await app.inject({method:'POST',url:'/api/decks',headers,payload:blank})).json<Deck>();
  const {id,slides:[slide]}=await create(owner);
  const root='/api/decks/'+id;
  const images:SlideImage[]=[];
  for(const [background,alt] of [['#ff0000','Red sample'],['#00ff00','Green sample'],['#0000ff','Blue sample']]) {
    const image=await sharp({create:{width:90,height:60,channels:3,background}}).png().toBuffer();
    const response=await app.inject({method:'POST',url:root+'/images/upload',headers:{...owner,'content-type':'application/octet-stream'},payload:image});
    assert.equal(response.statusCode,201,response.body);
    images.push({...response.json<SlideImage>(),alt});
  }
  const [image,...additionalImages]=images;
  const save=(deckId:string,slideId:string,baseVersion:number,headers:ReturnType<typeof person>,first=image)=>app.inject({
    method:'PATCH',url:'/api/decks/'+deckId,headers,payload:{op:{kind:'slide',slideId,baseVersion,changes:{layout:'image-grid',image:first,additionalImages}}},
  });
  const other=await create(outsider);
  assert.equal((await save(other.id,other.slides[0].id,other.slides[0].version,outsider,{
    src:'/assets/water-lab.webp',alt:'Water sample',
  })).statusCode,404);
  const saved=await save(id,slide.id,slide.version,owner);
  assert.equal(saved.statusCode,200,saved.body);

  await app.inject({method:'PUT',url:root+'/access',headers:owner,payload:{subject:'reader',permission:'view'}});
  for(const asset of additionalImages) {
    assert.equal((await app.inject({url:asset.src,headers:viewer})).statusCode,200);
    assert.equal((await app.inject({url:asset.src,headers:outsider})).statusCode,404);
  }
  const pptx=await app.inject({url:root+'/export/pptx',headers:viewer});
  assert.equal(pptx.statusCode,200);
  const zip=await JSZip.loadAsync(pptx.rawPayload);
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.equal(xml.match(/<p:pic>/g)?.length,3);
  assert.match(xml,/descr="Red sample"/);
  assert.match(xml,/descr="Green sample"/);
  assert.match(xml,/descr="Blue sample"/);

  const png=await app.inject({url:root+'/export/png?slideId='+slide.id,headers:viewer});
  assert.equal(png.statusCode,200);
  const {data,info}=await sharp(png.rawPayload).raw().toBuffer({resolveWithObject:true});
  const colors=[0,0,0];
  for(let i=0;i<data.length;i+=info.channels) {
    const rgb=[data[i],data[i+1],data[i+2]];
    for(let channel=0;channel<3;channel++) {
      if(rgb[channel]===255 && rgb[(channel+1)%3]===0 && rgb[(channel+2)%3]===0) colors[channel]++;
    }
  }
  assert.ok(colors.every(count=>count>10_000),'all three images are visible across the exported slide');
  const section=await app.inject({method:'PATCH',url:root,headers:owner,payload:{op:{
    kind:'slide',slideId:slide.id,baseVersion:saved.json<Deck>().slides[0].version,
    changes:{layout:'image-section',additionalImages:[]},
  }}});
  assert.equal(section.statusCode,200,section.body);
  const banner=await app.inject({url:root+'/export/pptx',headers:viewer});
  assert.equal(banner.statusCode,200);
  const bannerZip=await JSZip.loadAsync(banner.rawPayload);
  const bannerXml=await bannerZip.file('ppt/slides/slide1.xml')!.async('string');
  assert.equal(bannerXml.match(/<p:pic>/g)?.length,1);
  assert.match(bannerXml,/descr="Red sample"/);
});

test('teachers can insert and reopen mathematical formulas and bundled pictograms',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lesson-symbols-'));
  const app=createStudioServer({dbPath:join(dir,'db.sqlite'),mediaRoot:join(dir,'media')});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const {id,slides:[slide]}=(await app.inject({method:'POST',url:'/api/decks',payload:blank})).json<Deck>();
  const root='/api/decks/'+id;
  const symbol=(payload:unknown)=>app.inject({method:'POST',url:root+'/images/symbol',payload:payload as object});
  const latex=String.raw`\frac{\sqrt{x^2 + y_1^2}}{z}=\begin{pmatrix}1&0\\0&1\end{pmatrix}`;
  const formula=await symbol({source:'formula',latex,alt:'Square-root fraction equals a two-by-two identity matrix'});
  assert.equal(formula.statusCode,201,formula.body);
  const pictogram=await symbol({source:'pictogram',icon:'atom',alt:'Atom'});
  assert.equal(pictogram.statusCode,201,pictogram.body);
  assert.equal((await symbol({source:'formula',latex:'\\frac{',alt:'Incomplete fraction'})).statusCode,400);
  assert.equal((await symbol({source:'pictogram',icon:'unknown',alt:'Unknown'})).statusCode,400);
  const image=formula.json<SlideImage>(), icon=pictogram.json<SlideImage>();
  for(const asset of [image,icon]) {
    const bytes=(await app.inject({url:asset.src})).rawPayload;
    const stats=await sharp(bytes).stats();
    assert.ok(stats.channels.slice(0,3).some(channel=>channel.min<64 && channel.max>240));
  }
  assert.deepEqual(image.provenance,{source:'formula',latex});
  assert.deepEqual(icon.provenance,{source:'pictogram',icon:'atom'});
  const save=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,
    baseVersion:slide.version,changes:{image,additionalImages:[icon],layout:'image-grid'}}}});
  assert.equal(save.statusCode,200,save.body);
  const reopened=(await app.inject({url:root})).json<Deck>().slides[0];
  assert.deepEqual(reopened.image?.provenance,{source:'formula',latex});
  assert.equal(reopened.additionalImages?.[0].alt,'Atom');
  const pdf=await app.inject({url:root+'/export/pdf'});
  assert.equal(pdf.statusCode,200,pdf.statusCode===200?'':pdf.body);
  const pptx=await app.inject({url:root+'/export/pptx'});
  assert.equal(pptx.statusCode,200,pptx.statusCode===200?'':pptx.body);
  const zip=await JSZip.loadAsync(pptx.rawPayload);
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(xml,/descr="Square-root fraction equals a two-by-two identity matrix"/);
  assert.match(xml,/descr="Atom"/);
});

test('uploaded originals stay scoped to the lesson, focal crops keep the selected pixels and round corners in PowerPoint',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lesson-image-upload-'));
  const originalSettings={STUDIO_AUTH_MODE:process.env.STUDIO_AUTH_MODE,STUDIO_GATEWAY_SECRET:process.env.STUDIO_GATEWAY_SECRET};
  const token='test-token-lesson-image-0000000000';
  process.env.STUDIO_AUTH_MODE='gateway';process.env.STUDIO_GATEWAY_SECRET=token;
  t.after(async()=>{for (const [key,value] of Object.entries(originalSettings)) {if(value===undefined)delete process.env[key];else process.env[key]=value;} await rm(dir,{recursive:true,force:true});});
  const app=createStudioServer({dbPath:join(dir,'db.sqlite'),mediaRoot:join(dir,'media')});t.after(()=>app.close());
  const person=(subject:string)=>({'x-studio-gateway':token,'x-studio-user':subject,'x-studio-org':'school'});
  const owner=person('teacher'),outsider=person('outsider'),viewer=person('reader');
  const create=async(headers:ReturnType<typeof person>)=>(await app.inject({method:'POST',url:'/api/decks',headers,payload:blank})).json<Deck>();
  const deck=await create(owner),other=await create(outsider),path='/api/decks/'+deck.id;
  const pixels=Buffer.alloc(120*60*3);
  for(let i=0;i<120*60;i++) pixels[i*3+(i%120<60?0:2)]=255;
  const bytes=await sharp(pixels,{raw:{width:120,height:60,channels:3}}).png().toBuffer();
  const upload=await app.inject({method:'POST',url:path+'/images/upload',headers:{...owner,'content-type':'application/octet-stream'},payload:bytes});
  assert.equal(upload.statusCode,201,upload.body);
  const original=upload.json<SlideImage>();
  await app.inject({method:'PUT',url:path+'/access',headers:owner,payload:{subject:'reader',permission:'view'}});
  assert.equal((await app.inject({url:original.src,headers:viewer})).statusCode,404);
  assert.equal((await app.inject({url:original.src,headers:outsider})).statusCode,404);
  const bad=await app.inject({method:'POST',url:path+'/images/upload',headers:{...owner,'content-type':'application/octet-stream'},payload:Buffer.from('<svg/>')});
  assert.equal(bad.statusCode,415);
  const crop={...defaultImageCrop,aspect:'square',x:100,radius:30};
  const response=await app.inject({method:'POST',url:path+'/images/crop',headers:owner,payload:{src:original.src,crop}});
  assert.equal(response.statusCode,200,response.body);
  const image:SlideImage={...original,...response.json(),alt:'Blue half of a two-colour sample'};
  assert.equal(image.originalSrc,original.src);assert.notEqual(image.src,original.src);
  const cropped=(await app.inject({url:image.src,headers:owner})).rawPayload;
  const {data,info}=await sharp(cropped).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,60);assert.equal(info.height,60);assert.equal(data[3],0);
  const c=(30*60+30)*4;assert.deepEqual([...data.subarray(c,c+4)],[0,0,255,255]);
  assert.equal((await sharp((await app.inject({url:original.src,headers:owner})).rawPayload).metadata()).width,120);
  const attach=(d:Deck,headers:ReturnType<typeof person>,asset:SlideImage)=>app.inject({method:'PATCH',url:'/api/decks/'+d.id,headers,payload:{op:{kind:'slide',slideId:d.slides[0].id,baseVersion:0,changes:{image:asset,layout:'image-right'}}}});
  assert.equal((await attach(other,outsider,{...image,src:'/assets/water-lab.webp'})).statusCode,404);
  assert.equal((await attach(deck,owner,image)).statusCode,200);
  assert.equal((await app.inject({url:image.src,headers:viewer})).statusCode,200);
  const pptx=await app.inject({url:path+'/export/pptx',headers:owner});assert.equal(pptx.statusCode,200);
  const zip=await JSZip.loadAsync(pptx.rawPayload);const xml=await zip.file('ppt/slides/slide1.xml')!.async('text');
  assert.match(xml,/Blue half of a two-colour sample/);
  const media=Object.keys(zip.files).find(key=>key.startsWith('ppt/media/') && key.endsWith('.png'))!;
  const exported=await sharp(await zip.file(media)!.async('nodebuffer')).raw().toBuffer({resolveWithObject:true});
  assert.equal(exported.info.channels,4);assert.equal(exported.data[3],0);
});

test('the image worker receives one moderated batch request and all four 1920x1080 choices are served as local PNGs',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lesson-image-batch-'));
  const before=process.env.STUDIO_IMAGE_ENDPOINT;
  process.env.STUDIO_IMAGE_ENDPOINT='http://127.0.0.1:12221/images';
  t.after(async()=>{if(before===undefined)delete process.env.STUDIO_IMAGE_ENDPOINT;else process.env.STUDIO_IMAGE_ENDPOINT=before;await rm(dir,{recursive:true,force:true});});
  const app=createStudioServer({dbPath:join(dir,'db.sqlite'),mediaRoot:join(dir,'media')});t.after(()=>app.close());
  const data:{b64_json:string}[]=[];
  for (const background of ['red','blue','yellow','green']) data.push({b64_json:(await sharp({create:{width:1920,height:1080,channels:3,background}}).png().toBuffer()).toString('base64')});
  const white={b64_json:(await sharp({create:{width:1920,height:1080,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64')};
  let duplicate=false, whiteBackground=false, inspect=0, rejectAll=false;
  const prompts:string[]=[];
  const reviewName='vision-review:latest';
  const previousReview=process.env.STUDIO_IMAGE_VERIFY_MODEL,previousOllama=process.env.STUDIO_OLLAMA_URL;
  delete process.env.STUDIO_IMAGE_VERIFY_MODEL;
  process.env.STUDIO_OLLAMA_URL='http://127.0.0.1:11434';
  t.after(()=>{for(const [key,value] of Object.entries({STUDIO_IMAGE_VERIFY_MODEL:previousReview,STUDIO_OLLAMA_URL:previousOllama})){if(value===undefined) delete process.env[key];else process.env[key]=value;}});
  const worker=t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
    if(url.pathname==='/api/tags') return Response.json({models:[{name:reviewName,digest:'approved-digest',details:{format:'gguf'}}]});
    if(url.pathname==='/api/show') return Response.json({capabilities:['vision']});
    if(url.pathname==='/api/chat'){
      const request=JSON.parse(String(init.body));
      const input=request.messages[1];
      assert.equal(input.images[0],data[inspect%4].b64_json);
      assert.equal(JSON.parse(input.content).place,'Observation station');
      inspect++;
      const verdict={subject:'pass',place:'pass',period:'pass',noLettering:rejectAll || inspect%2===0 ? 'fail':'pass',noRecognizableFaces:'pass'};
      return Response.json({done:true,model:reviewName,message:{content:JSON.stringify(verdict)}});
    }
    assert.equal(url.href,process.env.STUDIO_IMAGE_ENDPOINT);const body=JSON.parse(String(init.body));assert.equal(body.n,4);assert.equal(body.size,'1920x1080');assert.match(body.prompt,/planet/);
    prompts.push(body.prompt);
    return Response.json({data:duplicate ? Array(4).fill(data[0]) : whiteBackground ? [white,...data.slice(1)] : data});
  });
  const variants=()=>app.inject({method:'POST',url:'/api/decks/schoolyard-en/images/variants',payload:{prompt:'A planet orbiting a star',alt:'A planet beside a star',place:'Observation station',period:'Present day'}});
  const deckPath='/api/decks/schoolyard-en';
  const original=(await app.inject({url:deckPath})).json<Deck>();
  const editStyle=async(changes:Record<string,unknown>)=>app.inject({
    method:'PATCH',url:deckPath,payload:{op:{kind:'deck',...changes}},
  });
  const styled=await editStyle({imageStyle:'watercolor'});
  assert.equal(styled.statusCode,200,styled.body);
  const rethemed=await editStyle({theme:'contrast'});
  assert.equal(rethemed.json().imageStyle,'watercolor');
  assert.deepEqual(rethemed.json<Deck>().slides.map(slide=>slide.image),original.slides.map(slide=>slide.image));
  const result=await variants();assert.equal(result.statusCode,200,result.body);assert.equal(worker.mock.callCount(),1);
  assert.match(prompts[0],/watercolor/i);
  assert.match(prompts[0],/avoid white backgrounds/i);
  const choices=result.json<SlideImage[]>();assert.equal(new Set(choices.map(hit=>hit.src)).size,4);
  for (const item of choices) {const {width,height}=await sharp((await app.inject({url:item.src})).rawPayload).metadata();assert.equal(width,1920);assert.equal(height,1080);assert.equal(item.alt,'A planet beside a star');}
  whiteBackground=true;
  const filtered=await variants();
  assert.equal(filtered.statusCode,200,filtered.body);
  assert.deepEqual(filtered.json<SlideImage[]>().map(image=>image.src),choices.slice(1).map(image=>image.src));
  whiteBackground=false;
  duplicate=true;assert.equal((await variants()).statusCode,502);
  process.env.STUDIO_IMAGE_VERIFY_MODEL=reviewName;
  duplicate=false;
  const reviewed=await variants();assert.equal(reviewed.statusCode,200,reviewed.body);
  assert.equal(inspect,4);
  const accepted=reviewed.json<SlideImage[]>();assert.deepEqual(accepted.map(asset=>asset.src),[choices[0].src,choices[2].src]);
  for (const asset of accepted) assert.ok(asset.provenance?.source==='generated' && asset.provenance.review?.model===reviewName);
  const inherited=await editStyle({imageStyle:null});
  assert.equal(inherited.statusCode,200,inherited.body);
  assert.equal(inherited.json().imageStyle,undefined);
  rejectAll=true;assert.equal((await variants()).statusCode,422);
  assert.equal(inspect,8);
});

test('OpenAI serves one or four 1920x1080 PNGs and reports safe provider configuration errors',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lesson-image-openai-'));
  const names=['OPENAI_API_KEY','STUDIO_IMAGE_ENDPOINT','STUDIO_IMAGE_MODEL','STUDIO_IMAGE_API_KEY','STUDIO_IMAGE_VERIFY_MODEL','STUDIO_AUTH_MODE'];
  const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.OPENAI_API_KEY='openai-test-secret';
  t.after(async()=>{
    for (const [name,value] of Object.entries(before)) {
      if (value===undefined) delete process.env[name];
      else process.env[name]=value;
    }
    await rm(dir,{recursive:true,force:true});
  });
  const app=createStudioServer({dbPath:join(dir,'db.sqlite'),mediaRoot:join(dir,'media')});
  t.after(()=>app.close());
  const data=await Promise.all(['red','blue','yellow','green'].map(async background=>{
    const raster=await sharp({create:{width:1920,height:1088,channels:3,background}}).png().toBuffer();
    return {b64_json:raster.toString('base64')};
  }));
  let providerStatus=200;
  const worker=t.mock.method(globalThis,'fetch',async (url:URL,init:RequestInit)=>{
    assert.equal(url.href,'https://api.openai.com/v1/images/generations');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer openai-test-secret');
    const {prompt,n,...settings}=JSON.parse(String(init.body));
    assert.deepEqual(settings,{model:'gpt-image-2.6-flare',size:'1920x1088',output_format:'png',quality:'medium'});
    assert.match(prompt,/A planet orbiting a star/);
    if (providerStatus===401) return Response.json({error:{code:'expired_secret_key',message:'private-provider-message'}},{status:401});
    return Response.json({data:data.slice(0,n)});
  });
  const payload={prompt:'A planet orbiting a star',alt:'A planet beside a star'};
  const source=await app.inject({method:'POST',url:'/api/decks/schoolyard-en/images/variants',payload});
  assert.equal(source.statusCode,503);
  assert.deepEqual((await app.inject({url:'/api/decks/schoolyard-en/images/capabilities'})).json(),{generate:false});
  const created=await app.inject({method:'POST',url:'/api/decks',payload:blank});
  assert.equal(created.statusCode,201,created.body);
  const path='/api/decks/'+created.json<Deck>().id+'/images';
  assert.deepEqual((await app.inject({url:path+'/capabilities'})).json(),{generate:true});
  const result=await app.inject({method:'POST',url:path+'/variants',payload});
  assert.equal(result.statusCode,200,result.body);
  const variants=result.json<SlideImage[]>();
  assert.equal(variants.length,4);
  assert.equal(new Set(variants.map(({src})=>src)).size,4);
  for (const {src,provenance} of variants) {
    const raster=await app.inject({url:src});
    assert.equal(raster.statusCode,200);
    const {width,height}=await sharp(raster.rawPayload).metadata();
    assert.deepEqual([width,height],[1920,1080]);
    assert.deepEqual(provenance,{source:'generated',model:'gpt-image-2.6-flare'});
  }
  const single=await app.inject({method:'POST',url:path+'/variants',payload:{...payload,count:1}});
  assert.equal(single.statusCode,200,single.body);
  assert.deepEqual(single.json<SlideImage[]>(),variants.slice(0,1));
  providerStatus=401;
  const failure=await app.inject({method:'POST',url:path+'/variants',payload:{...payload,count:1}});
  assert.equal(failure.statusCode,503);
  assert.equal(failure.json().code,'image_provider_key');
  assert.doesNotMatch(failure.body,/test-secret|private-provider-message/);
  assert.equal(worker.mock.callCount(),3);
});
