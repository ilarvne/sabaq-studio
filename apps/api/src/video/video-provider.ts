import { allowedProviderEndpoint } from '../access/provider-origins';

export function videoProviderEndpoint(value: string | undefined) {
  const region = process.env.STUDIO_VIDEO_REGION;
  if (!value || !['KZ', 'global'].includes(region ?? '') || !URL.canParse(value)) return;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return;
  const remoteAllowed = process.env.STUDIO_VIDEO_PROVIDER_ORIGINS?.split(',').some(item => item.trim() === url.origin);
  if (!(allowedProviderEndpoint(value) || (region === 'global' && url.protocol === 'https:' && remoteAllowed))) return;
  return url.href.replace(/\/$/, '');
}
