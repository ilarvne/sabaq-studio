import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { makePowerPoint } from './powerpoint';
import { renderSlideFile } from './render-export';
import { catalogRoot } from '../runtime-paths';
import { createStudioServer } from '../app';
import type { Deck } from '@sabaq/lesson/types';

const primary = 'Бірінші суреттің сипаттамасы';
const secondary = 'Екінші суреттің сипаттамасы';
const decorative = 'Сәндік белгі сипаттамасы';
const chartAlternative = 'Баған диаграммасының сипаттамасы';
const diagramAlternative = 'Үдеріс. 1. Бірінші қадам. 2. Екінші қадам. 3. Үшінші қадам';
const roots = { catalog: catalogRoot, generated: '.' };

function exampleDeck() {
  const deck = makeFixtureDeck('kk');
  const original = deck.slides.find(slide => slide.image)!;
  const chart = deck.slides.find(slide => slide.chart)!;
  deck.slides = [
    { ...original, layout: 'image-grid', design: undefined, body: '', image: { ...original.image!, alt: primary },
      additionalImages: [{ ...original.image!, alt: secondary }, { ...original.image!, alt: decorative, decorative: true }] },
    { ...chart, chart: { ...chart.chart!, alt: chartAlternative } },
    { ...original, id: 'diagram', design: undefined, image: undefined, layout: 'body',
      diagram: { kind: 'process', nodes: ['Бірінші қадам', 'Екінші қадам', 'Үшінші қадам'] } },
  ];
  return deck;
}

test('PowerPoint carries native alternatives for pictures, charts and editable diagrams', async () => {
  const zip = await JSZip.loadAsync(await makePowerPoint(exampleDeck(), roots));
  const xml = (index: number) => zip.file('ppt/slides/slide' + index + '.xml')!.async('string');
  const pictures = await xml(1);
  assert.ok(pictures.includes('descr="' + primary + '"'));
  assert.ok(pictures.includes('descr="' + secondary + '"'));
  const decorativeProps = pictures.match(/<p:cNvPr[^>]*name="Slide illustration 3"[^>]*>[\s\S]*?<\/p:cNvPr>/)?.[0];
  assert.ok(decorativeProps);
  assert.ok(decorativeProps.includes('<adec:decorative'));
  assert.ok(!decorativeProps.includes('descr='));
  assert.ok(!pictures.includes(decorative));
  assert.ok((await xml(2)).includes('descr="' + chartAlternative + '"'));
  const diagram = await xml(3);
  assert.ok(diagram.includes('descr="' + diagramAlternative + '"'));
  assert.match(diagram, /<p:grpSp>[\s\S]*?<a:t>Үшінші қадам<\/a:t>[\s\S]*?<\/p:grpSp>/);
});

test('tagged PDF emits one alternative per meaningful figure and excludes decorative images', async () => {
  const pdf = (await renderSlideFile(exampleDeck(), 'pdf', roots)).toString('latin1');
  assert.match(pdf, /\/StructTreeRoot/);
  const descriptions = [...pdf.matchAll(/\/S \/Figure\b(?:(?!endobj)[\s\S])*?\/Alt <FEFF([\dA-F]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, 'hex').swap16().toString('utf16le'));
  assert.deepEqual(descriptions.sort(), [primary, secondary, chartAlternative, diagramAlternative].sort());
});

test('an edited diagram description persists and reaches both exports', async t => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const created = await app.inject({ method:'POST', url:'/api/decks', payload:{
    topic:'Оқу сызбасы', template:'blank', language:'kk', provider:'fixture', review:false,
  } });
  assert.equal(created.statusCode, 201, created.body);
  const initial = created.json<Deck>();
  const slide = initial.slides[0];
  const alt = 'Суды өлшеудің үш кезеңі';
  const changed = await app.inject({ method:'PATCH', url:'/api/decks/'+initial.id, payload:{
    op:{ kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{diagram:{
      kind:'process',nodes:['Дайындау','Өлшеу','Тіркеу'],alt,
    } } },
  } });
  assert.equal(changed.statusCode, 200, changed.body);
  const deck = changed.json<Deck>();
  const zip = await JSZip.loadAsync(await makePowerPoint(deck,roots));
  assert.ok((await zip.file('ppt/slides/slide1.xml')!.async('string')).includes('descr="'+alt+'"'));
  const pdf = (await renderSlideFile(deck,'pdf',roots)).toString('latin1');
  const expectedHex = Buffer.from(alt,'utf16le').swap16().toString('hex').toUpperCase();
  assert.ok(pdf.includes('/Alt <FEFF'+expectedHex+'>'));
});
