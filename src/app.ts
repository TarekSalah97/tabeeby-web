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
import { messagingRoutes } from './routes/messaging.js';
import { facilityRoutes } from './routes/facilities.js';
import { log, errorFields } from './log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ when run with tsx, dist/src/ when compiled.
const STATIC_DIR = [path.resolve(here, '../public'), path.resolve(here, '../../public')].find((p) => fs.existsSync(p)) ?? path.resolve('public');
const FORM_LIMIT = 64 * 1024;

export function buildRouter(): Router {
  const r = new Router();
  publicRoutes(r);
  authRoutes(r);
  patientRoutes(r);
  messagingRoutes(r);
  facilityRoutes(r);
  symptomCheckerRoutes(r);
  recordsRoutes(r);
  dashboardRoutes(r);
  adminRoutes(r);
  return r;
}

function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createApp(deps: Deps, staticDir = STATIC_DIR): http.Server {
  const router = buildRouter();
  const https = deps.cfg.PUBLIC_ORIGIN.startsWith('https://');

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

    if (url.pathname.startsWith('/static/')) {
      if (await serveStatic(staticDir, url.pathname, res, method)) return;
      res.statusCode = 404;
      res.end();
      return;
    }
    if (url.pathname === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.end(deps.cfg.DEMO_MODE ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /book\nDisallow: /appointments\n');
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
      ip: clientIp(req, deps.cfg.TRUST_PROXY),
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
          const body = await readBody(req, deps.cfg.MAX_UPLOAD_BYTES + 256 * 1024);
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
