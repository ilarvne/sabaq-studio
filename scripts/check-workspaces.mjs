import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = new Map();
for (const group of ['apps', 'packages']) {
  for (const dir of readdirSync(join(root, group), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join(root, group, dir.name);
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    packages.set(manifest.name, { path, manifest });
  }
}

const failures = [];
for (const { path, manifest } of packages.values()) {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  const files = new Bun.Glob('{src,app,tools}/**/*.{ts,tsx}');
  for (const filename of files.scanSync(path)) {
    const file = join(path, filename);
    const source = readFileSync(file, 'utf8');
    const runtime = new Bun.Transpiler({ loader: filename.endsWith('.tsx') ? 'tsx' : 'ts' });
    const importPaths = new Set(runtime.scanImports(source).map(item => item.path));
    // Bun's dependency scanner removes type-only imports.
    for (const match of source.matchAll(/\b(?:(?:import|export)\s+type\b[^;]*?\bfrom\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      importPaths.add(match[1]);
    }
    for (const name of importPaths) {
      const location = relative(root, file);
      if (name.startsWith('.') && relative(path, resolve(dirname(file), name)).startsWith('..')) {
        failures.push(location + ' crosses a workspace boundary with ' + name);
      }
      if (name.startsWith('@sabaq/')) {
        const [, workspace, ...subpath] = name.split('/');
        const target = '@sabaq/' + workspace;
        if (!(target in dependencies) || !packages.get(target)?.manifest.exports?.['./' + subpath.join('/')]) {
          failures.push(location + ' needs a declared dependency and exported entry for ' + name);
        }
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
