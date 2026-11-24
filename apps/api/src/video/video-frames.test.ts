import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {makeFixtureDeck} from '@sabaq/lesson/fixture';
import {videoFrame, type FrameBox} from '@sabaq/contracts/video';
import {renderVideoSteps} from '../media/render-export';
import {catalogRoot,defaultMediaRoot} from '../runtime-paths';

test('video reserves a clear third for the avatar and keeps the AI label clear of authored content', () => {
  const frame = videoFrame({ aspect: '16:9', position: 'right', avatarPlacement: 'clear', captions: true });
  assert.equal(frame.avatarBox?.width, 640);
  const overlaps = (a: FrameBox, b: FrameBox) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  assert.ok(!overlaps(frame.contentBox, frame.labelBox));
  assert.ok(!overlaps(frame.avatarBox!, frame.labelBox));
  assert.ok(!overlaps(frame.captionBox!, frame.labelBox));
  const narration = videoFrame({ aspect: '9:16', position: 'none', captions: false });
  assert.ok(!overlaps(narration.contentBox, narration.labelBox));
});

test('native square and portrait PNGs reflow the text and reveal the second paragraph',async()=>{
  const source=makeFixtureDeck('kk'),deck={...source,slides:[{id:'native-frame',lessonPart:'lesson',status:'ready' as const,version:0,
    layout:'body' as const,title:'Су',body:'Суды бақылаңыз.\nНәтижені жазыңыз.',notes:'Бақылаңыз.\nЖазыңыз.'}]};
  for(const aspect of ['9:16','1:1'] as const){
    const frames=await renderVideoSteps(deck,{catalog:catalogRoot,generated:defaultMediaRoot},
      {aspect,language:'kk',position:'right',captions:true,revealParagraphs:true},2,AbortSignal.timeout(45000));
    assert.equal(frames.length,2);assert.ok(!frames[0].equals(frames[1]));
    const meta=await sharp(frames[0]).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,aspect==='1:1'?1080:1920);
  }
});

test('a slide with extra narration paragraphs holds its last reveal while narration continues',async()=>{
  const source=makeFixtureDeck('ru');
  const lines=Array.from({length:8},(_,index)=>`Абзац ${index+1}.`);
  const deck={...source,slides:[{id:'long-narration',lessonPart:'lesson',status:'ready' as const,version:0,
    layout:'body' as const,title:'Солнечная система',body:'Планеты движутся вокруг Солнца.',notes:lines.join('\n')}]};
  const settings={aspect:'16:9',language:'ru',position:'none',captions:true,revealParagraphs:true} as const;
  const frames=await renderVideoSteps(deck,{catalog:catalogRoot,generated:defaultMediaRoot},settings,lines.length,AbortSignal.timeout(45000));
  assert.equal(frames.length,lines.length);
  assert.ok(!frames[0].equals(frames[1]));
  assert.ok(frames.slice(2).every(frame=>frame===frames[1]));
});
