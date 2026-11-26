import type { ServerResponse } from 'node:http';

/**
 * Strict Content-Security-Policy: only our own scripts and styles, no inline
 * script, no third-party origins (the Cairo font is self-hosted under /static,
 * so no visitor data goes to Google — which also matters for the data-transfer rules).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: lets the page shrink a chosen photo before upload (it only reads files the user picked).
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

/** micAllowed: only the doctor dashboard may use the microphone (voice dictation of notes). */
export function applySecurityHeaders(res: ServerResponse, https: boolean, micAllowed = false): void {
  res.setHeader('Content-Security-Policy', https ? `${CSP}; upgrade-insecure-requests` : CSP);
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', `camera=(), microphone=${micAllowed ? '(self)' : '()'}, geolocation=(), payment=()`);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** Served private documents (syndicate cards) must never execute anything. */
export function applyDocumentHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'");
  res.setHeader('Cache-Control', 'private, no-store');
}
