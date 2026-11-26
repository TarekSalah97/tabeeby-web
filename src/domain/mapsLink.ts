/**
 * A Google Maps link a pharmacy or lab pastes for its branch ("Share" → "Copy link" in Google Maps).
 * Only real Google Maps addresses are accepted, always as https, so the link can't send patients to
 * another site. Returns null for an empty value, or 'invalid'.
 */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const GOOGLE_HOST = /^(www\.|maps\.)?google\.com(\.eg)?$/;

export function normalizeMapsUrl(raw: string): string | null | 'invalid' {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > 500) return 'invalid';
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid';
  if (url.username || url.password || url.port) return 'invalid';
  const host = url.hostname.toLowerCase();
  const ok =
    host === 'maps.app.goo.gl' ||
    (host === 'goo.gl' && url.pathname.startsWith('/maps')) ||
    (GOOGLE_HOST.test(host) && (host.startsWith('maps.') || url.pathname.startsWith('/maps')));
  if (!ok || (SHORT_HOSTS.has(host) && url.pathname.length < 2)) return 'invalid';
  url.protocol = 'https:';
  url.hash = '';
  return url.toString();
}
