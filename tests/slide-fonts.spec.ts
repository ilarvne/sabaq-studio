import { expect, test } from '@playwright/test';
import { brandFonts } from '@sabaq/lesson/types';

const fonts = [
  { family: 'Golos Text Variable', weight: 400, postScriptName: 'GolosText-Regular' },
  { family: 'IBM Plex Sans', weight: 400, postScriptName: 'IBMPlexSans-Regular' },
  { family: 'IBM Plex Sans', weight: 600, postScriptName: 'IBMPlexSans-SemiBold' },
  { family: 'Noto Serif', weight: 600, postScriptName: 'NotoSerif-SemiBold' },
];
const alphabets = [
  'АӘБВГҒДЕЁЖЗИЙКҚЛМНҢОӨПРСТУҰҮФХҺЦЧШЩЪЫІЬЭЮЯ',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
];
const glyphs = alphabets.map(letters => letters + letters.toLowerCase()).join('');

test('the bundled slide fonts render every Kazakh, Russian and English letter without fallback', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes which font renders each glyph through CDP.');
  expect([...new Set(fonts.map(font => font.family))].sort()).toEqual([...brandFonts].sort());
  const fontOrigins = new Set<string>();
  page.on('request', request => {
    if (request.resourceType() === 'font') fontOrigins.add(new URL(request.url()).origin);
  });
  await page.goto('/');
  await expect(page.locator('.creation-home')).toBeVisible({ timeout:15_000 });
  await page.evaluate(async ({ fonts, glyphs }) => {
    await Promise.all(fonts.map(async ({ family, weight }, index) => {
      const font = `${weight} 18px "${family}"`;
      await document.fonts.load(font, glyphs);
      const sample = document.createElement('div');
      sample.id = `slide-font-sample-${index}`;
      sample.style.font = font;
      sample.style.fontSynthesis = 'none';
      sample.textContent = glyphs;
      document.body.append(sample);
    }));
  }, { fonts, glyphs });

  // FontFaceSet can confirm a CSS face loaded while the browser silently falls back for individual glyphs.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  for (const [index, font] of fonts.entries()) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#slide-font-sample-' + index });
    const { fonts: usage } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(usage.every(face => face.isCustomFont && face.postScriptName === font.postScriptName), font.family).toBe(true);
    expect(usage.reduce((count, face) => count + face.glyphCount, 0), font.family).toBe(glyphs.length);
  }
  expect([...fontOrigins]).toEqual([new URL(page.url()).origin]);
});
