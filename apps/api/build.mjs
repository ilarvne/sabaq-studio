import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
await Bun.build({
  entrypoints: [path('./src/main.ts')],
  outdir: path('./dist'),
  target: 'bun',
  packages: 'external',
  sourcemap: 'linked',
  throw: true,
});
await Promise.all(['extract_docx.py', 'extract_pptx.py'].map(file =>
  copyFile(path('./src/media/' + file), path('./dist/' + file))
));
