import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { createStudioServer } from '../app';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';

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
