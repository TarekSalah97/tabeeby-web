import { safeEqual } from './tokens.js';

export const CSRF_COOKIE = 'tb_csrf';
export const CSRF_FIELD = '_csrf';

/**
 * CSRF defence in depth for state-changing requests:
 *  1. SameSite=Lax session cookie (browsers drop it on cross-site POSTs),
 *  2. Origin / Referer must be our own origin when present,
 *  3. a per-browser token (cookie) must match the hidden form field.
 */
export function checkOrigin(headers: { origin?: string | undefined; referer?: string | undefined }, publicOrigin: string): boolean {
  const expected = new URL(publicOrigin).origin;
  if (headers.origin) return headers.origin === expected;
  if (headers.referer) {
    try {
      return new URL(headers.referer).origin === expected;
    } catch {
      return false;
    }
  }
  return true; // some privacy tools strip both; the token check still applies
}

export function checkCsrfToken(cookieToken: string | undefined, formToken: string | undefined): boolean {
  return !!cookieToken && !!formToken && cookieToken.length >= 20 && safeEqual(cookieToken, formToken);
}
