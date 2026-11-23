import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { projectRoot, startApi } from './run-api.mjs';

const renderer = Bun.spawn([process.execPath, 'run', '--filter', '@sabaq/slide-renderer', 'build'], {
  cwd: projectRoot,
  stdout: 'inherit',
  stderr: 'inherit',
});
const buildStatus = await renderer.exited;
if (buildStatus !== 0) process.exit(buildStatus);

const apiPort = process.env.STUDIO_API_PORT || '4318';
const webRoot = resolve(projectRoot, 'apps', 'web');
const require = createRequire(resolve(webRoot, 'package.json'));
const next = require.resolve('next/dist/bin/next');

const webEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'TMPDIR', 'FORCE_COLOR', 'NO_COLOR', 'CI'].includes(key) || key.startsWith('LC_')
));
webEnv.STUDIO_API_PORT = apiPort;
webEnv.NEXT_TELEMETRY_DISABLED = '1';

const api = startApi({ ...process.env, PORT: apiPort, STUDIO_DEV: '1' }, 'src/main.ts');
const web = Bun.spawn(['node', next, 'dev', '--hostname', '127.0.0.1', '--port', '5173', ...process.argv.slice(2)], {
  cwd: webRoot,
  env: webEnv,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

function stop(signal = 'SIGTERM') {
  api.kill(signal);
  web.kill(signal);
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
const status = await Promise.race([api.exited, web.exited]);
stop();
await Promise.all([api.exited, web.exited]);
process.exitCode = status;
