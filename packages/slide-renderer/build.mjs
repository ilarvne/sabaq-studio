import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = join(root, 'dist');
await mkdir(output, { recursive: true });

const bundle = await build({
  absWorkingDir: root,
  entryPoints: { view: 'src/export-view.tsx' },
  outdir: output,
  bundle: true,
  write: false,
  jsx: 'automatic',
  minify: true,
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: '[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await Promise.all(bundle.outputFiles.map(file => writeFile(file.path, file.contents)));

const manifest = {
  script: 'view.js',
  stylesheet: 'view.css',
  files: bundle.outputFiles.map(file => basename(file.path)).sort(),
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
