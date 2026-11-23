import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { makePowerPoint } from './powerpoint';
import { catalogRoot } from '../runtime-paths';
import type { FreeLayout } from '@sabaq/lesson/free-layout';

const image = { id: 'image', x: 59, y: 32, w: 38, h: 51, rotation: 0 } as const;
const title = { id: 'title', x: 4, y: 5, w: 56, h: 18, rotation: 0 } as const;
const body = { id: 'body', x: 4, y: 32, w: 46, h: 51, rotation: 0 } as const;
const titlePlaceholder = /<p:ph\b[^>]*\btype="title"[^>]*\/>/g;

async function slideXml(freeLayout?: FreeLayout, raster = false) {
  const deck = makeFixtureDeck('en');
  const original = deck.slides.find(slide => slide.image)!;
  deck.slides = [{ ...original, title: 'Readable lesson title', body: 'Readable lesson text',
    ...(freeLayout && { freeLayout }), ...(raster && { importedPage: true, layout: 'image-full' as const }) }];
  const zip = await JSZip.loadAsync(await makePowerPoint(deck, { catalog: catalogRoot, generated: '.' }));
  return await zip.file('ppt/slides/slide1.xml')!.async('string');
}

test('raster import exports an off-slide native title before the accessible slide image', async () => {
  const xml = await slideXml(undefined, true);
  assert.equal([...xml.matchAll(titlePlaceholder)].length, 1);
  assert.match(xml, /<a:off x="-\d+" y="0"\/>/);
  assert.ok(xml.indexOf('Readable lesson title') < xml.indexOf('<p:pic>'));
  assert.match(xml, /<p:cNvPr[^>]*\bdescr="[^"]+"/);
});

test('free layout puts disjoint title and text before pictures and preserves overlapping layers', async () => {
  const disjoint = await slideXml({ items: [image, body, title] });
  assert.equal([...disjoint.matchAll(titlePlaceholder)].length, 1);
  assert.ok(disjoint.indexOf('Readable lesson title') < disjoint.indexOf('Readable lesson text'));
  assert.ok(disjoint.indexOf('Readable lesson text') < disjoint.indexOf('<p:pic>'));

  const overlapping = await slideXml({ items: [{ ...image, x: body.x }, body, title] });
  assert.ok(overlapping.indexOf('Readable lesson title') < overlapping.indexOf('<p:pic>'));
  assert.ok(overlapping.indexOf('<p:pic>') < overlapping.indexOf('Readable lesson text'));
});

test('grouped and rotated free titles retain visual geometry plus an independent semantic title', async () => {
  const group = 'text';
  const xml = await slideXml({ items: [image, { ...title, group, rotation: 3 }, { ...body, group }] });
  assert.equal([...xml.matchAll(titlePlaceholder)].length, 1);
  assert.match(xml, /<a:xfrm rot="180000"/);
  assert.match(xml, /name="Layout group"/);
  assert.match(xml, /<adec:decorative[^>]*\bval="1"/);
  assert.ok(xml.indexOf('Readable lesson title') < xml.indexOf('name="Layout group"'));
});
