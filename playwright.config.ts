import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const database = join(mkdtempSync(join(tmpdir(), 'sabaq-e2e-')), 'studio.sqlite');

const webPort = Number(process.env.STUDIO_E2E_WEB_PORT || 5184);
const apiPort = Number(process.env.STUDIO_E2E_API_PORT || 4321);
if (![webPort, apiPort].every(n => Number.isInteger(n) && n > 0 && n < 65536)) throw new Error('Invalid test port');
const baseURL = 'http://127.0.0.1:' + webPort;
const built = process.env.STUDIO_E2E_BUILT === '1';
const browserName = process.env.STUDIO_E2E_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'firefox' && browserName !== 'webkit')
  throw new Error('STUDIO_E2E_BROWSER must be chromium, firefox or webkit');
const channel = browserName === 'chromium' ? process.env.STUDIO_E2E_CHANNEL : undefined;
const organization = process.env.STUDIO_E2E_ORGANIZATION === '1';
const coedit=process.env.STUDIO_E2E_COEDIT === '1';
const gateway=organization || coedit;
if(gateway) process.env.STUDIO_E2E_ORG_TEST_KEY ??= randomUUID();
const gatewayTests=[...(organization?['**/organization.spec.ts']:[]),...(coedit?['**/coedit.spec.ts']:[])];

export default defineConfig({
  testDir: './tests',
  ...(gateway ? {testMatch:gatewayTests} : {testIgnore:['**/organization.spec.ts','**/coedit.spec.ts']}),
  workers: 1,
  timeout: 35_000,
  use: {
    baseURL,
    browserName,
    channel,
    launchOptions: browserName === 'chromium' && !channel && process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: built ? 'bun --no-env-file run start' : 'bun --no-env-file run dev --port ' + webPort,
    url: baseURL + (gateway ? '/' : '/api/capabilities'),
    timeout: 120_000,
    env: {
      PORT: String(webPort), STUDIO_DB_PATH: database, STUDIO_API_PORT: String(apiPort),
      ALEM_API_KEY: '', ALEM_EMBEDDINGS_API_KEY: '', ALEM_RERANK_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      OPENAI_API_KEY: '', STUDIO_VIDEO_LOCAL_WORKER: '0',
      ALEM_STT_KK_API_KEY: '', ALEM_STT_API_KEY: '', ALEM_OCR_API_KEY: '',
      STUDIO_ASSISTANT_OLLAMA_MODEL: '', STUDIO_MEM0_URL: '', STUDIO_EMBEDDING_MODEL: '',
      STUDIO_RESEARCH_PROVIDER: '', STUDIO_MODERATION_OLLAMA_MODEL: '', STUDIO_AUTHORING_MODEL: '',
      STUDIO_TRANSLATION_OLLAMA_MODEL: '', STUDIO_IMAGE_ENDPOINT: '', NEXT_TELEMETRY_DISABLED: '1',
      STUDIO_COEDIT: coedit ? '1' : '', STUDIO_AUTH_MODE: gateway ? 'gateway' : 'local',
      STUDIO_GATEWAY_SECRET: gateway ? process.env.STUDIO_E2E_ORG_TEST_KEY! : '',
    },
    reuseExistingServer: false,
  },
});
