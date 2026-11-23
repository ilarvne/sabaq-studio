/** An operator lists remote origins only after verifying the provider's Kazakhstan deployment. */
export function allowedProviderEndpoint(value: string | undefined) {
  if (!value || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return false;
  if (process.env.STUDIO_AUTH_MODE !== 'gateway') return true;
  if (['127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  return url.protocol === 'https:' && (process.env.STUDIO_KZ_PROVIDER_ORIGINS ?? '')
    .split(',').some(entry => entry.trim() === url.origin);
}
