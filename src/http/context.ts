import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import type { Session, SessionUser, Role } from '../auth/sessions.js';
import type { FormFields, UploadedFile } from './body.js';
import type { Locale, Translator } from '../i18n/index.js';
import type { SmsProvider } from '../services/sms.js';
import type { EmailProvider } from '../services/email.js';
import type { FileStorage } from '../storage/files.js';
import type { SpecialtyAdvisor } from '../services/symptomChecker.js';
import { serializeCookie, type CookieOptions } from './cookies.js';
import { forbidden } from './errors.js';

export interface Deps {
  cfg: Config;
  db: Db;
  sms: SmsProvider;
  email: EmailProvider;
  storage: FileStorage;
  now: () => Date;
  /** Symptom checker AI; null/undefined when no API key is configured. */
  ai?: SpecialtyAdvisor | null;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  deps: Deps;
  method: string;
  url: URL;
  /** Path without the locale prefix, e.g. '/search'. */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  locale: Locale;
  t: Translator;
  cookies: Record<string, string>;
  session: Session | null;
  user: SessionUser | null;
  /** Conversations with something new for the signed-in patient or doctor (menu badge). */
  unreadMessages: number;
  csrfToken: string;
  form: FormFields;
  files: UploadedFile[];
  responseCookies: string[];
}

/** Locale-aware internal link. Arabic is the default and has no prefix. */
export function href(ctx: Pick<Ctx, 'locale'>, path: string, query?: Record<string, string | number | undefined | null>): string {
  const base = ctx.locale === 'en' ? (path === '/' ? '/en' : `/en${path}`) : path;
  if (!query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Same page in the other language (for the language switcher). */
export function alternateHref(ctx: Pick<Ctx, 'locale' | 'path' | 'url'>): string {
  const search = ctx.url.search;
  const p = ctx.path === '/' ? '' : ctx.path;
  return ctx.locale === 'ar' ? `/en${p}${search}` : `${p || '/'}${search}`;
}

export function setCookie(ctx: Ctx, name: string, value: string, opts: Omit<CookieOptions, 'secure'>): void {
  ctx.responseCookies.push(serializeCookie(name, value, { ...opts, secure: ctx.deps.cfg.PUBLIC_ORIGIN.startsWith('https://') }));
}

export function requireUser(ctx: Ctx, ...roles: Role[]): SessionUser {
  if (!ctx.user) throw new LoginRequired();
  if (roles.length && !roles.includes(ctx.user.role)) throw forbidden(`role ${ctx.user.role} not in ${roles.join(',')}`);
  return ctx.user;
}

/** Thrown to send the visitor to the sign-in page and back. */
export class LoginRequired extends Error {
  constructor() {
    super('login required');
  }
}

/** Accept only same-site relative paths as redirect targets (no open redirects). */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\r\n]/.test(value)) return null;
  return value;
}
