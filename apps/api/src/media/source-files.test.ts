import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createStudioServer } from '../app';
import { fixtureOutline, fixtureSlide } from '../authoring/lessons';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';

async function docx(paragraphs: string[]) {
  const zip = new JSZip();
  const body = paragraphs.map(text => '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>').join('');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('extracts a local DOCX, preserves Unicode excerpts and follows their outline order', async t => {
  const app = createStudioServer({ dbPath: ':memory:' });
  t.after(() => app.close());
  const post = (payload: Buffer) => app.inject({ method: 'POST', url: '/api/sources/extract/docx', headers: { 'content-type': 'application/octet-stream' }, payload });
  const texts = ['Өсімдіктің тамыры', '🌱 Өсімдік 12.5 см өсті.', 'Тәжірибе аяқталды.'];
  const ok = await post(await docx(texts));
  assert.equal(ok.statusCode, 200);
  const source = { name: 'сабақ.docx', text: ok.json().text };
  assert.equal(source.text, texts.join('\n'));
  const deck = { ...makeFixtureDeck('kk'), topic: 'Өсімдіктер', source };
  const outline = fixtureOutline(deck, 3);
  assert.ok(outline[1].summary.includes('12.5'));
  const reversed = outline.toReversed();
  for (const [index, item] of reversed.entries()) {
    const slide = fixtureSlide(deck, item, index);
    assert.equal(slide.evidence?.[0].id, item.sourceExcerptId);
    assert.equal(slide.evidence?.[0].excerpt, texts[texts.length - 1 - index]);
    const { start, end, excerpt } = slide.evidence![0];
    assert.equal([...source.text].slice(start, end).join(''), excerpt);
    assert.ok(slide.body?.includes(excerpt));
    assert.equal(slide.body?.split(excerpt).length, 2);
  }
  assert.equal((await post(await docx(['  ']))).statusCode, 422);
  assert.equal((await post(Buffer.from('broken'))).statusCode, 422);
  assert.equal((await post(await docx(['x'.repeat(100_001)]))).statusCode, 413);
});
