import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultDatabase = resolve(projectRoot, '.data', 'studio.sqlite');
export const defaultMediaRoot = resolve(projectRoot, '.data', 'media');
export const webRoot = resolve(projectRoot, 'apps', 'web');
export const defaultStaticRoot = process.env.STUDIO_STATIC_ROOT
  ? resolve(process.env.STUDIO_STATIC_ROOT) : resolve(webRoot, 'out');
const builtCatalog = resolve(defaultStaticRoot, 'assets');
export const catalogRoot = process.env.STUDIO_CATALOG_ROOT
  ? resolve(process.env.STUDIO_CATALOG_ROOT)
  : process.env.STUDIO_DEV !== '1' && existsSync(builtCatalog) ? builtCatalog : resolve(webRoot, 'public', 'assets');
