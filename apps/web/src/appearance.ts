export const appearanceKey = 'sabaq:dark';
export const studioColors = { light: '#ffffff', dark: '#09090b' };

// This runs in the document head while the browser is still parsing the page.
export const restoreAppearanceScript = `try {
  if (localStorage.getItem('${appearanceKey}') === '0') {
    document.documentElement.dataset.appearance = 'light';
    document.querySelector('meta[name="theme-color"]').content = '${studioColors.light}';
  }
} catch {}`;

export function setStudioAppearance(dark: boolean) {
  const appearance = dark ? 'dark' : 'light';
  document.documentElement.dataset.appearance = appearance;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = studioColors[appearance];
  try { localStorage.setItem(appearanceKey, dark ? '1' : '0'); } catch { /* The choice still applies to this page. */ }
}
