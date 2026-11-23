import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClassroomPoll } from '@sabaq/contracts/poll';
import { createStudioServer } from '../app';

test('30 anonymous participants can vote, update a ballot, and lose access when the poll closes',async t=>{
  const app=createStudioServer({dbPath:':memory:'});
  t.after(()=>app.close());
  const teacher='/api/decks/schoolyard-kk/poll';
  const props={kind:'quiz',question:'Choose a colour',options:['Green','Blue'],correct:0};
  const created=await app.inject({method:'POST',url:teacher,payload:props});
  assert.equal(created.statusCode,201);
  const {code}=created.json<ClassroomPoll>();
  const url='/api/classroom-polls/'+code;
  assert.equal((await app.inject({method:'POST',url:teacher,payload:props})).statusCode,409);
  const started=performance.now();
  const cookies=await Promise.all(Array.from({length:30},async (_,i)=>{
    const get=await app.inject({url});
    assert.equal(get.statusCode,200);
    assert.equal(get.json().correct,undefined);
    assert.equal(get.json().deckId,undefined);
    const cookie=String(get.headers['set-cookie']).split(';')[0];
    const res=await app.inject({method:'POST',url,headers:{cookie},payload:{choice:i%2}});
    assert.equal(res.statusCode,200);
    return cookie;
  }));
  assert.deepEqual((await app.inject({url:teacher})).json().poll.counts,[15,15]);
  t.diagnostic('Thirty local HTTP participants and teacher read took '+Math.round(performance.now()-started)+' ms');
  const change={method:'POST',url,headers:{cookie:cookies[0]},payload:{choice:1}} as const;
  await app.inject(change);
  await app.inject(change);
  assert.deepEqual((await app.inject({url:teacher})).json().poll.counts,[14,16]);
  assert.equal((await app.inject({method:'DELETE',url:teacher})).statusCode,204);
  assert.equal((await app.inject(change)).statusCode,404);
});
