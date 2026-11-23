import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixtureDeck } from '@sabaq/lesson/fixture';
import { displaySlide, slideTypography } from '@sabaq/lesson/typography';
import { catalogRoot, defaultMediaRoot } from '../runtime-paths';
import { createStudioServer } from '../app';
import { measureSlideQuality, renderSlideFile } from '../media/render-export';
import type { Slide } from '@sabaq/lesson/types';
import type { JSONContent } from '@tiptap/core';
const nb='\u00a0';

test('lesson typography keeps language-specific quotes, grouped figures, nonbreaking units and ranges',()=>{
  assert.equal(slideTypography('В доме "урок": 12345.5 мл, 50%, 1941 - 1945.','ru'),'В'+nb+'доме «урок»: 12'+nb+'345,5'+nb+'мл, 50'+nb+'%, 1941–1945.');
  assert.equal(slideTypography('Оқу үшін "өлшеу", 5-7 сынып, II-XV ғасырлар, 1000 ₸.','kk'),'Оқу'+nb+'үшін «өлшеу», 5–7 сынып, II–XV ғасырлар, 1'+nb+'000'+nb+'₸.');
  assert.equal(slideTypography('"Read" pages 5 - 7; 1,234.5 cm.','en'),'“Read” pages 5–7; 1'+nb+'234.5'+nb+'cm.');
  assert.equal(slideTypography('For 1,000, use the coordinate (1,2).','en'),'For 1'+nb+'000, use the coordinate (1,2).');
  assert.equal(slideTypography('Location (2.5, 7.5), label 2,3.','en'),'Location (2.5, 7.5), label 2,3.');
  const link='https://example.org/2000-2020/1234.5?q=7';
  assert.equal(slideTypography(link+' 2025-03-12','en'),link+' 2025-03-12');
});
test('typography leaves narration and original teacher/source data intact',()=>{
  const deck=makeFixtureDeck('kk'), original={...deck.slides[0],body:'5-7 сынып',notes:'5-7 сынып',richText:undefined,bodyRuns:undefined};
  const display=displaySlide(original,'kk');
  assert.equal(display.body,'5–7 сынып');
  assert.equal(display.notes,'5-7 сынып');
  assert.equal(original.body,'5-7 сынып');
});

test('nonbreaking spaces cross formatting runs while preserving marks and source text',()=>{
  const slide=makeFixtureDeck('ru').slides[0];
  const bodyRuns=[{text:'В',italic:true},{text:' доме 10'},{text:' кг',bold:true}];
  const content=bodyRuns.map(run=>({type:'text',text:run.text,marks:run.italic ? [{type:'italic'}] : run.bold ? [{type:'bold'}] : []}));
  const source={...slide,body:'В доме 10 кг',bodyRuns,richText:{body:{type:'doc',content:[{type:'paragraph',content}]}}};
  const result=displaySlide(source,'ru');
  assert.equal(result.body,'В'+nb+'доме 10'+nb+'кг');
  assert.deepEqual(result.bodyRuns, [{text:'В',italic:true},{text:nb+'доме 10'},{text:nb+'кг',bold:true}]);
  const rendered=(result.richText?.body as JSONContent | undefined)?.content?.[0].content;
  assert.deepEqual(rendered?.map(run=>run.text),['В',nb+'доме 10',nb+'кг']);
  assert.deepEqual(rendered?.map(run=>run.marks),content.map(run=>run.marks));
  assert.equal(source.body,'В доме 10 кг');
  assert.equal(source.bodyRuns.at(-1)?.text,' кг');
});

test('oversized words are flagged at the type floor and a fitting word remains selectable in PDF',async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const deck=makeFixtureDeck('kk');
  const word='Құндылық'.repeat(5);
  const tooWide='Қ'.repeat(160);
  const common={title:'Ұзын сөз',notes:'',layout:'body',status:'ready',version:1,lessonPart:'lesson'} as const;
  const fits:Slide={...common,id:'word',body:word};
  const exceeds:Slide={...common,id:'wide',body:tooWide};
  const roots={catalog:catalogRoot,generated:defaultMediaRoot};
  const issues=await measureSlideQuality({...deck,slides:[fits,exceeds]},roots,AbortSignal.timeout(15_000));
  assert.ok(!issues[fits.id].includes('overflow'));
  assert.ok(issues[exceeds.id].includes('overflow'));
  assert.ok(!issues[exceeds.id].includes('small-type'));
  const pdf=await renderSlideFile({...deck,slides:[fits]},'pdf',roots);
  const extracted=await app.inject({method:'POST',url:'/api/sources/extract/pdf',
    headers:{'content-type':'application/octet-stream'},payload:pdf});
  assert.equal(extracted.statusCode,200,extracted.body);
  assert.ok(extracted.json<{text:string}>().text.includes(word));
  assert.equal(exceeds.body,tooWide);
});
