import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStudioServer } from './app';
import { defaultStaticRoot } from './runtime-paths';
import { startBundledLectureWorker } from './video/start-lecture-worker';

const port = Number(process.env.PORT ?? 4318);
const host = process.env.HOST ?? '127.0.0.1';

if (process.env.STUDIO_AUTH_MODE !== 'gateway' && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error('Configure gateway authentication before exposing the studio beyond loopback.');
}
if (process.env.STUDIO_REQUIRE_WEB === '1' && !existsSync(resolve(defaultStaticRoot, 'index.html'))) {
  throw new Error('Run bun run build before starting the production studio.');
}

const lectureWorker = await startBundledLectureWorker().catch((error: unknown) => {
  console.error('Could not start narrated-video worker:', error instanceof Error ? error.message : 'Unknown error');
});
const app = createStudioServer();
if (lectureWorker) app.addHook('onClose', () => lectureWorker.close());
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void app.close(); });
}

try {
  const address = await app.listen({ host, port });
  console.log('Lesson Studio API listening at ' + address);
} catch (error) {
  await app.close();
  console.error(error);
  process.exitCode = 1;
}
