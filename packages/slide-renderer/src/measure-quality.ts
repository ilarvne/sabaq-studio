import type { QualityIssue } from '@sabaq/contracts/quality';
import type { ContrastProbe, QualityInspection } from './runtime';

// Measurements use the same 1920 × 1080 canvas and CSS used by the presenter.
export function measureQuality() { return inspectQuality().issues; }

export function inspectQuality(collectContrast = false): QualityInspection {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const painter = canvas.getContext('2d', { willReadFrequently: true })!;
  const colorCache = new Map<string, Uint8ClampedArray>();
  function rgba(color: string) {
    let value = colorCache.get(color);
    if (!value) {
      painter.clearRect(0, 0, 1, 1);
      painter.fillStyle = color; painter.fillRect(0, 0, 1, 1);
      value = painter.getImageData(0, 0, 1, 1).data; colorCache.set(color, value);
    }
    return value;
  }
  function luminance(c: Uint8ClampedArray) {
    const linear = (v: number) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
    return linear(c[0]) * .2126 + linear(c[1]) * .7152 + linear(c[2]) * .0722;
  }
  function contrastRatio(foreground: Uint8ClampedArray, background: Uint8ClampedArray, opacity = 1) {
    const alpha = foreground[3] / 255 * opacity;
    const painted = alpha === 1 ? foreground : foreground.map((value, index) =>
      index === 3 ? 255 : value * alpha + background[index] * (1 - alpha));
    const fg = luminance(painted), bg = luminance(background);
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
  }
  function intersects(a: DOMRect, b: DOMRect) {
    return Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1 &&
      Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1;
  }
  const results: Record<string, QualityIssue[]> = {};
  const contrast: QualityInspection['contrast'] = [];
  const slides = document.querySelectorAll<HTMLElement>('.ed-slide[data-slide-id]');
  for (const [index, slide] of slides.entries()) {
    const issues = new Set<QualityIssue>();
    const probes: ContrastProbe[] = [];
    let needsReview = false;
    const bounds = slide.getBoundingClientRect();
    const backdrops = '.ed-slide-background,.ed-imported-artwork,.ed-free-page[data-photo-backdrop] > [data-free-id=image]';
    const photoBehindText = !!slide.querySelector(backdrops);
    const regions = '.ed-slide-title, .ed-slide-body, .ed-slide-answer, [data-story-text], th, td, .ed-chart-labels span, .ed-chart-column b, .ed-diagram-label, .ed-object-text';
    const boxes: { group: Element; rect: DOMRect }[] = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    if (slide.dataset.overflow === 'true') issues.add('overflow');
    for (const object of slide.querySelectorAll<HTMLElement>('.ed-object-text')) {
      if (object.scrollHeight > object.clientHeight + 1 || object.scrollWidth > object.clientWidth + 1) issues.add('overflow');
    }
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      const group = element?.closest(regions);
      if (!group || !element || !node.textContent?.trim() || element.closest('[data-chart-transcript]')) continue;
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1);
      for (const rect of rects) {
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) issues.add('overflow');
        boxes.push({ rect, group });
      }
      if (!rects.length) continue;
      const style = getComputedStyle(element);
      const size = parseFloat(style.fontSize);
      const title = !!element.closest('.ed-slide-title');
      if (size * 0.75 < (title ? 32 : 24) - .05) issues.add('small-type');
      const ink = rgba(style.webkitTextFillColor || style.color);
      const large = size >= 24 || (size >= 18.67 && Number(style.fontWeight) >= 700);
      const minimum = large ? 3 : 4.5;
      let ancestor: Element | null = element;
      let background: Uint8ClampedArray | undefined;
      let complex = false;
      let compositedText = style.textShadow !== 'none';
      while (ancestor && slide.contains(ancestor)) {
        const layer = getComputedStyle(ancestor);
        const fill = rgba(layer.backgroundColor);
        compositedText ||= Number(layer.opacity) < 1 || layer.filter !== 'none' || layer.mixBlendMode !== 'normal';
        if (!background) {
          if (layer.backgroundImage !== 'none' || (fill[3] > 0 && fill[3] < 255) || (ancestor === slide && photoBehindText)) complex = true;
          if (fill[3] === 255) background = fill;
        }
        ancestor = ancestor.parentElement;
      }
      if (complex || !background || ink[3] < 255 || compositedText) {
        issues.add('contrast-review');
        if (!collectContrast || compositedText) needsReview = true;
        else {
          element.setAttribute('data-quality-contrast', '');
          for (const rect of rects) probes.push({
            left: rect.left - bounds.left, right: rect.right - bounds.left,
            top: rect.top - bounds.top, bottom: rect.bottom - bounds.top,
            ink: Array.from(ink), minimum,
          });
        }
      } else if (contrastRatio(ink, background) < minimum) issues.add('contrast');
    }
    const graphics = '.ed-chart-column i, .ed-zero-line, .ed-diagram-plot line, .ed-diagram-node';
    for (const part of slide.querySelectorAll(graphics)) {
      const dimensions = part.getBoundingClientRect();
      if ((!dimensions.width && !dimensions.height) || (part.matches('i') && !dimensions.height)) continue;
      const style = getComputedStyle(part);
      const color = part.matches('line') ? style.stroke : part.matches('.ed-diagram-node') ?
        style.borderTopColor : style.backgroundColor;
      const fill = rgba(color);
      if (!fill[3]) continue;
      let under = part.parentElement;
      let opaque: Uint8ClampedArray | undefined;
      while (under && slide.contains(under)) {
        const layer = getComputedStyle(under);
        const background = rgba(layer.backgroundColor);
        if (layer.backgroundImage !== 'none' || (background[3] > 0 && background[3] < 255) ||
            (under === slide && photoBehindText)) break;
        if (background[3] === 255) { opaque = background; break; }
        under = under.parentElement;
      }
      if (!opaque) issues.add('graphic-contrast-review');
      else if (contrastRatio(fill, opaque, Number(style.opacity)) < 3) issues.add('graphic-contrast');
    }
    boxes.sort((a, b) => a.rect.top - b.rect.top);
    for (let i = 0; i < boxes.length && !issues.has('overlap'); i++) {
      for (let j = i + 1; j < boxes.length && boxes[j].rect.top < boxes[i].rect.bottom - 1; j++) {
        if (boxes[i].group !== boxes[j].group && intersects(boxes[i].rect, boxes[j].rect)) {
          issues.add('overlap'); break;
        }
      }
    }
    for (const img of slide.querySelectorAll('img')) {
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height || !img.naturalWidth) { issues.add('empty-content'); continue; }
      if (getComputedStyle(img).objectFit === 'cover') {
        const factor = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
        if (img.naturalWidth * factor > rect.width + 1 || img.naturalHeight * factor > rect.height + 1) issues.add('image-crop');
      }
      if (!img.closest(backdrops) && boxes.some(box => intersects(box.rect, rect))) issues.add('overlap');
    }
    const id = slide.dataset.slideId!;
    results[id] = [...issues];
    if (probes.length) contrast.push({ index, id, probes, needsReview });
  }
  return { issues: results, contrast };
}
