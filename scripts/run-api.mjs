import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function startApi(env, entry) {
  const envFile = resolve(projectRoot, '.env');
  const options = existsSync(envFile) ? ['--env-file=' + envFile] : [];
  return Bun.spawn([process.execPath, '--no-env-file', ...options, resolve(projectRoot, 'apps/api', entry)], {
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
}
