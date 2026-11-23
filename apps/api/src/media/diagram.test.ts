import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { diagramGeometry, diagramKinds, selectionNodes } from '@sabaq/lesson/diagram';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { readLessonSlide } from '../assistant/lesson-passages';

test('selected lists preserve wording, order, and numbers and all graph positions fit the diagram',()=>{
  const labels=['2017 — Ашылу','2019 — Зерттеу','2025 — Нәтиже'];
  assert.deepEqual(selectionNodes(labels.map((s,i)=>(i+1)+'. '+s).join(' ')),labels);
  assert.deepEqual(selectionNodes('Почва; Вода; Воздух'),['Почва','Вода','Воздух']);
  assert.deepEqual(selectionNodes('Watch. Write. Compare.'),['Watch.','Write.','Compare.']);
  assert.deepEqual(selectionNodes('• Read; annotate\n• Compare\n• Share'),['Read; annotate','Compare','Share']);
  for (const type of diagramKinds) for(let n=3;n<=7;n++) {
    const {boxes,edges}=diagramGeometry(type,n);
    assert.equal(boxes.length,n);
    assert.equal(edges.length,type==='timeline' ? n+1 : n-1);
    for(const a of boxes) {
      assert.ok(a.x>=-.001 && a.y>=0 && a.x+a.w<=100.001 && a.y+a.h<=100.001);
      for(const b of boxes) if(a!==b) assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);
    }
  }
});

test('a diagram replays atomically, supports node editing, retrieval and editable native PowerPoint export', async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const created=await app.inject({method:'POST',url:'/api/decks',payload:{topic:'Field work',template:'blank',provider:'fixture',language:'en',review:false}});
  const original=created.json<Deck>(), source=original.slides[0], url='/api/decks/'+original.id;
  const diagram={kind:'mind-map',nodes:['Water','Condensation','Evaporation']};
  const id=randomUUID(), payload={operationId:randomUUID(),op:{kind:'add',afterId:source.id,newSlideId:id,diagram}};
  for(let retry=0;retry<2;retry++){
    const response=await app.inject({method:'PATCH',url,payload});
    assert.equal(response.statusCode,200);
    assert.equal(response.json<Deck>().slides.length,2);
  }
  const malformed=await app.inject({method:'PATCH',url,payload:{op:{kind:'slide',slideId:id,baseVersion:1,changes:{diagram:{...diagram,nodes:['One','Two']}}}}});
  assert.equal(malformed.statusCode,400);
  const nodes=['Water cycle','Condensation','Evaporation','Precipitation'];
  const edit=await app.inject({method:'PATCH',url,payload:{op:{kind:'slide',slideId:id,baseVersion:1,changes:{diagram:{...diagram,nodes}}}}});
  assert.equal(edit.statusCode,200);
  const saved=(await app.inject({url})).json<Deck>();
  assert.deepEqual(saved.slides[0],source);
  assert.deepEqual(saved.slides[1].diagram?.nodes,nodes);
  assert.equal(readLessonSlide(saved,id,['diagram'])[0].excerpt,nodes.join('\n'));
  const output=await app.inject({url:url+'/export/pptx'});
  assert.equal(output.statusCode,200);
  const zip=await JSZip.loadAsync(output.rawPayload);
  const xml=await zip.file('ppt/slides/slide2.xml')!.async('string');
  for(const label of nodes) assert.ok(xml.includes('<a:t>'+label+'</a:t>'));
  assert.equal((xml.match(/name="Diagram node /g)||[]).length,4);
  assert.equal((xml.match(/name="Diagram connection"/g)||[]).length,3);
});
