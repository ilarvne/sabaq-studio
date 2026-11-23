import { useEffect, useState } from 'react';
import { slideImages, type Deck, type Slide, type SlideImage } from '@sabaq/lesson/types';

// Keep private assets only for the lifetime of the open projection.
export function usePresentationMedia(slides: Slide[], logo?: string) {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [state, setState] = useState<'loading' | 'ready' | 'incomplete'>('loading');
  useEffect(() => {
    const sources = [...new Set([...slides.flatMap(slide => [
      ...slideImages(slide).map(image=>image.src),...(slide.importedArtwork ? [slide.importedArtwork] : []),
    ]), ...(logo ? [logo] : [])])];
    const controller = new AbortController();
    const cached = new Map<string, string>();
    let running = false;
    async function prepare() {
      if (running || controller.signal.aborted) return;
      running = true;
      setState('loading');
      const queue = sources.filter(src => !cached.has(src));
      async function load() {
        let src: string | undefined;
        while (!controller.signal.aborted && (src = queue.shift()) !== undefined) {
          try {
            const url = new URL(src, location.href);
            if (url.origin !== location.origin || !/^\/(?:assets|api\/media)\//.test(url.pathname)) continue;
            const response = await fetch(url, {signal: controller.signal, credentials: 'same-origin', redirect: 'error'});
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith('image/') || controller.signal.aborted) continue;
            cached.set(src, URL.createObjectURL(blob));
          } catch { /* Keep the original URL and retry after a network reconnection. */ }
        }
      }
      await Promise.all([load(), load()]);
      running = false;
      if (!controller.signal.aborted) {
        setUrls(new Map(cached));
        setState(cached.size === sources.length ? 'ready' : 'incomplete');
      }
    }
    void prepare();
    window.addEventListener('online', prepare);
    return () => {
      controller.abort();
      window.removeEventListener('online', prepare);
      cached.forEach(url => URL.revokeObjectURL(url));
    };
  }, [slides, logo]);
  function withMedia(slide: Slide) {
    const load=(image:SlideImage)=>({...image,src:urls.get(image.src) ?? image.src});
    return {...slide,
      ...(slide.image && {image:load(slide.image)}),
      ...(slide.additionalImages && {additionalImages:slide.additionalImages.map(load)}),
      ...(slide.importedArtwork && {importedArtwork:urls.get(slide.importedArtwork) ?? slide.importedArtwork}),
    };
  }
  function withBrand(deck: Deck): Deck {
    const url = deck.brand?.logo && urls.get(deck.brand.logo);
    return url && deck.brand ? {...deck, brand: {...deck.brand, logo: url}} : deck;
  }
  return {state, withMedia, withBrand};
}
