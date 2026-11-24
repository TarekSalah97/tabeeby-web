import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Ctx, Deps } from './http/context.js';
import { LoginRequired, href } from './http/context.js';
import { Router } from './http/router.js';
import { parseCookies, serializeCookie } from './http/cookies.js';
import { readBody, parseUrlEncoded, parseMultipart } from './http/body.js';
import { HttpError, DomainError } from './http/errors.js';
import { applySecurityHeaders } from './http/security.js';
import { serveStatic } from './http/static.js';
import { sendHtml, redirect } from './http/respond.js';
import { loadSession, SESSION_COOKIE } from './auth/sessions.js';
import { unreadConversations } from './services/messaging.js';
import { CSRF_COOKIE, CSRF_FIELD, checkCsrfToken, checkOrigin } from './auth/csrf.js';
import { randomToken } from './auth/tokens.js';
import { translator, type Locale } from './i18n/index.js';
import { errorPage } from './views/pages/public.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { patientRoutes } from './routes/patient.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { adminRoutes } from './routes/admin.js';
import { recordsRoutes } from './routes/records.js';
import { symptomCheckerRoutes } from './routes/symptomChecker.js';
import { healthRecordRoutes } from './routes/healthRecord.js';
import { messagingRoutes } from './routes/messaging.js';
import { facilityRoutes } from './routes/facilities.js';
import { log, errorFields } from './log.js';
import { staticRoot } from './http/staticRoot.js';
import { RequestShield, isProbe } from './http/shield.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ when run with tsx, dist/src/ when compiled.
const STATIC_DIR = staticRoot;
const FORM_LIMIT = 64 * 1024;

export function buildRouter(): Router {
  const r = new Router();
  publicRoutes(r);
  authRoutes(r);
  patientRoutes(r);
  messagingRoutes(r);
  facilityRoutes(r);
  symptomCheckerRoutes(r);
  healthRecordRoutes(r);
  recordsRoutes(r);
  dashboardRoutes(r);
  adminRoutes(r);
  return r;
}

/**
 * The visitor's address, used by every rate limit and in the audit log. It must not be something
 * the visitor can choose: the edge's own header first (Cloudflare's True-Client-IP on Render), then
 * — behind one trusted proxy — the address that proxy appended LAST to X-Forwarded-For. The first
 * entry is whatever the visitor sent and is never trusted.
 */
export function clientIp(req: http.IncomingMessage, trustProxy: boolean, edgeHeader = ''): string {
  if (edgeHeader) {
    const v = req.headers[edgeHeader];
    const ip = (Array.isArray(v) ? v[0] : v)?.trim();
    if (ip && /^[0-9a-f.:]{3,45}$/i.test(ip)) return ip;
  }
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const last = list[list.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApp(deps: Deps, staticDir = STATIC_DIR): http.Server {
  const router = buildRouter();
  const https = deps.cfg.PUBLIC_ORIGIN.startsWith('https://');
  const limitsOn = deps.cfg.RATE_LIMIT_PAGES_PER_MIN > 0 && deps.cfg.RATE_LIMIT_POSTS_PER_MIN > 0;
  const shield = new RequestShield({ pagesPerMinute: deps.cfg.RATE_LIMIT_PAGES_PER_MIN, postsPerMinute: deps.cfg.RATE_LIMIT_POSTS_PER_MIN });

  return http.createServer((req, res) => {
    const started = Date.now();
    const requestId = crypto.randomBytes(6).toString('hex');
    const path = (req.url ?? '').split('?')[0] ?? '';
    applySecurityHeaders(res, https, path.startsWith('/dashboard') || path.startsWith('/en/dashboard'));
    if (deps.cfg.DEMO_MODE) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    void handle(req, res).finally(() => {
      log.info('request', { id: requestId, method: req.method, route: (res as { route?: string }).route ?? (req.url?.startsWith('/static/') ? 'static' : 'unmatched'), status: res.statusCode, ms: Date.now() - started });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }

    // Attack probes (WordPress, PHP, .env, .git…) end here, before any database work.
    if (isProbe(url.pathname)) {
      res.statusCode = 404;
      (res as { route?: string }).route = 'probe';
      res.end();
      return;
    }
    // Per-IP budget (pages and form submissions); static files and the health check are free.
    if (limitsOn && !url.pathname.startsWith('/static/') && url.pathname !== '/healthz') {
      const isPost = method !== 'GET' && method !== 'HEAD';
      if (!shield.allow(clientIp(req, deps.cfg.TRUST_PROXY, deps.cfg.CLIENT_IP_HEADER), isPost)) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '60');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        (res as { route?: string }).route = 'rate-limited';
        res.end('<!doctype html><meta charset="utf-8"><title>Tabeeby</title><body style="font-family:sans-serif;padding:2rem;text-align:center"><h1>طلبات كثيرة — Too many requests</h1><p>من فضلك انتظر دقيقة ثم حاول مرة أخرى.</p><p>Please wait a minute and try again.</p></body>');
        return;
      }
    }

    if (url.pathname.startsWith('/static/')) {
      if (await serveStatic(staticDir, url.pathname, res, method, url.searchParams.has('v'))) return;
      res.statusCode = 404;
      res.end();
      return;
    }
    if (url.pathname === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.end(deps.cfg.DEMO_MODE ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /facility\nDisallow: /book\nDisallow: /appointments\nDisallow: /health-record\nDisallow: /results\nDisallow: /en/dashboard\nDisallow: /en/admin\nDisallow: /en/facility\nDisallow: /en/book\nDisallow: /en/appointments\nDisallow: /en/health-record\nDisallow: /en/results\n');
      return;
    }
    // How security researchers can report a problem (RFC 9116).
    if (url.pathname === '/.well-known/security.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const expires = new Date(Date.now() + 180 * 86400_000).toISOString();
      res.end(`Contact: ${deps.cfg.PUBLIC_ORIGIN}/en/contact\nExpires: ${expires}\nPreferred-Languages: en, ar\nCanonical: ${deps.cfg.PUBLIC_ORIGIN}/.well-known/security.txt\n`);
      return;
    }

    // Locale from the path: Arabic at '/', English under '/en'.
    let locale: Locale = 'ar';
    let pathName = url.pathname;
    if (pathName === '/en' || pathName.startsWith('/en/')) {
      locale = 'en';
      pathName = pathName.slice(3) || '/';
    }
    if (pathName.length > 1 && pathName.endsWith('/')) pathName = pathName.slice(0, -1);

    const cookies = parseCookies(req.headers.cookie);
    const responseCookies: string[] = [];
    let csrfToken = cookies[CSRF_COOKIE] ?? '';
    if (csrfToken.length < 20) {
      csrfToken = randomToken();
      responseCookies.push(serializeCookie(CSRF_COOKIE, csrfToken, { httpOnly: true, sameSite: 'Lax', secure: https, maxAgeSeconds: 60 * 60 * 24 * 30 }));
    }

    const ctx: Ctx = {
      req,
      res,
      deps,
      method,
      url,
      path: pathName,
      params: {},
      query: url.searchParams,
      ip: clientIp(req, deps.cfg.TRUST_PROXY, deps.cfg.CLIENT_IP_HEADER),
      locale,
      t: translator(locale),
      cookies,
      session: null,
      user: null,
      unreadMessages: 0,
      csrfToken,
      form: {},
      files: [],
      responseCookies,
    };

    try {
      const sessionToken = cookies[SESSION_COOKIE];
      if (sessionToken) {
        ctx.session = await loadSession(deps.db, sessionToken);
        ctx.user = ctx.session?.user ?? null;
        // One small indexed count per page view, only for people who can have messages.
        if (ctx.user && method === 'GET' && (ctx.user.role === 'patient' || ctx.user.role === 'doctor')) {
          ctx.unreadMessages = await unreadConversations(deps.db, ctx.user);
        }
        if (!ctx.session) responseCookies.push(serializeCookie(SESSION_COOKIE, '', { secure: https, maxAgeSeconds: 0 }));
      }

      const match = router.match(method, pathName);
      if (match === null) throw new HttpError(404, 'error.notFound');
      if (match === 'method-not-allowed') throw new HttpError(405, 'error.badRequest');
      (res as { route?: string }).route = match.pattern;
      ctx.params = match.params;

      if (method === 'POST') {
        if (!checkOrigin({ origin: req.headers.origin, referer: req.headers.referer }, deps.cfg.PUBLIC_ORIGIN)) {
          throw new HttpError(403, 'error.csrf', 'origin mismatch');
        }
        const type = (req.headers['content-type'] ?? '').toLowerCase();
        if (type.startsWith('multipart/form-data')) {
          // Sign-up can carry several documents: each file is checked against MAX_UPLOAD_BYTES on its own.
          const body = await readBody(req, deps.cfg.MAX_FORM_UPLOAD_BYTES);
          const parsed = parseMultipart(body, req.headers['content-type'] ?? '');
          ctx.form = parsed.fields;
          ctx.files = parsed.files;
        } else if (type.startsWith('application/x-www-form-urlencoded') || type === '') {
          ctx.form = parseUrlEncoded(await readBody(req, FORM_LIMIT));
        } else {
          throw new HttpError(415, 'error.badRequest');
        }
        // Compare against the token the browser sent, not one we just minted.
        if (!checkCsrfToken(cookies[CSRF_COOKIE], ctx.form[CSRF_FIELD]?.[0])) throw new HttpError(403, 'error.csrf', 'csrf token mismatch');
      }

      await match.handler(ctx);
      if (!res.writableEnded) throw new Error(`handler for ${match.pattern} did not respond`);
    } catch (err) {
      if (res.headersSent) {
        log.error('error after response started', errorFields(err));
        res.end();
        return;
      }
      if (err instanceof LoginRequired) {
        const next = method === 'GET' ? pathName + url.search : undefined;
        return redirect(ctx, href(ctx, '/login', { next }));
      }
      if (err instanceof HttpError) {
        if (err.status >= 500) log.error('http error', errorFields(err));
        else if (err.status === 403) log.warn('forbidden', { reason: err.message, route: (res as { route?: string }).route });
        return sendHtml(ctx, err.status, errorPage(ctx, err.status, err.messageKey));
      }
      if (err instanceof DomainError) return sendHtml(ctx, 400, errorPage(ctx, 400, err.messageKey));
      log.error('unhandled error', errorFields(err));
      sendHtml(ctx, 500, errorPage(ctx, 500, 'error.server'));
    }
  }
}
