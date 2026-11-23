import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function config(phase) {
  const shared = {
    devIndicators: false,
    poweredByHeader: false,
    transpilePackages: ['@sabaq/lesson', '@sabaq/contracts', '@sabaq/slide-renderer'],
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const port = Number(process.env.STUDIO_API_PORT ?? 4318);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('STUDIO_API_PORT must be an integer between 1 and 65535.');
    }
    return {
      ...shared,
      // Match the API's slide-import limit and longest interactive translation.
      experimental: { proxyClientMaxBodySize: '20mb', proxyTimeout: 510_000 },
      async rewrites() {
        return [{ source: '/api/:path*', destination: `http://127.0.0.1:${port}/api/:path*` }];
      },
    };
  }

  // Fastify serves the static editor and its API on a single origin.
  return { ...shared, output: 'export' };
}
