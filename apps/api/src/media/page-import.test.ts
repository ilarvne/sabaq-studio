import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createStudioServer } from '../app';
import type { Deck } from '@sabaq/lesson/types';

test('imports image, PPTX and PDF pages as owned local slide images', async t => {
  const media = await mkdtemp(join(tmpdir(), 'sabaq-import-test-'));
  const app = createStudioServer({ dbPath: ':memory:', mediaRoot: media });
  t.after(async () => { await app.close(); await rm(media, { recursive: true, force: true }); });
  const upload = (format: string, payload: Buffer) => app.inject({ method: 'POST',
    url: '/api/import/slides?format=' + format + '&title=Science&language=en',
    headers: { 'content-type': 'application/octet-stream' }, payload });
  const invalid = await upload('pptx', Buffer.from('invalid'));
  assert.equal(invalid.statusCode, 422);
  assert.equal((await readdir(media)).length, 0);
  const image = await upload('png', await sharp({ create: { width: 160, height: 90, channels: 3, background: '#204f47' } }).png().toBuffer());
  assert.equal(image.statusCode, 201, image.statusCode === 201 ? undefined : image.body);
  const deck: Deck = image.json();
  assert.equal(deck.phase, 'editing');
  assert.equal(deck.slides[0].importedPage, true);
  assert.equal((await app.inject({ url: deck.slides[0].image!.src })).statusCode, 200);
  for (const format of ['pptx', 'pdf']) {
    const original = await app.inject({ url: '/api/decks/' + deck.id + '/export/' + format });
    assert.equal(original.statusCode, 200);
    const imported = await upload(format, original.rawPayload);
    assert.equal(imported.statusCode, 201, imported.statusCode === 201 ? undefined : imported.body);
    assert.equal(imported.json<Deck>().slides.length, 1);
  }
  assert.equal((await readdir(media)).length, 3);
});

test('editable PowerPoint import keeps native objects over masked artwork and preserves a foreground-overlap fallback', async t => {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const pictureSlide = pptx.addSlide();
  pictureSlide.addText('Қазақстан', {x:1,y:0.2,w:11,h:1,bold:true});
  pictureSlide.addText([{text:'Кіріспе ',options:{bold:true}}, {text:'мәтіні',options:{italic:true}}],{x:1,y:2,w:7,h:2});
  pictureSlide.addNotes('Мұғалімге арналған ескерту');
  const png = await sharp({create:{width:80,height:80,channels:3,background:'#55aabb'}}).png().toBuffer();
  pictureSlide.addImage({data:'image/png;base64,'+png.toString('base64'),x:8,y:2,w:3,h:3,altText:'Өсімдік'});
  const tableSlide = pptx.addSlide();
  tableSlide.addText('Таблица', {x:1,y:0.2,w:11,h:1,bold:true});
  tableSlide.addTable([[{text:'Сан'},{text:'Түс'}],[{text:'03'},{text:'Көк'}]],{x:1,y:2});
  tableSlide.addNotes('Выслушайте ответы перед обсуждением.');
  const fallbackSlide = pptx.addSlide();
  fallbackSlide.addText('Фигура', {x:1,y:0.2,w:11,h:1,bold:true});
  fallbackSlide.addShape('rect',{x:1,y:2,w:3,h:2,fill:{color:'FF0000'}});
  fallbackSlide.addText('Проверьте картинку.',{x:6,y:1.8,w:5,h:.7});
  fallbackSlide.addImage({data:'image/png;base64,'+png.toString('base64'),x:8,y:4.4,w:1,h:1,altText:'Образец'});
  fallbackSlide.addTable([[{text:'Код'}],[{text:'03'}]],{x:5,y:3.2,w:2,h:.9});
  fallbackSlide.addNotes('Заметки смешанного слайда.');
  const overlap=pptx.addSlide();
  overlap.addText('Скрытая часть заголовка',{x:1,y:.2,w:8,h:1});
  overlap.addShape('rect',{x:2,y:.2,w:3,h:1,fill:{color:'FF3300'}});
  overlap.addNotes('Заметки сохраняются и для изображения.');

  const bytes = Buffer.from(await pptx.write({outputType:'nodebuffer'}) as Buffer);
  const mediaRoot = await mkdtemp(join(tmpdir(), 'sabaq-editable-import-'));
  const app = createStudioServer({dbPath:':memory:',mediaRoot});
  t.after(async () => { await app.close(); await rm(mediaRoot,{recursive:true,force:true}); });
  const url = '/api/import/slides?format=pptx&title=Import&language=kk&mode=editable&creationId=' + crypto.randomUUID();
  const upload = (path:string) => app.inject({
    method:'POST',url:path,payload:bytes,headers:{'content-type':'application/octet-stream'},
  });
  const response = await upload(url);
  assert.equal(response.statusCode,201,response.statusCode === 201 ? undefined : response.body);
  const deck = response.json<Deck>();
  assert.equal(deck.slides.length,4);
  const [picture,table,mixed,fallback] = deck.slides;
  assert.equal(picture.title,'Қазақстан');
  assert.equal(picture.body,'Кіріспе мәтіні');
  assert.equal(picture.notes,'Мұғалімге арналған ескерту');
  assert.equal(picture.image?.alt,'Өсімдік');
  assert.equal(picture.image?.provenance?.source,'upload');
  assert.equal((await app.inject({url:picture.image!.src})).statusCode,200);
  assert.equal(picture.importedPage,undefined);
  assert.deepEqual(table.table,{headers:['Сан','Түс'],rows:[['03','Көк']]});
  assert.equal(table.notes,'Выслушайте ответы перед обсуждением.');
  assert.equal(mixed.notes,'Заметки смешанного слайда.');
  assert.equal(mixed.title,'Фигура');assert.equal(mixed.body,'Проверьте картинку.');assert.equal(mixed.image?.alt,'Образец');
  assert.deepEqual(mixed.table,{headers:['Код'],rows:[['03']]});
  assert.ok(!mixed.importedPage && mixed.importedArtwork);
  assert.deepEqual(mixed.freeLayout?.items.map(item=>item.id),['title','body','image','table']);
  const artwork=await app.inject({url:mixed.importedArtwork});assert.equal(artwork.statusCode,200);
  const {data:pixels,info}=await sharp(artwork.rawPayload).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1920);assert.equal(info.height,1080);
  const pixel=(x:number,y:number)=>Array.from(pixels.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  assert.deepEqual(pixel(300,425),[255,0,0]); // Unsupported red shape remains in the artwork.
  for(const [x,y,w,h] of [[145,29,1250,145],[865,260,710,100],[1152,634,144,144],[720,461,270,120]]) {
    const {data}=await sharp(artwork.rawPayload).extract({left:x,top:y,width:w,height:h}).raw().toBuffer({resolveWithObject:true});
    assert.ok(data.every(channel=>channel>=250),'Native object remained visible in the artwork.');
  }
  const moved=await app.inject({method:'PATCH',url:'/api/decks/'+deck.id,payload:{op:{kind:'slide',slideId:mixed.id,baseVersion:0,changes:{title:'Жаңа атау'}}}});
  assert.equal(moved.statusCode,200,moved.body);
  const exportResult=await app.inject({url:'/api/decks/'+deck.id+'/export/pptx'});assert.equal(exportResult.statusCode,200);
  const {default:JSZip}=await import('jszip');
  const archive=await JSZip.loadAsync(exportResult.rawPayload),drawing=await archive.file('ppt/slides/slide3.xml')!.async('string');
  assert.ok(drawing.includes('Жаңа атау') && !drawing.includes('Фигура'));
  assert.ok(drawing.includes('Проверьте картинку.') && drawing.includes('<a:tbl>') && drawing.includes('Образец'));
  assert.ok(drawing.indexOf('Imported slide artwork')<drawing.indexOf('Жаңа атау'));
  assert.equal(fallback.notes,'Заметки сохраняются и для изображения.');
  assert.equal(fallback.importedPage,true);
  assert.equal((await app.inject({url:fallback.image!.src})).statusCode,200);
  assert.equal((await upload(url)).json<Deck>().id,deck.id);
  assert.equal((await upload(url.replace('mode=editable','mode=image'))).statusCode,409);
  assert.equal((await readdir(mediaRoot)).length,4);

  const edit = await app.inject({method:'PATCH',url:'/api/decks/'+deck.id,payload:{
    op:{kind:'slide',slideId:picture.id,baseVersion:picture.version,changes:{body:'Жаңартылған мәтін'}},
  }});
  assert.equal(edit.statusCode,200,edit.body);
  assert.equal(edit.json<Deck>().slides[0].body,'Жаңартылған мәтін');
});


test('editable PowerPoint import rejects document type declarations before publishing a lesson', async t => {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  archive.file('ppt/presentation.xml', '<!DOCTYPE p:presentation><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  const bytes = await archive.generateAsync({type:'nodebuffer'});
  const mediaRoot = await mkdtemp(join(tmpdir(), 'sabaq-rejected-import-'));
  const app = createStudioServer({dbPath:':memory:',mediaRoot});
  t.after(async () => { await app.close(); await rm(mediaRoot,{recursive:true,force:true}); });
  const response = await app.inject({
    method:'POST',url:'/api/import/slides?format=pptx&title=Import&language=kk&mode=editable',
    headers:{'content-type':'application/octet-stream'},payload:bytes,
  });
  assert.equal(response.statusCode,422);
  assert.equal((await readdir(mediaRoot)).length,0);
});
