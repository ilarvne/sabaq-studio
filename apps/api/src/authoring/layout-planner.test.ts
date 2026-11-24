import assert from 'node:assert/strict';
import test from 'node:test';
import type { Layout, OutlineItem, SlideImage } from '@sabaq/lesson/types';
import { lessonSlideSchema, slideComposition } from './generate-slide';
import { composeDraft } from './compose';
import { generationLayoutChoices, planOutlineLayouts, retainRequestedChart } from './layout-planner';

const item = (layout: Layout, index = 0): OutlineItem => ({ id: String(index), title: 'Судың көлемі', summary: 'Мензурканы оқыңыз.', layout });
const draft = { title: 'Судың көлемі', body: 'Мензурканы оқыңыз.', notes: 'Өлшеуді талқылаңыз.' };
const image: SlideImage = { src: '/assets/water-lab.webp', alt: 'Бір стақан су' };

test('the outline respects the available art and varies interchangeable layouts', () => {
  assert.ok(!('image-full' in generationLayoutChoices(false)));
  assert.ok('image-full' in generationLayoutChoices(true));
  const original = (['image-grid', 'body', 'body', 'body', 'data-chart', 'data-chart', 'data-chart'] as const).map(item);
  const planned = planOutlineLayouts(original, () => false);
  assert.deepEqual(planned.map(({layout}) => layout), ['body', 'body', 'stacked', 'body', 'data-chart', 'data-chart', 'data-chart']);
  assert.equal(original[0].layout, 'image-grid');
  const illustrated = planOutlineLayouts([item('image-right'), item('image-right', 1), item('image-grid', 2)], () => true);
  assert.deepEqual(illustrated.map(({layout}) => layout), ['image-right', 'image-right', 'image-left']);
});

test('unavailable or invalid optional visuals leave a usable editable slide', () => {
  const input = lessonSlideSchema.parse({
    ...draft, table: { headers: ['Өлшем'], rows: [] },
    chart: { categories: ['Бірінші', 'Екінші'], series: [{ name: 'Көлем', values: [25] }], alt: 'Өлшеу' },
  });
  assert.deepEqual(composeDraft(item('data-chart'), input), { ...draft, layout: 'body' });
  assert.deepEqual(composeDraft(item('image-left'), draft), { ...draft, layout: 'body' });
  assert.deepEqual(composeDraft(item('image-grid'), draft, image), { ...draft, layout: 'image-right', image });
});

test('the slide compositor preserves validated data and reflows dense copy intact', () => {
  const table = { headers: ['Өлшем', 'Көлем'], rows: [['Бірінші', 25], ['Екінші', 30]] };
  const chart = { categories: ['Бірінші', 'Екінші'], series: [{ name: 'Көлем', values: [25, 30] }], alt: '25 және 30 мл' };
  assert.deepEqual(composeDraft(item('data-chart'), { ...draft, chart, table }), { ...draft, chart, layout: 'data-chart' });
  assert.deepEqual(composeDraft(item('native-table'), { ...draft, chart, table }), { ...draft, table, layout: 'native-table' });
  const long = { ...draft, body: 'Берілген өлшемді анықтаңыз. '.repeat(14).trim() };
  assert.deepEqual(composeDraft(item('quote'), long), { ...long, layout: 'stacked' });
  assert.deepEqual(composeDraft(item('image-full'), long, image), { ...long, layout: 'split', image });
});

test('automatic generation reserves one appropriate full-frame image and respects the media constraint', () => {
  const original = [item('cover'), { ...item('image-left',1), visualDescription: 'Clear glass containers on a bench' },
    { ...item('image-right',2), visualDescription: 'A teacher reading a meniscus' }, item('quote',3)];
  assert.deepEqual(planOutlineLayouts(original, () => true).map(slide=>slide.layout), ['cover','image-full','image-right','quote']);
  assert.deepEqual(planOutlineLayouts(original, () => true, false).map(slide=>slide.layout), ['cover','image-left','image-right','quote']);
  assert.deepEqual(planOutlineLayouts(original, () => false).map(slide=>slide.layout), ['cover','body','body','quote']);
});

test('full-bleed art is reserved for compact section breaks and dense projected copy keeps a separate visual', () => {
  const visualDescription = 'A clear portrait of a laboratory setup';
  const original: OutlineItem[] = [
    { ...item('cover'), role:'opening', section:'Investigation' },
    { ...item('image-left',1), role:'examples', section:'Investigation', visualDescription },
    { ...item('image-right',2), role:'opening', section:'Observations', visualDescription,
      summary:'Compare the method, read the measurements and explain how differences in the original data relate to the starting volumes and the final result.' },
    { ...item('image-right',3), role:'opening', section:'Results', visualDescription },
  ];
  assert.deepEqual(planOutlineLayouts(original, () => true).map(slide => slide.layout),
    ['cover','image-left','image-right','image-full']);
  assert.equal(original[3].layout,'image-right');
  assert.equal(composeDraft(item('image-full'),draft,image).layout,'image-full');
  const title = 'Жаңа тәжірибедегі өлшем көрсеткіштері мен нәтижелер арасындағы айырмашылықтарды деректер бойынша талдау';
  assert.deepEqual(composeDraft(item('image-full'),{...draft,title},image),{...draft,title,layout:'split',image});
  const body = 'Бақылау жасаңыз.\nНәтижені жазыңыз.\nҚорытындыны түсіндіріңіз.';
  assert.deepEqual(composeDraft(item('image-full'),{...draft,body},image),{...draft,body,layout:'split',image});
});

test('explicit numeric chart requests and conclusions keep a dedicated layout', () => {
  const original = [item('cover'), item('split',1),
    { ...item('centered',2), title:'Тәжірибе қорытындысы' },
    { ...item('centered',3), title:'Өз қорытындыңызды айтыңыз', assessment:true }];
  const topic = 'Бірінші ыдыста 12 мл, екінші ыдыста 27 мл. Екі мәнді бағандық диаграммада салыстырыңыз.';
  const final = planOutlineLayouts(retainRequestedChart(original,topic), () => false);
  assert.deepEqual(final.map(slide=>slide.layout), ['cover','data-chart','quote','centered']);
  assert.equal(retainRequestedChart(original,'Compare 12 and 27 in a worksheet without a bar chart.'),original);
  assert.equal(retainRequestedChart(original,'Compare amounts in a bar chart with 12 samples.'),original);
});

test('layout-specific slots accept numeric charts or art and preserve surplus cards in notes', () => {
  const chart = { categories:['Бірінші','Екінші'], series:[{ name:'Су көлемі', values:[12,27] }], alt:'12 және 27 мл' };
  const cards = [{ title:'Бақылау',text:'Көлемдерді салыстырыңыз.' }];
  const imageDraft = { ...draft, illustration:{prompt:'Two laboratory containers',alt:'Қос ыдыс'},chart,cards };
  const imageSlots = slideComposition('image-full',true).schema.parse(imageDraft);
  assert.deepEqual(imageSlots,{...draft,illustration:imageDraft.illustration});
  const numericSlots = slideComposition('data-chart',true).schema.parse(imageDraft);
  assert.deepEqual(numericSlots,{...draft,chart});
  const composed = composeDraft(item('stacked'),{...draft,chart,cards});
  assert.equal(composed.layout,'data-chart');
  assert.deepEqual(composed.chart,chart);
  assert.equal(composed.design?.cards,undefined);
  assert.equal(composed.notes,`${draft.notes}\n\n${cards[0].title}\n${cards[0].text}`);
});
