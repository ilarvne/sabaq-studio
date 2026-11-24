import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import {videoSizes,type VideoSettings} from '@sabaq/contracts/video';
import type { RendererManifest } from '@sabaq/slide-renderer/runtime';
import { slideImages, type Deck } from '@sabaq/lesson/types';
import { imagePath, type MediaRoots } from './powerpoint';
import { checkSlideContrast } from './slide-contrast';

// These callbacks execute within Chromium, whose globals are declared by the renderer package.
declare const window: Window;

const renderOrigin = 'http://render.invalid';
const viewport = { width: 1920, height: 1080 };
const mime: Record<string, string> = {
  '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

async function loadRenderer() {
  const manifestPath = fileURLToPath(import.meta.resolve('@sabaq/slide-renderer/assets'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RendererManifest;
  const pathFor = (name: string) => '/renderer/' + name;
  const assets = new Map(await Promise.all(manifest.files.map(async name => {
    if (basename(name) !== name || !mime[extname(name)]) throw new Error('Invalid renderer asset name');
    return [pathFor(name), await readFile(join(dirname(manifestPath), name))] as const;
  })));
  const script = pathFor(manifest.script);
  const stylesheet = pathFor(manifest.stylesheet);
  if (!assets.has(script) || !assets.has(stylesheet)) throw new Error('Renderer bundle is incomplete');
  return { assets, script, stylesheet };
}
let renderer: ReturnType<typeof loadRenderer> | undefined;

// Every consumer shares this slot: exports, video scenes, translation fits and post-generation review.
let renderBusy = false;
const waiting = new Set<() => void>();
async function acquireRenderSlot(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (renderBusy) await new Promise<void>((resolve, reject) => {
    const next = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const cancel = () => { waiting.delete(next); reject(signal?.reason); };
    waiting.add(next);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  renderBusy = true;
}
function releaseRenderSlot() {
  const next = waiting.values().next().value;
  if (next) { waiting.delete(next); next(); }
  else renderBusy = false;
}

async function inRenderSlot<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<T> {
  await acquireRenderSlot(signal);
  try { return await run(); }
  finally { releaseRenderSlot(); }
}

function withRenderedSlides<T>(deck: Deck, roots: MediaRoots, revealAnswer: boolean, read: (page:Page)=>Promise<T>, signal?:AbortSignal,video?:VideoSettings) {
  return inRenderSlot(()=>renderInBrowser(deck,roots,revealAnswer,read,signal,video),signal);
}

async function withRenderPage<T>(size:typeof viewport,read:(page:Page)=>Promise<T>,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const executablePath = process.env.CHROMIUM_PATH || (existsSync(chromium.executablePath())
    ? chromium.executablePath() : existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, timeout: 15000 });
  const stop = ()=>{void browser.close().catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  const deadline = setTimeout(stop,45_000);
  try {
    signal?.throwIfAborted();
    const page = await browser.newPage({viewport:size,reducedMotion:'reduce',serviceWorkers:'block'});
    page.setDefaultTimeout(20000);
    return await read(page);
  } finally {
    signal?.removeEventListener('abort',stop);
    clearTimeout(deadline);
    await browser.close();
  }
}

async function renderInBrowser<T>(deck: Deck, roots: MediaRoots, revealAnswer: boolean, read: (page:Page)=>Promise<T>, signal?:AbortSignal,video?:VideoSettings): Promise<T> {
  signal?.throwIfAborted();
  renderer ??= loadRenderer().catch(error => { renderer = undefined; throw error; });
  const { assets, script, stylesheet } = await renderer;
  const images = new Map<string, string>();
  if (deck.brand?.logo) {
    const file=imagePath(deck.brand.logo,roots);
    if (!file) throw new Error('Unsupported brand logo');
    images.set(deck.brand.logo,file);
  }
  for (const slide of deck.slides) {
    for (const src of [...slideImages(slide).map(image=>image.src),slide.importedArtwork]) {
      if (!src) continue;
      const file=imagePath(src,roots);
      if (!file) throw new Error('Unsupported slide image');
      images.set(src,file);
    }
  }
  return withRenderPage(video ? videoSizes[video.aspect ?? '16:9'] : viewport,async page=>{
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== renderOrigin) return route.abort('blockedbyclient');
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
        `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${stylesheet}"><div id="root"></div><script src="${script}"></script>` });
      const asset = assets.get(url.pathname);
      if (asset) return route.fulfill({ contentType: mime[extname(url.pathname)], body: Buffer.from(asset) });
      const file = images.get(url.pathname);
      if (file) {
        try { return await route.fulfill({ contentType: mime[extname(file)], body: await readFile(file) }); }
        catch { return route.fulfill({ status: 404 }); }
      }
      return route.abort('blockedbyclient');
    });
    await page.goto(renderOrigin);
    const { title, language, theme, brand, powerPointStyle, slides } = deck;
    await page.evaluate(snapshot => window.renderLessonExport(snapshot), { title, language, theme, brand, powerPointStyle, slides, revealAnswer,video });
    return await read(page);
  },signal);
}

export function renderFormulaPng(mathml:string,signal:AbortSignal) {
  return inRenderSlot(()=>withRenderPage(viewport,async page=>{
    await page.route('**/*',route=>route.abort('blockedbyclient'));
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <style>body{margin:0} #formula{display:inline-block;color:#172532;background:#fff;font:96px math;padding:.24em .4em}</style>
      <div id="formula">${mathml}</div>`);
    await page.locator('html').evaluate(node=>node.ownerDocument.fonts.ready.then(()=>null));
    const formula=page.locator('#formula');
    const fits=await formula.evaluate(node=>{
      const {width,height}=node.getBoundingClientRect();
      const scale=Math.min(1,1720/width,960/height);
      if(scale<.25) return false;
      node.style.fontSize=96*scale+'px';
      return node.scrollWidth<=1721 && node.scrollHeight<=961;
    });
    if(!fits) return undefined;
    return formula.screenshot({type:'png',animations:'disabled'});
  },signal),signal);
}

export function renderSlideFile(deck: Deck, format: 'pdf' | 'png', roots: MediaRoots, signal?: AbortSignal): Promise<Buffer> {
  return withRenderedSlides(deck,roots,false,async page=>{
    if (format === 'png') return page.screenshot({ type: 'png', animations: 'disabled' });
    await page.emulateMedia({ media: 'screen' });
    return page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true });
  }, signal);
}

/** Measure the same fitted slide canvas that the teacher presents, including revealed answers. */
export function measureLessonOverflow(deck: Deck,roots: MediaRoots,signal?:AbortSignal): Promise<string[]> {
  return withRenderedSlides(deck,roots,true,page=>page.locator('.ed-slide[data-overflow="true"]').evaluateAll(
    slides=>slides.map(slide=>slide.getAttribute('data-slide-id')!),
  ),signal);
}

export function measureSlideQuality(deck: Deck, roots: MediaRoots, signal: AbortSignal) {
  return withRenderedSlides(deck, roots, true, async page => {
    const inspection = await page.evaluate(() => window.inspectLessonQuality());
    return checkSlideContrast(page, inspection, signal);
  }, signal);
}


export function renderVideoSteps(deck:Deck,roots:MediaRoots,settings:VideoSettings,count:number,signal:AbortSignal) {
  return withRenderedSlides(deck,roots,false,async page=>{
    const issues=await page.evaluate(()=>window.measureLessonQuality());
    if(Object.values(issues).some(list=>list.includes('overflow') || list.includes('overlap'))) throw new Error('The slide does not fit the requested video format.');
    // Keep layout stable: hide later elements without removing their occupied space.
    const total=await page.evaluate(()=>window.prepareVideoSteps());
    const frames:Buffer[]=[];
    let lastVisible=-1;
    let frame:Buffer|undefined;
    for(let i=0;i<count;i++){
      signal.throwIfAborted();
      const visible=Math.max(Math.floor(total*(i+1)/count),Math.min(i,total));
      if(!frame || visible!==lastVisible){
        await page.evaluate(step=>window.showVideoStep(step),visible);
        frame=await page.screenshot({type:'png',animations:'disabled'});
        lastVisible=visible;
      }
      frames.push(frame);
    }
    return frames;
  },signal,settings);
}
