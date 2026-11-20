import { en } from './en.js';
import { ar } from './ar.js';

export type Locale = 'ar' | 'en';
export type MessageKey = keyof typeof en;
export type Translator = ((key: MessageKey, vars?: Record<string, string | number>) => string) & {
  /** For keys that arrive as data (error codes); falls back to a generic message. */
  dynamic: (key: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, ar };

export const isMessageKey = (k: string): k is MessageKey => Object.prototype.hasOwnProperty.call(en, k);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function translator(locale: Locale): Translator {
  const dict = dictionaries[locale];
  const t = ((key: MessageKey, vars?: Record<string, string | number>) => interpolate(dict[key], vars)) as Translator;
  t.dynamic = (key, vars) => interpolate(isMessageKey(key) ? dict[key] : dict['error.badRequest'], vars);
  t.locale = locale;
  return t;
}

const intlLocale = (l: Locale) => (l === 'ar' ? 'ar-EG' : 'en-GB');

export function formatDate(d: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export function formatShortDate(d: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function formatTime(d: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Date with the year, for records: "20 November 2026". */
export function formatFullDate(d: Date, locale: Locale, tz: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function formatFullDateTime(d: Date, locale: Locale, tz: string): string {
  return `${formatFullDate(d, locale, tz)} · ${formatTime(d, locale, tz)}`;
}

export function formatDateTime(d: Date, locale: Locale, tz: string): string {
  return `${formatShortDate(d, locale, tz)} · ${formatTime(d, locale, tz)}`;
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

/** Pick the right column for bilingual reference data. */
export const pick = (locale: Locale, row: { name_en: string; name_ar: string }): string => (locale === 'ar' ? row.name_ar : row.name_en);
