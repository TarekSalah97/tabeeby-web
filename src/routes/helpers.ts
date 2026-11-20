import type { Ctx } from '../http/context.js';
import { href } from '../http/context.js';
import type { MessageKey } from '../i18n/index.js';
import { isMessageKey } from '../i18n/index.js';
import { field } from '../http/body.js';
import { createSession, sessionMaxAgeSeconds, SESSION_COOKIE, type Role } from '../auth/sessions.js';
import { setCookie } from '../http/context.js';
import { isUuid } from '../http/router.js';
import { notFound } from '../http/errors.js';

/** Short, whitelisted success codes in the URL instead of a server-side flash store. */
const NOTICES: Record<string, MessageKey> = {
  booked: 'appts.booked',
  bookedNoSms: 'appts.bookedNoSms',
  cancelled: 'appts.cancelled',
  saved: 'common.saved',
  done: 'admin.done',
  fileCreated: 'records.createdNotice',
  linked: 'records.linked',
  visitSaved: 'visit.saved',
  rxIssued: 'rx.issued',
  labIssued: 'lab.issued',
  voided: 'rx.voidedNotice',
};

export function noticeFrom(ctx: Ctx): MessageKey | undefined {
  return NOTICES[ctx.query.get('ok') ?? ''];
}

/** Error codes passed through redirects must be real message keys. */
export function errorFrom(ctx: Ctx): MessageKey | undefined {
  const e = ctx.query.get('error') ?? '';
  return isMessageKey(e) ? e : undefined;
}

export const formValue = (ctx: Ctx, name: string): string => field(ctx.form, name);

export function uuidParam(ctx: Ctx, name: string): string {
  const v = ctx.params[name];
  if (!isUuid(v)) throw notFound();
  return v;
}

export async function startSession(ctx: Ctx, userId: string, role: Role): Promise<void> {
  const token = await createSession(ctx.deps.db, userId, role);
  setCookie(ctx, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', maxAgeSeconds: sessionMaxAgeSeconds(role) });
}

export function homeFor(ctx: Ctx, role: Role): string {
  return href(ctx, role === 'doctor' ? '/dashboard' : role === 'admin' ? '/admin' : '/');
}

/** Turn a stored locale-less path ("/dashboard") into the current-locale URL. */
export function localized(ctx: Ctx, path: string): string {
  if (path.startsWith('/en/') || path === '/en') return path;
  return href(ctx, path);
}
