import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { createStudioServer } from '../app';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { effectiveFreeLayout } from '@sabaq/lesson/free-layout';
import type { Deck } from '@sabaq/lesson/types';
import { presentationCoverArtwork } from '@sabaq/lesson/themes';
import { makePowerPoint } from './powerpoint';
import { catalogRoot, defaultMediaRoot } from '../runtime-paths';

test('PowerPoint sends editable slides, charts, tables, notes and images from the saved revision',async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const url='/api/decks/schoolyard-kk/export/pptx';
  const stale=await app.inject({url:url+'?revision=99'});
  assert.equal(stale.statusCode,409);
  const response=await app.inject({url:url+'?revision=0'});
  assert.equal(response.statusCode,200,response.statusCode===200?'':response.body);
  assert.match(String(response.headers['content-type']),/^application\/vnd\.openxmlformats/);
  assert.match(String(response.headers['content-disposition']),/filename\*=UTF-8''/);
  const zip=await JSZip.loadAsync(response.rawPayload);
  const entries=Object.keys(zip.files);
  const slides=entries.filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  const deck=makeFixtureDeck('kk');
  assert.equal(slides.length,deck.slides.length);
  const xml=await Promise.all(slides.map(name=>zip.file(name)!.async('string')));
  const first=await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.ok(first.includes(deck.slides[0].title));
  assert.match(first,/<p:ph[^>]*type="title"/);
  assert.ok(first.includes(deck.slides[0].image!.alt));
  assert.ok(xml.some(slide=>slide.includes('<a:tbl>')));
  assert.ok(entries.some(name=>/^ppt\/embeddings\/.+\.xlsx$/.test(name)));
  assert.ok(entries.some(name=>/^ppt\/charts\/chart\d+\.xml$/.test(name)));
  assert.ok(entries.some(name=>/^ppt\/media\/.+\.png$/.test(name)));
  const notes=await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string');
  assert.ok(notes.includes(deck.slides[0].notes));
});

test('PowerPoint refuses an outline that does not have a complete set of slides',async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const created=await app.inject({
    method:'POST',url:'/api/decks',
    payload:{topic:'Editable lesson',language:'en',provider:'fixture',review:true},
  });
  assert.equal(created.statusCode,201);
  const {id}=created.json<{id:string}>();
  const response=await app.inject({url:'/api/decks/'+id+'/export/pptx'});
  assert.equal(response.statusCode,409);
});

test('the new theme covers export as native text and editable decorative shapes', async () => {
  const deck = makeFixtureDeck('kk');
  deck.slides = [{ ...deck.slides[0], layout:'cover', title:'Дала күнделігі', body:'Бақылау және қорытынды', image:undefined, design:undefined }];
  for (const theme of ['field-notes', 'collage', 'spotlight', 'strategy', 'signal'] as const) {
    const pptx = await makePowerPoint({...deck,theme}, {catalog:catalogRoot,generated:defaultMediaRoot});
    const zip = await JSZip.loadAsync(pptx);
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    assert.match(slide, /<a:t>Дала күнделігі<\/a:t>/u);
    assert.match(slide, /name="Cover ornament 1"/);
    assert.match(slide, /<adec:decorative\b/);
    assert.doesNotMatch(slide, /<p:pic>/);
  }
});

test('free placement keeps native cover ornaments behind the editable slide content', async () => {
  const deck = makeFixtureDeck('kk');
  const cover = { ...deck.slides[0], layout:'cover' as const, title:'Дала күнделігі', body:'Бақылау және қорытынды', image:undefined, design:undefined };
  const pptx = await makePowerPoint({...deck,theme:'field-notes',slides:[{...cover,freeLayout:effectiveFreeLayout(cover)}]},
    {catalog:catalogRoot,generated:defaultMediaRoot});
  const zip = await JSZip.loadAsync(pptx);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(xml, /<a:t>Дала күнделігі<\/a:t>/u);
  assert.match(xml, /name="Cover ornament 1"/);
  assert.match(xml, /<adec:decorative\b/);
  assert.doesNotMatch(xml, /<p:pic>/);
  assert.ok(xml.indexOf('Cover ornament 1') < xml.indexOf('Дала күнделігі'));
});

test('saved cover artwork edits export as native paths and honor removal', async t => {
  const app = createStudioServer({dbPath:':memory:'});
  t.after(() => app.close());
  const created = await app.inject({method:'POST',url:'/api/decks',payload:{
    topic:'Chess introduction',language:'en',provider:'fixture',template:'blank',review:false,
  }});
  const deck = created.json<Deck>();
  const url = '/api/decks/' + deck.id;
  const selected = await app.inject({method:'PATCH',url,payload:{op:{kind:'deck',theme:'notebook'}}});
  assert.equal(selected.statusCode,200,selected.body);
  const original = deck.slides[0];
  const cover = {...original,layout:'cover' as const};
  const [first] = presentationCoverArtwork({...deck,theme:'notebook'},cover);
  const object = {...first,x:60,y:6,color:'#8844aa',rotation:15};
  const applied = await app.inject({method:'PATCH',url,payload:{op:{
    kind:'slide',slideId:original.id,baseVersion:original.version,
    changes:{layout:'cover',coverArtwork:{theme:'notebook',objects:[object]}},
  }}});
  assert.equal(applied.statusCode,200,applied.body);
  assert.equal((await app.inject({url})).json<Deck>().slides[0].coverArtwork?.objects[0].x,60);
  const response = await app.inject({url:url+'/export/pptx'});
  assert.equal(response.statusCode,200);
  const zip = await JSZip.loadAsync(response.rawPayload);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(xml, /name="Cover ornament 1"/);
  assert.match(xml, /<a:custGeom>/);
  assert.match(xml, /<a:xfrm rot="900000">/);
  assert.match(xml, /<a:srgbClr val="8844AA">/);
  assert.doesNotMatch(xml, /Cover ornament 2|<p:pic>/);
});

test('PDF exports selectable lesson pages and PNG exports only the requested ready slide', async t => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const deck = makeFixtureDeck('kk');
  const root = '/api/decks/' + deck.id + '/export/';
  const missing = await app.inject({ url: root + 'png?slideId=missing' });
  assert.equal(missing.statusCode, 404);
  const stale = await app.inject({ url: root + 'pdf?revision=99' });
  assert.equal(stale.statusCode, 409);
  const pdf = await app.inject({ url: root + 'pdf?revision=0' });
  assert.equal(pdf.statusCode, 200, pdf.statusCode === 200 ? undefined : pdf.body);
  assert.match(String(pdf.headers['content-type']), /application\/pdf/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.rawPayload.toString('latin1').match(/\/Type \/Page\b/g)?.length, deck.slides.length);
  const extract = await app.inject({ method: 'POST', url: '/api/sources/extract/pdf',
    headers: { 'content-type': 'application/octet-stream' }, payload: pdf.rawPayload });
  assert.equal(extract.statusCode, 200);
  const text = extract.json().text.replace(/\s+/gu, ' ');
  assert.ok(text.includes(deck.slides[0].title));
  assert.ok(text.includes(deck.slides.at(-1)!.title));
  const png = await app.inject({ url: root + 'png?slideId=' + deck.slides[1].id + '&revision=0' });
  assert.equal(png.statusCode, 200, png.statusCode === 200 ? undefined : png.body);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal(png.rawPayload.readUInt32BE(0), 0x89504e47);
  assert.equal(png.rawPayload.readUInt32BE(16), 1920);
  assert.equal(png.rawPayload.readUInt32BE(20), 1080);
});
