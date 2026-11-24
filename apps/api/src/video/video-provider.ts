import { allowedProviderEndpoint } from '../access/provider-origins';

export function videoProviderEndpoint(value: string | undefined) {
  const region = process.env.STUDIO_VIDEO_REGION;
  if (!value || !['KZ', 'global'].includes(region ?? '') || !URL.canParse(value)) return;
  if (process.env.STUDIO_AUTH_MODE === 'gateway' && region !== 'KZ') return;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return;
  if (!allowedProviderEndpoint(value)) return;
  return url.href.replace(/\/$/, '');
}
