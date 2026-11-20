import type { Ctx } from './context.js';
import type { SafeHtml } from '../views/html.js';

function writeCookies(ctx: Ctx): void {
  if (ctx.responseCookies.length) ctx.res.setHeader('Set-Cookie', ctx.responseCookies);
}

export function sendHtml(ctx: Ctx, status: number, body: SafeHtml): void {
  writeCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Pages carry CSRF tokens and personal data: never cache them in shared caches.
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.end(ctx.method === 'HEAD' ? undefined : '<!doctype html>' + body.value);
}

export function redirect(ctx: Ctx, location: string, status = 303): void {
  writeCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Location', location);
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.end();
}

export function sendJson(ctx: Ctx, status: number, data: unknown): void {
  writeCookies(ctx);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
  ctx.res.setHeader('Cache-Control', 'no-store');
  ctx.res.end(JSON.stringify(data));
}
