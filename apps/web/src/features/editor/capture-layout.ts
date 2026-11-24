import { effectiveFreeLayout, fitFreeBox, freeElements, freeImageIds, isFreeImageId, type FreeId } from '@sabaq/lesson/free-layout';
import type { Slide } from '@sabaq/lesson/types';

const selectors:Partial<Record<FreeId,string>>={
  title:'.ed-slide-title',body:'.ed-slide-body',eyebrow:'.ed-story-eyebrow,.ed-slide-kicker',takeaway:'.ed-story-takeaway,.ed-arranged-end > p,.ed-native-takeaway',
  answer:'.ed-slide-answer',image:'.ed-slide-background,.ed-slide-image-frame,.ed-story-art,.ed-imported-page',diagram:'.ed-diagram',table:'.ed-slide-table',chart:'.ed-slide-chart',
};
const cardSelector = '.ed-story-card,.ed-arranged-cards li';

export function canvasPlacementElement(slide:Slide,root:HTMLElement,target:Element):FreeId|undefined {
  if (!root.contains(target)) return;
  const elements = freeElements(slide);
  const closest = (selector:string) => {
    const hit = target.closest<HTMLElement>(selector);
    return hit && root.contains(hit) ? hit : undefined;
  };
  const placedId = closest('[data-free-id]')?.dataset.freeId;
  if (placedId) return elements.find(id=>id===placedId);
  const imageId = closest('[data-slide-image]')?.dataset.slideImage;
  if (imageId) return elements.find(id=>id===imageId);
  const card = closest(cardSelector);
  if (card) {
    const index = Array.from(root.querySelectorAll(cardSelector)).indexOf(card);
    return elements.find(id=>id===`card-${index}`);
  }
  const hit = elements.find(id=>selectors[id] && closest(selectors[id]));
  if (hit === 'image' && root.querySelector('.ed-slide-image-grid')) return;
  if (hit) return hit;
  // The adaptive backdrop is below the text column in the stacking order.
  if (!slide.freeLayout && elements.includes('image') && root.querySelector('.ed-slide-background')) return 'image';
}

export function captureLayout(slide:Slide,root?:HTMLElement|null) {
  const layout=effectiveFreeLayout(slide);
  if(slide.freeLayout || !root) return layout;
  const bounds=root.getBoundingClientRect();
  if(!bounds.width || !bounds.height) return layout;
  const cards=root.querySelectorAll(cardSelector);
  const grid=root.querySelector('.ed-slide-image-grid');
  const pictures=grid?.querySelectorAll('.ed-slide-image');
  // Capture the photo as a background layer before adding the selectable text above it.
  const hasBackdrop=!!root.querySelector('.ed-slide-background');
  const items=hasBackdrop ? [...layout.items.filter(item=>item.id==='image'),...layout.items.filter(item=>item.id!=='image')] : layout.items;
  return {items:items.map(item=>{
    const selector=selectors[item.id];
    const gridPicture=grid && isFreeImageId(item.id)
      ? grid.querySelector(`[data-slide-image="${item.id}"]`) ?? pictures?.[freeImageIds.indexOf(item.id)]
      : undefined;
    const element=gridPicture ?? (selector ? root.querySelector(selector) : cards[Number(item.id.slice(-1))]);
    const r=element?.getBoundingClientRect();
    if(!r || !r.width || !r.height) return item;
    return fitFreeBox({...item,x:100*(r.left-bounds.left)/bounds.width,y:100*(r.top-bounds.top)/bounds.height,
      w:100*r.width/bounds.width,h:100*r.height/bounds.height});
  })};
}
