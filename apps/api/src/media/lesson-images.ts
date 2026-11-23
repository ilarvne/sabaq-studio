import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import katex from 'katex';
import { cropRectangle, type ImageCrop } from '@sabaq/lesson/image-crop';
import { lessonImageGuidance } from '@sabaq/lesson/image-style';
import type { SlideImage } from '@sabaq/lesson/types';
import type { StudioAccess } from '../access/access';
import { imagePath, type MediaRoots } from './powerpoint';
import { imageCropInput, slideSymbolInput } from '@sabaq/contracts/schema';
import { imageSettingSchema } from '@sabaq/contracts/illustrations';
import { ApiError } from '../errors';
import type { Studio } from '../lessons/studio';
import { allowsOpenAIImages, generateImageChoices, hasLessonImageProvider, illustrationCatalog, ImageProviderError, storeImage } from './visuals';
import { ImageReviewError } from './image-review';
import { pictogramPaths } from './pictograms';
import { renderFormulaPng } from './render-export';

const uploadLimit = 10_000_000;
const inputOptions = {limitInputPixels:16_000_000,failOn:'warning' as const};

export async function normalizeLessonImage(body:Buffer,root:string,signal:AbortSignal) {
  if (!body.length || body.length>uploadLimit) throw new ApiError(body.length ? 413 : 400,'Choose an image up to 10 MB.');
  let normalized:Buffer;
  try {
    const input=sharp(body,inputOptions);
    const metadata=await input.metadata();
    if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages ?? 1)>1) throw Error();
    normalized=await input.autoOrient().png().toBuffer();
  } catch {throw new ApiError(415,'Choose a single PNG, JPEG or WebP with at most 16 million pixels.');}
  const src=await storeImage(normalized,root,signal);
  return {src,alt:'',provenance:{source:'upload'} as const};
}

export async function cropLessonImage(src:string,crop:ImageCrop,roots:MediaRoots,signal:AbortSignal) {
  const path=imagePath(src,roots);
  if (!path) throw new ApiError(400,'Choose a studio image.');
  const bytes=await readFile(path).catch(()=>{throw new ApiError(404,'Image not found.');});
  const {width,height}=await sharp(bytes,inputOptions).metadata();
  const rect=cropRectangle(width,height,crop);
  const radius=Math.round(Math.min(rect.width,rect.height)*crop.radius/100);
  // Extract first so the rounded mask uses cropped coordinates.
  const image=sharp(bytes,inputOptions).extract(rect).ensureAlpha();
  if (radius) image.composite([{input:Buffer.from(`<svg width="${rect.width}" height="${rect.height}"><rect width="100%" height="100%" rx="${radius}" fill="white"/></svg>`),blend:'dest-in'}]);
  const rendered=await image.png().toBuffer();
  return {src:await storeImage(rendered,roots.generated,signal),originalSrc:src,crop};
}

export function checkImagePath(req:FastifyRequest,access:StudioAccess,src:string) {
  if (/^\/api\/media\/[0-9a-f]{64}\.png$/u.test(src)) return access.media(req,src);
  if (!illustrationCatalog.some(asset=>src === '/assets/'+asset.id+'.webp')) throw new ApiError(400,'Choose a studio image.');
}

export function registerLessonImages(app:FastifyInstance,studio:Studio,access:StudioAccess,roots:MediaRoots) {
  app.register(async plugin=>{
    plugin.addContentTypeParser('application/octet-stream',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
    let running=0;
    type Route={Params:{id:string}};
    async function produce<T extends {src:string}>(req:FastifyRequest,deckId:string,work:(signal:AbortSignal)=>Promise<T[]>) {
      studio.deck(deckId);
      if (running>=2) throw new ApiError(429,'The image worker is busy. Try again shortly.');
      running++;
      const controller=new AbortController();
      const socket=req.raw.socket;
      const closed=()=>controller.abort();
      socket.once('close',closed);
      try {
        const assets=await work(controller.signal);
        controller.signal.throwIfAborted();
        access.require(req,deckId,'write');
        studio.store.transaction(()=>{
          const insert=studio.store.db.prepare('INSERT OR IGNORE INTO lesson_image_assets(deck_id,src) VALUES(?,?)');
          for (const asset of assets) insert.run(deckId,asset.src);
        });
        return assets;
      } finally {socket.off('close',closed);running--;}
    }
    plugin.post<Route & {Body:Buffer}>('/api/decks/:id/images/upload',{bodyLimit:uploadLimit},async(req,reply)=>{
      if (!Buffer.isBuffer(req.body)) throw new ApiError(415,'Upload a binary image.');
      const [asset]=await produce(req,req.params.id,async signal=>[await normalizeLessonImage(req.body,roots.generated,signal)]);
      return reply.code(201).send(asset);
    });
    plugin.post<Route>('/api/decks/:id/images/crop',async req=>{
      const {src,crop}=z.object({src:z.string().max(200),crop:imageCropInput}).parse(req.body);
      checkImagePath(req,access,src);
      const [image]=await produce(req,req.params.id,async signal=>[await cropLessonImage(src,crop,roots,signal)]);
      return image;
    });
    plugin.post<Route>('/api/decks/:id/images/symbol',async(req,reply)=>{
      const {alt,...provenance}=slideSymbolInput.parse(req.body);
      const [asset]=await produce<SlideImage>(req,req.params.id,async signal=>{
        let png:Buffer|undefined;
        if(provenance.source==='formula') {
          let mathml:string;
          try {
            mathml=katex.renderToString(provenance.latex,{
              output:'mathml',displayMode:true,trust:false,strict:'ignore',maxSize:12,maxExpand:100,
            });
          } catch {throw new ApiError(400,'Check the LaTeX expression.');}
          png=await renderFormulaPng(mathml,signal);
        } else {
          const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="-28 -28 312 312">
            <rect x="-28" y="-28" width="312" height="312" fill="#fff"/>
            <path d="${pictogramPaths[provenance.icon]}" fill="#172532"/>
          </svg>`;
          png=await sharp(Buffer.from(svg)).png().toBuffer();
        }
        if(!png) throw new ApiError(422,'Split the expression into shorter formulas.');
        const src=await storeImage(png,roots.generated,signal);
        return [{src,alt,provenance}];
      });
      return reply.code(201).send(asset);
    });
    plugin.get<Route>('/api/decks/:id/images/capabilities',async req=>({
      generate:hasLessonImageProvider(studio.deck(req.params.id)),
    }));
    plugin.post<Route>('/api/decks/:id/images/variants',async(req,reply)=>{
      const {prompt,alt,place,period,slideId,count}=imageSettingSchema.extend({
        prompt:z.string().trim().min(1).max(1600),alt:z.string().trim().min(1).max(400),slideId:z.string().min(1).max(160).optional(),
        count:z.union([z.literal(1),z.literal(4)]).default(4),
      }).parse(req.body);
      const deck=studio.deck(req.params.id);
      const slide=slideId && deck.slides.find(item=>item.id===slideId);
      if (slideId && !slide) throw new ApiError(404,'Slide not found.');
      const topic=slide ? deck.topic+' — '+slide.title : deck.topic;
      const allowOpenAI=allowsOpenAIImages(deck);
      if (!hasLessonImageProvider(deck)) throw new ApiError(503,'This lesson has no available illustration provider.');
      try {
        return await produce<SlideImage>(req,req.params.id,signal=>generateImageChoices(
          prompt,alt,{language:deck.language,topic,signal,mediaRoot:roots.generated,allowOpenAI,...lessonImageGuidance(deck)},{place,period},count,
        ));
      } catch (error) {
        if (error instanceof ImageProviderError) return reply.code(error.status).send({message:error.message,code:error.code});
        if (error instanceof ImageReviewError) throw new ApiError(error.status,error.message);
        if (error instanceof Error && ('status' in error || error.name==='AbortError')) throw error;
        throw new ApiError(502,'The image worker could not provide the requested 1920 × 1080 PNGs.');
      }
    });
  });
}
