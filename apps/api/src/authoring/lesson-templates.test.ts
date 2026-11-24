import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonTemplates, matchingTemplates, templateIds, templatePlan } from '@sabaq/lesson/lesson-templates';
import type { Deck } from '@sabaq/lesson/types';
import { createStudioServer } from '../app';
import { fixtureOutline } from './lessons';

test('the school catalog offers 23 distinct teaching structures in all three languages',()=>{
  assert.equal(templateIds.length,23);
  assert.equal(new Set(templateIds.map(id=>lessonTemplates[id].steps.join(','))).size,templateIds.length);
  for (const locale of ['en','ru','kk'] as const) {
    const topics=new Set<string>();
    for (const id of templateIds) {
      const t=lessonTemplates[id];
      topics.add(t.topic[locale]);
      const example=templatePlan(id,locale,t.topic[locale],7);
      assert.ok(example[0].summary.includes(t.scenario[locale]));
      for (const count of [3,5,7,10,40]) {
        const plan=fixtureOutline({topic:'Topic Ω',language:locale,template:id},count);
        assert.equal(plan.length,count);
        assert.equal(plan[0].title,'Topic Ω');
        assert.ok(plan.every(item=>item.purpose && item.section));
        assert.ok(plan.every(item=>item.role===undefined));
        assert.equal(new Set(plan.map(item=>item.title)).size,count);
        assert.ok(plan.every(item=>item.summary.length>10));
      }
    }
    assert.equal(topics.size,templateIds.length);
  }
  assert.ok(matchingTemplates('arts',1).includes('music'));
  assert.ok(!matchingTemplates('arts',1).includes('critique'));
  assert.deepEqual(matchingTemplates('technology',1),[]);
});

test('catalog filters, custom preview, sourced structure and created deck share one template',async t=>{
  const app=createStudioServer({dbPath:':memory:',fixtureDelay:1});
  t.after(()=>app.close());
  const topic='Городской сад';
  const entries=(await app.inject({url:'/api/lesson-templates?language=ru&subject=technology&grade=4&topic='+encodeURIComponent(topic)})).json();
  assert.deepEqual(entries.map((entry:{id:string})=>entry.id),['engineering','debugging','projectBrief']);
  assert.equal(entries[0].plan[0].title,topic);
  const deck=(await app.inject({url:'/api/decks',method:'POST',payload:{topic,language:'ru',provider:'fixture',template:'engineering',review:true}})).json<Deck>();
  assert.equal(deck.theme,'blueprint');
  const project=(await app.inject({url:'/api/decks',method:'POST',payload:{
    topic,language:'ru',provider:'fixture',template:'projectBrief',review:true,
  }})).json<Deck>();
  assert.equal(project.theme,'spotlight');
  assert.equal((await app.inject('/api/decks/'+project.id)).json<Deck>().theme,'spotlight');
  const source={name:'Полевой журнал',text:'Во дворе растут яблони. Ученики составили план посадок.'};
  const plan=fixtureOutline({topic,language:'ru',source,template:'engineering'},7);
  assert.ok(plan.every(item=>item.sourceExcerptId));
  assert.deepEqual(plan.map(item=>item.title),entries[0].plan.map((item:{title:string})=>item.title));
});
