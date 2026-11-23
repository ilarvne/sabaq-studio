import { requireSuitable } from '../authoring/moderation';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { crc32, inflate } from 'node:zlib';
import sharp from 'sharp';
import { z } from 'zod';
import type { Deck, ImageReview, Locale, SlideImage } from '@sabaq/lesson/types';
import { illustrationPrompt, imageReviewer, ImageReviewError, type SceneConstraints } from './image-review';
import { readBounded } from './bounded-response';
import { allowedProviderEndpoint } from '../access/provider-origins';

import { illustrationDescriptions as catalog, imageRequestSchema, type ImageRequest } from '@sabaq/contracts/illustrations';
export { catalogDescription, illustrationCatalog, imageRequestSchema, type ImageRequest } from '@sabaq/contracts/illustrations';
type AssetId = keyof typeof catalog;
type Context = { language: Locale; signal: AbortSignal; mediaRoot: string; topic?:string; allowOpenAI?:boolean; avoidCatalog?:boolean }
  & Pick<SceneConstraints,'style'|'darkPaper'>;

const imageLimit = 8 * 1024 * 1024;
const encodedLimit = Math.ceil(imageLimit / 3) * 4;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const decompress = promisify(inflate);
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const generatedImageName = /^[0-9a-f]{64}\.png$/;

const openAIImageEndpoint = 'https://api.openai.com/v1/images/generations';
const openAIImageModel = 'gpt-image-2.6-flare';
type ImageProvider = { url:URL; model?:string; key?:string; openAI:boolean };

function imageProvider(allowOpenAI = true):ImageProvider|undefined {
  const explicit = process.env.STUDIO_IMAGE_ENDPOINT?.trim();
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  const endpoint = explicit || (openAIKey && openAIImageEndpoint);
  if (!endpoint || !allowedProviderEndpoint(endpoint)) return;
  const url = new URL(endpoint);
  const model = process.env.STUDIO_IMAGE_MODEL?.trim() || undefined;
  const workerKey = process.env.STUDIO_IMAGE_API_KEY?.trim() || undefined;
  if (url.hostname === 'api.openai.com' || url.hostname.endsWith('.api.openai.com')) {
    if (!allowOpenAI || process.env.STUDIO_AUTH_MODE === 'gateway' || url.href !== openAIImageEndpoint) return;
    const key = (explicit && workerKey) || openAIKey;
    if (key) return {url,key,model:model || openAIImageModel,openAI:true};
    return;
  }
  return {url,model,key:workerKey,openAI:false};
}

export function hasImageProvider(allowOpenAI = true) {
  return Boolean(imageProvider(allowOpenAI));
}

/** Explicit AI image selection uses an installed worker or an origin approved for this deployment. */
export function hasApprovedImageProvider() {
  const provider=imageProvider(false);
  if(!provider) return false;
  const {hostname,origin,protocol}=provider.url;
  return ['127.0.0.1','[::1]','localhost'].includes(hostname) || protocol==='https:' &&
    (process.env.STUDIO_KZ_PROVIDER_ORIGINS ?? '').split(',').some(entry=>entry.trim()===origin);
}

export const allowsOpenAIImages = (deck: Pick<Deck,'provider'|'source'>) => deck.provider !== 'local' && !deck.source;

export function hasLessonImageProvider(deck: Pick<Deck,'provider'|'source'>) {
  return allowsOpenAIImages(deck) ? hasImageProvider() : hasApprovedImageProvider();
}

function generationBody(provider:ImageProvider,n:1|4,prompt:string,fullResolution=false) {
  return JSON.stringify({
    ...(provider.model && {model:provider.model}),
    n,
    size:fullResolution ? provider.openAI ? '1920x1088' : '1920x1080' : provider.openAI ? '1536x864' : '1536x1024',
    ...(provider.openAI ? {output_format:'png',quality:'medium'} : {response_format:'b64_json'}),
    prompt,
  });
}

export class ImageProviderError extends Error {
  constructor(readonly status:number,message:string,readonly code?:'image_provider_key'|'image_provider_quota') { super(message); }
}

async function providerFailure(response:Response,openAI:boolean):Promise<never> {
  if (!openAI) {
    await response.body?.cancel();
    throw new ImageProviderError(response.status===429 ? 429 : 502,'The illustration worker could not complete this request.');
  }
  const raw=await readBounded(response,8192).catch(()=>undefined);
  let code: string|undefined;
  try { code=raw && JSON.parse(raw.toString()).error?.code; } catch { /* The provider may return an HTML error page. */ }
  if (response.status===429) {
    if (code==='insufficient_quota' || code==='billing_hard_limit_reached') {
      throw new ImageProviderError(503,'The OpenAI project needs available image-generation quota.','image_provider_quota');
    }
    throw new ImageProviderError(429,'OpenAI image generation is busy. Try again shortly.');
  }
  if (response.status===401 || response.status===403 || response.status===404) {
    throw new ImageProviderError(503,'Check the OpenAI project key and its access to the configured image model.','image_provider_key');
  }
  if (code==='moderation_blocked' || code==='content_policy_violation' || code==='safety_violations') {
    throw new ImageProviderError(422,'The image description did not pass the provider’s content checks.');
  }
  throw new ImageProviderError(502,'OpenAI did not return a usable image.');
}

// Validate the raster before publishing. Inference workers return ordinary
// non-interlaced, 8-bit PNGs. Other encodings can be converted by the worker.
async function validPng(image: Buffer) {
  if (image.length < 57 || image.length > imageLimit || !image.subarray(0, 8).equals(pngSignature))
    return false;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed: Buffer[] = [];
  let position = 8;
  let chunks = 0;
  while (position + 12 <= image.length) {
    const length = image.readUInt32BE(position);
    const start = position + 8;
    const end = start + length;
    if (end + 4 > image.length || ++chunks > 2048) return false;
    const kind = image.toString('ascii', position + 4, start);
    if (crc32(image.subarray(position + 4, end)) !== image.readUInt32BE(end)) return false;
    if (position === 8 && kind !== 'IHDR') return false;
    if (kind === 'IHDR') {
      if (position !== 8 || length !== 13) return false;
      width = image.readUInt32BE(start);
      height = image.readUInt32BE(start + 4);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[image[start + 9]];
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 4_194_304 ||
        !channels ||
        image[start + 8] !== 8 ||
        image[start + 10] ||
        image[start + 11] ||
        image[start + 12]
      )
        return false;
    } else if (kind === 'IDAT') {
      compressed.push(image.subarray(start, end));
    } else if (kind === 'IEND') {
      if (length || end + 4 !== image.length || !compressed.length) return false;
      const stride = width * channels + 1;
      const expected = stride * height;
      const pixels = await decompress(Buffer.concat(compressed), { maxOutputLength: expected });
      if (pixels.length !== expected) return false;
      for (let i = 0; i < expected; i += stride) if (pixels[i] > 4) return false;
      return true;
    } else if (kind !== 'PLTE' && (image[position + 4] & 0x20) === 0) {
      return false;
    }
    position = end + 4;
  }
  return false;
}

async function receivePng(response: Response) {
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || (mime !== 'image/png' && mime !== 'application/json')) {
    await response.body?.cancel();
    return;
  }
  const raw = await readBounded(response, mime === 'image/png' ? imageLimit : encodedLimit + 4096);
  if (!raw) return;
  let image = raw;
  if (mime === 'application/json') {
    const item = JSON.parse(raw.toString('utf8'))?.data?.[0];
    const value = item?.b64_json;
    if (
      item?.url ||
      typeof value !== 'string' ||
      value.length > encodedLimit ||
      value.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      return;
    image = Buffer.from(value, 'base64');
  }
  if (await validPng(image)) return image;
}

async function hasWhiteBackground(image:Buffer) {
  const size=48,edge=5;
  const pixels=await sharp(image).resize(size,size,{fit:'fill'}).ensureAlpha().raw().toBuffer();
  let white=0, samples=0;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    if(x>=edge && x<size-edge && y>=edge && y<size-edge) continue;
    const offset=(y*size+x)*4;
    samples++;
    if(pixels[offset]>=245 && pixels[offset+1]>=245 && pixels[offset+2]>=245 && pixels[offset+3]>=245) white++;
  }
  return white/samples>=.8;
}

const fsCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

// A reader can only see a complete file. A concurrent writer either publishes
// first or reuses the winner; cancellation never removes another caller's file.
async function publish(destination: string, data: Buffer | string, signal: AbortSignal, replace = false) {
  const temporary = destination + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600, signal });
    signal.throwIfAborted();
    if (replace) await rename(temporary, destination);
    else {
      try {
        await link(temporary, destination);
      } catch (err) {
        if (fsCode(err) !== 'EEXIST') throw err;
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function cachedName(index: string, mediaRoot: string) {
  try {
    const name = (await readFile(index, 'utf8')).trim();
    if (generatedImageName.test(name) && (await stat(join(mediaRoot, name))).isFile()) return name;
  } catch (err) {
    if (fsCode(err) !== 'ENOENT') throw err;
  }
}

type SelectedImage = { name:string; review?:ImageReview };
type SharedJob = { controller: AbortController; result: Promise<SelectedImage | undefined>; readers: number };
const pending = new Map<string, SharedJob>();

// Concurrent identical requests share inference. Each slide cancels its own
// subscription; stop the worker only after the final subscriber leaves.
async function sharedGeneration(
  index: string,
  signal: AbortSignal,
  produce: (signal: AbortSignal) => Promise<SelectedImage | undefined>,
) {
  signal.throwIfAborted();
  let job = pending.get(index);
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController();
    const created: SharedJob = {
      readers: 0,
      controller,
      result: produce(AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])).finally(() => {
        if (pending.get(index) === created) pending.delete(index);
      }),
    };
    pending.set(index, created);
    job = created;
  }
  job.readers++;
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([job.result, cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (--job.readers === 0) job.controller.abort();
  }
}

/** Returns an owned media path. Provider URLs and catalog paths supplied by a model are never fetched. */
export async function resolveSlideIllustration(
  request: ImageRequest | undefined,
  context: Context,
): Promise<SlideImage | undefined> {
  const { language, signal, mediaRoot } = context;
  signal.throwIfAborted();
  const result = imageRequestSchema.safeParse(request);
  if (!result.success) return;
  const { asset, place, period } = result.data;
  if (asset && !context.avoidCatalog)
    return {
      src: '/assets/' + asset + '.webp',
      alt: catalog[asset][language],
      provenance: { source: 'catalog', asset },
    };

  const fallback=asset && catalog[asset][language];
  const prompt=result.data.prompt ?? fallback;
  const alt=result.data.alt ?? fallback;
  const provider = imageProvider(context.allowOpenAI);
  if (!prompt || !alt || !provider) return;
  const {url,model,key} = provider;
  const constraints:SceneConstraints = {scene:prompt,topic:context.topic,place,period,style:context.style,darkPaper:context.darkPaper};
  await requireSuitable({...constraints,alt},language,'image',signal);
  const image = ({name,review}: SelectedImage): SlideImage => ({
    src: '/api/media/' + name,
    alt,
    provenance: { source: 'generated', ...(model && { model }), ...(review && {review}) },
  });
  try {
    const body = generationBody(provider,1,illustrationPrompt(constraints));
    const cacheDirectory = join(mediaRoot, '.requests');
    const index = join(cacheDirectory, digest(JSON.stringify([url.href, body])));
    const policy = JSON.stringify([process.env.STUDIO_IMAGE_VERIFY_MODEL,process.env.STUDIO_AUTH_MODE,process.env.STUDIO_OLLAMA_URL]);
    const selected = await sharedGeneration(index+policy, signal, async (deadline) => {
      const reviewer = await imageReviewer(url,deadline);
      const found = await cachedName(index, mediaRoot);
      deadline.throwIfAborted();
      if (found) {
        if (!reviewer && !constraints.darkPaper) return {name:found};
        const bytes = await readFile(join(mediaRoot,found));
        if (digest(bytes)+'.png'!==found || !await validPng(bytes)) return;
        if (!constraints.darkPaper || !await hasWhiteBackground(bytes)) {
          if (!reviewer) return {name:found};
          const review = await reviewer.inspect(bytes,constraints,deadline);
          return review ? {name:found,review} : undefined;
        }
      }
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: deadline,
        body,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, image/png',
          ...(key && { Authorization: 'Bearer ' + key }),
        },
      });
      const raster = await receivePng(response);
      if (!raster) return;
      if (constraints.darkPaper && await hasWhiteBackground(raster)) return;
      const review = await reviewer?.inspect(raster,constraints,deadline);
      if (reviewer && !review) return;
      deadline.throwIfAborted();
      const name = digest(raster) + '.png';
      await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
      await publish(join(mediaRoot, name), raster, deadline);
      await publish(index, name, deadline, true);
      return {name,review};
    });
    signal.throwIfAborted();
    if (selected) return image(selected);
  } catch {
    // Optional visual failure falls back to the authored semantic layout.
    // A cancelled lesson must still unwind its generation job.
    signal.throwIfAborted();
  }
}

/** Publish a complete PNG before returning its content-addressed media URL. */
export async function storeImage(bytes:Buffer,mediaRoot:string,signal:AbortSignal) {
  await mkdir(mediaRoot,{recursive:true});
  const name = digest(bytes)+'.png';
  await publish(join(mediaRoot,name),bytes,signal);
  return '/api/media/'+name;
}

/** Request full-resolution editor images in a single inference request. */
export async function generateImageChoices(prompt:string,alt:string,context:Context,setting:Pick<SceneConstraints,'place'|'period'>={},count:1|4=4):Promise<SlideImage[]> {
  const provider = imageProvider(context.allowOpenAI);
  if (!provider) throw new Error('Image worker unavailable.');
  const {url,model,key,openAI} = provider;
  const signal = AbortSignal.any([context.signal,AbortSignal.timeout(240000)]);
  const constraints:SceneConstraints = {scene:prompt,topic:context.topic,...setting,style:context.style,darkPaper:context.darkPaper};
  await requireSuitable({...constraints,alt},context.language,'image',signal);
  const reviewer = await imageReviewer(url,signal);
  const direction = count===4 ? 'Show the same lesson subject in distinct compositions. Show one complete scene in each image. ' : '';
  const response = await fetch(url,{method:'POST',redirect:'error',signal,
    headers:{'Content-Type':'application/json',Accept:'application/json',...(key && {Authorization:'Bearer '+key})},
    body:generationBody(provider,count,direction+illustrationPrompt(constraints),true)});
  if (!response.ok) return providerFailure(response,openAI);
  if (!response.headers.get('content-type')?.startsWith('application/json')) {await response.body?.cancel();throw new Error('The worker did not return image data.');}
  const raw = await readBounded(response,count*encodedLimit+8192);
  if (!raw) throw new Error('Image batch size limit exceeded.');
  const batch = z.object({data:z.array(z.object({b64_json:z.string().min(4).max(encodedLimit).regex(/^[A-Za-z0-9+/]+={0,2}$/),url:z.never().optional()})).length(count)}).parse(JSON.parse(raw.toString()));
  const images:Buffer[]=[];
  for (const entry of batch.data) {
    const data=Buffer.from(entry.b64_json,'base64');
    if (!(await validPng(data)) || data.readUInt32BE(16)!==1920 || data.readUInt32BE(20)!==(openAI ? 1088 : 1080)) throw new Error('Invalid full-resolution variant.');
    // OpenAI requires dimensions divisible by 16. Crop the outer rows without resampling.
    const fitted = openAI ? await sharp(data).extract({left:0,top:4,width:1920,height:1080}).png().toBuffer() : data;
    images.push(fitted);
  }
  if (new Set(images.map(image=>digest(image))).size!==count) throw new Error('The image worker returned duplicate choices.');
  const results:SlideImage[]=[];
  for (const image of images) {
    if (constraints.darkPaper && await hasWhiteBackground(image)) continue;
    const review = await reviewer?.inspect(image,constraints,signal);
    if (reviewer && !review) continue;
    results.push({src:await storeImage(image,context.mediaRoot,signal),alt,provenance:{source:'generated',...(model && {model}),...(review && {review})}});
  }
  if (!results.length) throw new ImageReviewError(422);
  return results;
}
