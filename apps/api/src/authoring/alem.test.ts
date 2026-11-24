import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { templatePlan } from '@sabaq/lesson/lesson-templates';
import { AlemOutputError } from './alem';
import { generateOutline } from './generate-outline';
import { generateSlide } from './generate-slide';

test('Alem adapter uses the configured server credential and validates returned lesson JSON', async context => {
  const previous = process.env.ALEM_API_KEY;
  process.env.ALEM_API_KEY = 'fixture-key';
  context.after(() => {
    if (previous === undefined) delete process.env.ALEM_API_KEY;
    else process.env.ALEM_API_KEY = previous;
  });

  const slide = { title:'Өлшеу', summary:'Ыдыстағы суды өлшеу', purpose:'Көлемнің қалай өлшенетінін көрсету', layout:'centered' } as const;
  context.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://llm.alem.ai/v1/chat/completions');
    assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer fixture-key');
    const body = JSON.parse(String(request.body));
    assert.equal(body.model, 'alemllm');
    assert.equal(body.stream, false);
    assert.deepEqual(body.response_format, { type:'json_object' });
    assert.equal(JSON.parse(body.messages[1].content).topic, 'Су көлемі');
    assert.equal(request.redirect, 'error');
    const input = JSON.parse(body.messages[1].content);
    assert.ok(!('agenda' in input) && !('role' in input));
    return Response.json({ choices: [{ message: { content: JSON.stringify({slides:[slide]}) } }] });
  });
  assert.deepEqual(await generateOutline('Су көлемі','kk',1), {items:[slide],theme:undefined});
  const item = { id:'s01', title:'Өлшеу', summary:'Ыдыстағы суды өлшеу', layout:'cover' } as const;
  await assert.rejects(
    generateSlide({topic:'Су көлемі',language:'kk',outline:[item]},item,0,new AbortController().signal),
    /did not match the requested format/,
  );
});

test('an invalid model layout falls back to the chosen template stage and valid data can override it', async () => {
  const topic = 'Судың көлемін өлшеу';
  const recommendations = templatePlan('measurement','kk',topic,4);
  const complete = async <T>(_instruction: string, input: object, schema: z.ZodType<T>) => {
    const { structure } = input as { structure: { recommendedLayout: string }[] };
    assert.deepEqual(structure.map(stage => stage.recommendedLayout), recommendations.map(stage => stage.layout));
    return schema.parse({slides: recommendations.map((stage,index) => ({ ...stage, layout: ['body','hallucinated-layout','data-chart'][index] }))});
  };
  const result = await generateOutline(topic,'kk',4,undefined,{imageSource:'none'},'measurement',complete);
  assert.deepEqual(result.items.map(slide=>slide.layout), ['cover',recommendations[1].layout,'data-chart',recommendations[3].layout]);
});

test('teaching roles shape untemplated slides while valid specialized layouts stay available', async () => {
  const topic = 'Как шахматный гамбит меняет позицию?';
  const drafts = [
    { title:'Что такое гамбит?', role:'opening', layout:'body' },
    { title:'Две партии', role:'examples' },
    { title:'Что мы узнали?', role:'recap', layout:'body' },
    { title:'Сравнение ходов', role:'examples', layout:'native-table' },
    { title:'Проверочный вопрос', role:'unsupported-role', layout:'centered' },
  ];
  const complete = async <T>(_instruction: string, input: object, schema: z.ZodType<T>) => {
    assert.equal((input as {slideRoles:{examples:{layout:string}}}).slideRoles.examples.layout,'split');
    return schema.parse({slides:drafts.map(stage=>({...stage,summary:'Проанализируйте позицию.',purpose:'Объясните идею класса.'}))});
  };
  const result = await generateOutline(topic,'ru',drafts.length,undefined,undefined,undefined,complete);
  assert.deepEqual(result.items.map(slide => slide.layout),['cover','split','quote','native-table','centered']);
  assert.deepEqual(result.items.map(slide => slide.role),['opening','examples','recap','examples',undefined]);
});

test('an overlong Alem outline is rewritten once into the requested slots', async () => {
  const topic = 'Compare the knight and bishop, make an editable diagram and end with a recall question.';
  const overview = { title:'Chess movement', summary:'Identify how the pieces move.', purpose:'Introduce the lesson.', role:'opening', layout:'cover' };
  const compare = {...overview,title:'Compare the pieces',role:'examples',layout:'split'};
  const diagram = {...overview,title:'Diagram a move sequence',summary:'Place the knight and trace where it can jump.',role:'activity',layout:'stacked'};
  const recall = {...overview,title:'Recall the move',summary:'Which piece jumps over others?',role:'reflection',layout:'centered',assessment:true};
  let calls=0;
  const complete = async <T>(instruction: string, input: object, schema: z.ZodType<T>) => {
    assert.equal((input as {count:number}).count,4);
    calls++;
    if (calls === 1) {
      assert.match(instruction,/^Return exactly 4 slide entries/u);
      const overlong = {slides:[overview,compare,diagram,overview,compare,diagram,recall]};
      assert.equal(schema.safeParse(overlong).success,false);
      throw new AlemOutputError('Too many slides.');
    }
    assert.match(instruction,/"slots":\{"slide1":/u);
    assert.match(instruction,/"slide4":/u);
    return schema.parse({slots:{slide4:recall,slide2:compare,slide1:overview,slide3:diagram}});
  };
  const result=await generateOutline(topic,'en',4,undefined,{image:'none',quiz:'include'},undefined,complete);
  assert.equal(calls,2);
  assert.deepEqual(result.items.map(slide=>slide.title),[overview.title,compare.title,diagram.title,recall.title]);
  assert.equal(result.items[2].layout,'stacked');
  assert.equal(result.items[2].diagramKind,'process');
  assert.equal(result.items[3].assessment,true);
});

test('a missing planned timeline is repaired with native nodes in one corrective request', async () => {
  const item = {id:'s1',title:'Follow the water',summary:'Trace rain, runoff, and collection.',layout:'stacked',diagramKind:'timeline'} as const;
  const plain = {title:item.title,body:item.summary,notes:'Review each stage.'};
  const diagram = {kind:'timeline',nodes:['Rain falls','Water runs downhill','Water collects']};
  let calls = 0;
  const complete = async <T>(instruction: string, input: object, schema: z.ZodType<T>) => {
    assert.equal((input as {diagramKind:string}).diagramKind,'timeline');
    assert.match(instruction,/native.*timeline/u);
    calls++;
    return schema.parse(calls === 1 ? plain : { diagram });
  };
  const result = await generateSlide({topic:'The movement of water',language:'en',outline:[item],imageMode:'none'},item,0,
    new AbortController().signal,undefined,false,false,complete);
  assert.equal(calls,2);
  assert.deepEqual(result.diagram,diagram);
  assert.equal(result.notes,plain.notes);
});

test('a complete outline gets one corrective request when it omits the required closing check', async () => {
  const topic = 'Show a sequence of moves with an editable diagram and finish with a short recall question.';
  const opening = {title:'Opening',summary:'Introduce the board.',purpose:'Set the goal.',layout:'cover',role:'opening'};
  const example = {title:'Trace the moves',summary:'Trace the knight and bishop.',purpose:'Work through the sequence.',layout:'stacked',diagramKind:'process',role:'activity'};
  const recall = {title:'What can jump?',summary:'Which piece can jump over another?',purpose:'Check recall.',layout:'centered',role:'reflection',assessment:true};
  let calls = 0;
  const complete = async <T>(instruction: string, _input:object, schema:z.ZodType<T>) => {
    calls++;
    if (calls === 1) return schema.parse({slides:[opening,{...example,diagramKind:undefined},example]});
    assert.match(instruction,/final.*assessment:true/u);
    return schema.parse({slots:{slide1:opening,slide2:example,slide3:recall}});
  };
  const {items} = await generateOutline(topic,'en',3,undefined,{image:'none',quiz:'include'},undefined,complete);
  assert.equal(calls,2);
  assert.equal(items[1].diagramKind,'process');
  assert.equal(items[2].assessment,true);
  assert.equal(items[2].diagramKind,undefined);
});

test('drafting a data slide drops chart points absent from the approved brief', async () => {
  const item = {id:'s1',title:'Өлшеу',summary:'12 және 27 мл',layout:'data-chart'} as const;
  const complete = async <T>(_instruction: string, _input: object, schema: z.ZodType<T>) => schema.parse({
    title:item.title,body:item.summary,notes:'Өлшем нәтижелерін салыстырыңыз.',
    chart:{ categories:['Бірінші','Екінші'], series:[{name:'Көлем',values:[12,99]}], alt:'Екі өлшем' },
  });
  const slide = await generateSlide({topic:'Судың көлемі',language:'kk',outline:[item]},item,0,new AbortController().signal,
    undefined,false,false,complete);
  assert.equal(slide.chart,undefined);
  assert.equal(slide.body,item.summary);
});
