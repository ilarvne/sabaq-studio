export type ImageCrop = { x:number; y:number; zoom:number; radius:number; aspect:'original'|'wide'|'square'|'portrait' };
export const defaultImageCrop:ImageCrop = {x:50,y:50,zoom:1,radius:0,aspect:'original'};

export function cropRectangle(width:number,height:number,crop:ImageCrop) {
  const ratio = {original:width/height,wide:16/9,square:1,portrait:3/4}[crop.aspect];
  const w = Math.min(width,Math.max(1,Math.round(Math.min(width,height*ratio)/crop.zoom)));
  const h = Math.min(height,Math.max(1,Math.round(w/ratio)));
  return {width:w,height:h,left:Math.max(0,Math.min(width-w,Math.round(width*crop.x/100-w/2))),
    top:Math.max(0,Math.min(height-h,Math.round(height*crop.y/100-h/2)))};
}
