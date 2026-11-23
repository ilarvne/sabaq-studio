import { effectiveFreeLayout, fitFreeBox, type FreeId } from '@sabaq/lesson/free-layout';
import type { Slide } from '@sabaq/lesson/types';

const selectors:Partial<Record<FreeId,string>>={
  title:'.ed-slide-title',body:'.ed-slide-body',eyebrow:'.ed-story-eyebrow,.ed-slide-kicker',takeaway:'.ed-story-takeaway,.ed-arranged-end > p,.ed-native-takeaway',
  answer:'.ed-slide-answer',image:'.ed-slide-background,.ed-slide-image-frame,.ed-story-art,.ed-imported-page',diagram:'.ed-diagram',table:'.ed-slide-table',chart:'.ed-slide-chart',
};

export function captureLayout(slide:Slide,root?:HTMLElement|null) {
  const layout=effectiveFreeLayout(slide);
  if(slide.freeLayout || !root) return layout;
  const bounds=root.getBoundingClientRect();
  if(!bounds.width || !bounds.height) return layout;
  const cards=root.querySelectorAll('.ed-story-card,.ed-arranged-cards li');
  // Capture the photo as a background layer before adding the selectable text above it.
  const hasBackdrop=!!root.querySelector('.ed-slide-background');
  const items=hasBackdrop ? [...layout.items.filter(item=>item.id==='image'),...layout.items.filter(item=>item.id!=='image')] : layout.items;
  return {items:items.map(item=>{
    const selector=selectors[item.id];
    const element=selector ? root.querySelector(selector) : cards[Number(item.id.slice(-1))];
    const r=element?.getBoundingClientRect();
    if(!r || !r.width || !r.height) return item;
    return fitFreeBox({...item,x:100*(r.left-bounds.left)/bounds.width,y:100*(r.top-bounds.top)/bounds.height,
      w:100*r.width/bounds.width,h:100*r.height/bounds.height});
  })};
}
