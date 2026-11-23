import { startApi } from './run-api.mjs';

const api = startApi(
  { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production', STUDIO_REQUIRE_WEB: '1' },
  'dist/main.js',
);
process.on('SIGTERM', () => api.kill('SIGTERM'));
process.on('SIGINT', () => api.kill('SIGINT'));
process.exitCode = await api.exited;
