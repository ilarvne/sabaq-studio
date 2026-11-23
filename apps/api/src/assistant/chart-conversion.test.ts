import assert from 'node:assert/strict';
import test from 'node:test';
import {numericChartValue,numericTableValues} from '@sabaq/lesson/chart-data';
import type {Deck} from '@sabaq/lesson/types';
import type {AssistantSnapshot} from '@sabaq/contracts/assistant';
import {createStudioServer} from '../app';

test('chart conversion accepts decimal data without interpreting identifiers as measurements',()=>{
  for (const [input,value] of [[42,42],['42',42],[' -3.25 ',-3.25],['0',0],['0,5',.5],['.25',.25]] as const)
    assert.equal(numericChartValue(input),value);
  for (const input of ['002','00.2','-002','2024-06-21','1e3','',' ','Infinity','NaN','42 kg',NaN,Infinity])
    assert.equal(numericChartValue(input),undefined);
  const table={headers:['Group','Observations'],rows:[['A','42'],['B','-3.25']]};
  assert.deepEqual(numericTableValues(table),[[42],[-3.25]]);
  assert.deepEqual(table.rows,[['A','42'],['B','-3.25']]);
  assert.equal(numericTableValues({...table,rows:[['A','002']]}),undefined);
  assert.equal(numericTableValues({...table,rows:[['A']]}),undefined);
});

test('newly entered table strings become a validated chart proposal and retain the original table',async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const root='/api/decks/schoolyard-en';
  const original=(await app.inject({url:root})).json<Deck>();
  const slide=original.slides.find(item=>item.table)!;
  const table={headers:['Group','Observations'],rows:[['A','42'],['B','-3.25']]};
  const changed=await app.inject({method:'PATCH',url:root,payload:{op:{kind:'slide',slideId:slide.id,baseVersion:slide.version,changes:{table}}}});
  assert.equal(changed.statusCode,200);
  const response=await app.inject({method:'POST',url:root+'/assistant',payload:{
    clientId:'entered-chart',locale:'en',slideId:slide.id,text:'Convert the numeric data on the selected slide into a chart.',
  }});
  assert.equal(response.statusCode,200);
  const last=response.body.trim().split('\n').map(line=>JSON.parse(line) as AssistantSnapshot).at(-1);
  const proposal=last?.messages.at(-1)?.proposal;
  assert.ok(proposal,'numeric strings must pass the same chart validation as stored numbers');
  assert.deepEqual(proposal.changes?.[0].after?.chart?.series[0].values,[42,-3.25]);
  assert.deepEqual(proposal.changes?.[0].before?.table,table);
  assert.deepEqual((await app.inject({url:root})).json<Deck>().slides.find(item=>item.id===slide.id)?.table,table);
  const applied=await app.inject({method:'POST',url:`${root}/assistant/proposals/${proposal.id}`,payload:{action:'apply'}});
  assert.equal(applied.statusCode,200);
  const saved=(await app.inject({url:root})).json<Deck>().slides.find(item=>item.id===slide.id)!;
  assert.deepEqual(saved.table,table);
  assert.deepEqual(saved.chart?.series[0].values,[42,-3.25]);
});
