import type { Locator, Page } from 'playwright-core';
import sharp from 'sharp';
import type { ContrastProbe, QualityInspection } from '@sabaq/slide-renderer/runtime';
import type { QualityIssue } from '@sabaq/contracts/quality';

const linear = Array.from({ length: 256 }, (_, channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
const luminance = (r: number, g: number, b: number) => .2126 * linear[r] + .7152 * linear[g] + .0722 * linear[b];

type Raster = Awaited<ReturnType<typeof rasterize>>;
function rasterize(png: Buffer) {
  return sharp(png).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

function measureProbe(probe: ContrastProbe, backdrop: Raster, light: Buffer, dark: Buffer) {
  const { width, height, channels } = backdrop.info;
  const alpha = probe.ink[3] / 255;
  const [r, g, b] = probe.ink;
  let measured = false;
  for (let y = Math.max(0, Math.floor(probe.top)); y < Math.min(height, Math.ceil(probe.bottom)); y++) {
    for (let x = Math.max(0, Math.floor(probe.left)); x < Math.min(width, Math.ceil(probe.right)); x++) {
      const pos = (y * width + x) * channels;
      // Changing only text fill identifies the interior of a glyph, excluding antialiased edges and whitespace.
      if (light[pos] - dark[pos] < 245) continue;
      measured = true;
      const bgR = backdrop.data[pos], bgG = backdrop.data[pos + 1], bgB = backdrop.data[pos + 2];
      const background = luminance(bgR, bgG, bgB);
      const foreground = luminance(
        Math.round(r * alpha + bgR * (1 - alpha)),
        Math.round(g * alpha + bgG * (1 - alpha)),
        Math.round(b * alpha + bgB * (1 - alpha)),
      );
      if ((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) < probe.minimum) return 'contrast';
    }
  }
  return measured ? undefined : 'contrast-review';
}

const captureStyles = [
  ['background', 'transparent'], ['light', '#fff'], ['dark', '#000'],
] as const;

async function capture(slide: Locator, mode: typeof captureStyles[number][0]) {
  await slide.evaluate((element, value) => element.setAttribute('data-quality-capture', value), mode);
  return rasterize(await slide.screenshot({ type: 'png', scale: 'css', animations: 'disabled' }));
}

export async function checkSlideContrast(page: Page, { issues, contrast }: QualityInspection, signal: AbortSignal) {
  if (!contrast.length) return issues;
  await page.addStyleTag({ content: captureStyles.map(([mode, color]) =>
    '[data-quality-capture="' + mode + '"] [data-quality-contrast] {' +
    '-webkit-text-fill-color:' + color + ' !important; }').join('\n') });
  const slides = page.locator('.ed-slide[data-slide-id]');
  for (const { index, id, probes, needsReview } of contrast) {
    signal.throwIfAborted();
    if (issues[id].includes('contrast')) continue;
    const slide = slides.nth(index);
    const backdrop = await capture(slide, 'background');
    const light = await capture(slide, 'light');
    const dark = await capture(slide, 'dark');
    await slide.evaluate(element => element.removeAttribute('data-quality-capture'));
    const findings = new Set<QualityIssue>(issues[id].filter(issue => issue !== 'contrast-review'));
    if (needsReview) findings.add('contrast-review');
    for (const probe of probes) {
      const result = measureProbe(probe, backdrop, light.data, dark.data);
      if (result) findings.add(result);
    }
    issues[id] = [...findings];
  }
  return issues;
}
