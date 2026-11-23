import 'tailwindcss/preflight.css';
import {lessonPalette} from '@sabaq/lesson/themes';
import './fonts.css';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { inspectQuality, measureQuality } from './measure-quality';
import { SlideCanvas } from './Slide';
import {VideoSlide} from './VideoSlide';
import type { RenderSnapshot } from './runtime';
import './export-view.css';

window.measureLessonQuality = measureQuality;
window.inspectLessonQuality = () => inspectQuality(true);
window.renderLessonExport = async (deck: RenderSnapshot) => {
  document.documentElement.lang = deck.language;
  document.title = deck.title;
  const root = createRoot(document.getElementById('root')!);
  flushSync(() => root.render(deck.slides.map(slide => (
    <section className="export-page" key={slide.id} data-video={deck.video?.aspect ?? (deck.video ? '16:9' : undefined)}
      data-captions={deck.video?.captions || undefined} data-avatar={deck.video?.position!=='none' && deck.video?.position || undefined}
      style={deck.video ? {backgroundColor:lessonPalette(deck).paper} : undefined}>
      {deck.video ? <VideoSlide includeChartData deck={deck} slide={slide} settings={deck.video} revealAnswer={false}/> :
        <SlideCanvas includeChartData deck={deck} slide={slide} revealAnswer={deck.revealAnswer ?? false}/>}
    </section>
  ))));
  await Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};


window.prepareVideoSteps=()=>{
  const root=document.querySelector('.ed-slide')!;
  const candidates=Array.from(root.querySelectorAll<HTMLElement>('.ed-slide-body .ed-text-line, .ed-slide-body li, .ed-story-card, .ed-arranged-cards > li, .ed-free-element[data-free-id="image"], .ed-free-card, .ed-slide-image-frame, .ed-story-art, .ed-slide-chart, .ed-slide-table, .ed-diagram, .ed-story-takeaway'));
  const elements=candidates.filter(element=>!candidates.some(parent=>parent!==element && parent.contains(element)));
  elements.forEach((element,index)=>{element.dataset.videoStep=String(index);});
  return elements.length;
};
window.showVideoStep=visible=>{
  for(const element of document.querySelectorAll<HTMLElement>('[data-video-step]'))
    element.style.visibility=Number(element.dataset.videoStep)<visible?'visible':'hidden';
};
