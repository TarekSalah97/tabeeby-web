import { html, trusted, attrIf, type SafeHtml, type HtmlValue } from './html.js';
import type { Ctx } from '../http/context.js';
import { href } from '../http/context.js';
import type { MessageKey } from '../i18n/index.js';
import { CSRF_FIELD } from '../auth/csrf.js';
import type { FieldErrors } from '../services/accounts.js';

export const icon = {
  pill: trusted(
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path></svg>',
  ),
  flask: trusted(
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"></path><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"></path><path d="M7 15h10"></path></svg>',
  ),
  scan: trusted(
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  ),
  chat: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>',
  ),
  plus: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
  ),
  logoSmall: trusted(
    '<svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="10" fill="currentColor"></rect><path d="M18 9v18M9 18h18" stroke="#fff" stroke-width="4" stroke-linecap="round"></path></svg>',
  ),
  star: trusted(
    '<svg class="star" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8L12 2.8Z" fill="currentColor"></path></svg>',
  ),
  phone: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"></path></svg>',
  ),
  directions: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>',
  ),
  repeat: trusted(
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>',
  ),
  bell: trusted(
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>',
  ),
  logo: trusted(
    '<svg class="logo-mark" width="34" height="34" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="10" fill="currentColor"></rect><path d="M18 9v18M9 18h18" stroke="#fff" stroke-width="4" stroke-linecap="round"></path></svg>',
  ),
  search: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>',
  ),
  pin: trusted(
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>',
  ),
  shield: trusted(
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z" fill="currentColor"></path><path d="m8.5 12 2.5 2.5 4.5-5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  ),
  calendar: trusted(
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
  ),
  shieldOutline: trusted(
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>',
  ),
  wallet: trusted(
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"></rect><path d="M16 13h2M3 10h18"></path></svg>',
  ),
  check: trusted(
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
  ),
  arrow: trusted(
    '<svg class="flip-rtl" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>',
  ),
  chevronStart: trusted(
    '<svg class="flip-rtl" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>',
  ),
  chevronEnd: trusted(
    '<svg class="flip-rtl" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>',
  ),
  eye: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  ),
  upload: trusted(
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path></svg>',
  ),
};

export function csrfField(ctx: Ctx): SafeHtml {
  return html`<input type="hidden" name="${CSRF_FIELD}" value="${ctx.csrfToken}">`;
}

export function fieldError(ctx: Ctx, errors: FieldErrors | undefined, name: string, id = name): SafeHtml {
  const key = errors?.[name];
  return key ? html`<p class="field-error" id="${id}-error">${ctx.t(key)}</p>` : html``;
}

export interface InputOpts {
  name: string;
  /** Prefix for element ids when several forms on one page share field names. */
  idPrefix?: string;
  label: string;
  type?: string;
  value?: string;
  hint?: string;
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  placeholder?: string;
  maxlength?: number;
  prefix?: string;
  errors?: FieldErrors | undefined;
  extra?: SafeHtml;
}

export function input(ctx: Ctx, o: InputOpts): SafeHtml {
  const err = o.errors?.[o.name];
  const id = `${o.idPrefix ?? ''}${o.name}`;
  const describedBy = [o.hint ? `${id}-hint` : '', err ? `${id}-error` : ''].filter(Boolean).join(' ');
  const control = html`<input id="${id}" name="${o.name}" type="${o.type ?? 'text'}" value="${o.value ?? ''}"
    ${o.autocomplete ? html`autocomplete="${o.autocomplete}"` : ''} ${o.inputmode ? html`inputmode="${o.inputmode}"` : ''}
    ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''} ${o.maxlength ? html`maxlength="${o.maxlength}"` : ''}
    ${describedBy ? html`aria-describedby="${describedBy}"` : ''}${attrIf(!!err, 'aria-invalid="true"')}${attrIf(!!o.required, 'required')}>`;
  return html`<div class="field${err ? ' has-error' : ''}">
    <label for="${id}">${o.label}</label>
    ${o.prefix || o.extra ? html`<div class="input-group" dir="ltr">${o.prefix ? html`<span class="input-prefix">${o.prefix}</span>` : ''}${control}${o.extra ?? ''}</div>` : control}
    ${o.hint ? html`<p class="hint" id="${id}-hint">${o.hint}</p>` : ''}
    ${fieldError(ctx, o.errors, o.name, id)}
  </div>`;
}

export function passwordInput(ctx: Ctx, o: Omit<InputOpts, 'type' | 'extra'>): SafeHtml {
  return input(ctx, {
    ...o,
    type: 'password',
    extra: html`<button type="button" class="pw-toggle" data-pw-toggle="${o.name}" aria-pressed="false"
      aria-label="${ctx.t('auth.showPassword')}" data-label-show="${ctx.t('auth.showPassword')}" data-label-hide="${ctx.t('auth.hidePassword')}">${icon.eye}</button>`,
  });
}

export interface Option {
  value: string;
  label: string;
}

export function select(
  ctx: Ctx,
  o: { name: string; idPrefix?: string; label: string; options: (Option | { group: string; options: Option[] })[]; value?: string | string[]; multiple?: boolean; size?: number; hint?: string; errors?: FieldErrors | undefined; required?: boolean },
): SafeHtml {
  const selected = new Set(Array.isArray(o.value) ? o.value : o.value !== undefined ? [o.value] : []);
  const opt = (x: Option) => html`<option value="${x.value}"${attrIf(selected.has(x.value), 'selected')}>${x.label}</option>`;
  const err = o.errors?.[o.name];
  const id = `${o.idPrefix ?? ''}${o.name}`;
  return html`<div class="field${err ? ' has-error' : ''}">
    <label for="${id}">${o.label}</label>
    <select id="${id}" name="${o.name}"${attrIf(!!o.multiple, 'multiple')}${o.size ? html` size="${o.size}"` : ''}${attrIf(!!o.required, 'required')}
      ${o.hint ? html`aria-describedby="${id}-hint"` : ''}${attrIf(!!err, 'aria-invalid="true"')}>
      ${o.options.map((x) => ('group' in x ? html`<optgroup label="${x.group}">${x.options.map(opt)}</optgroup>` : opt(x)))}
    </select>
    ${o.hint ? html`<p class="hint" id="${id}-hint">${o.hint}</p>` : ''}
    ${fieldError(ctx, o.errors, o.name, id)}
  </div>`;
}

export function alert(kind: 'info' | 'success' | 'error' | 'warning', body: HtmlValue, title?: string): SafeHtml {
  return html`<div class="alert alert-${kind}" role="${kind === 'error' ? 'alert' : 'status'}">
    ${title ? html`<strong class="alert-title">${title}</strong>` : ''}<div>${body}</div></div>`;
}

export function consentField(ctx: Ctx, errors: FieldErrors | undefined, suffix?: string): SafeHtml {
  const err = errors?.['consent'];
  return html`<div class="field${err ? ' has-error' : ''}">
    <label class="check">
      <input type="checkbox" id="consent" name="consent" value="yes" required${attrIf(!!err, 'aria-invalid="true"')}>
      <span>${ctx.t('auth.consentPrefix')} <a href="${href(ctx, '/terms')}">${ctx.t('auth.terms')}</a> ${ctx.t('auth.and')}
      <a href="${href(ctx, '/privacy')}">${ctx.t('auth.privacy')}</a>${suffix ? html` ${suffix}` : '.'}</span>
    </label>
    ${fieldError(ctx, errors, 'consent')}
  </div>`;
}

export function initials(name: string): string {
  const parts = name.replace(/^(dr\.?|د\.?)\s*/i, '').split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => [...p][0] ?? '')
    .join('')
    .toUpperCase();
}

export function statusChip(ctx: Ctx, status: string): SafeHtml {
  return html`<span class="chip status-${status}">${ctx.t.dynamic(`status.${status}`)}</span>`;
}

export function t(ctx: Ctx, key: MessageKey, vars?: Record<string, string | number>): string {
  return ctx.t(key, vars);
}

/** "★ 4.6 (12 reviews)" — the stars are decorative; the text carries the meaning for screen readers. */
export function ratingBadge(ctx: Ctx, r: { avg: number; count: number } | null, opts: { compact?: boolean } = {}): SafeHtml {
  if (!r || r.count === 0) return html``;
  const avg = new Intl.NumberFormat(ctx.locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r.avg);
  const count = new Intl.NumberFormat(ctx.locale === 'ar' ? 'ar-EG' : 'en-GB').format(r.count);
  const label = r.count === 1 ? ctx.t('reviews.countOne', { avg }) : ctx.t('reviews.count', { avg, n: count });
  return html`<span class="rating${opts.compact ? ' compact' : ''}" title="${label}">${icon.star}<strong>${avg}</strong><span class="muted">(${count})</span><span class="sr-only">${label}</span></span>`;
}

/** Five stars filled up to `rating`, for a single review. */
export function starRow(ctx: Ctx, rating: number): SafeHtml {
  return html`<span class="star-row" role="img" aria-label="${ctx.t('reviews.stars', { n: rating })}">${[1, 2, 3, 4, 5].map(
    (n) => html`<span class="${n <= rating ? 'on' : 'off'}">${icon.star}</span>`,
  )}</span>`;
}

/** Opens the clinic in Google Maps (the patient's own app on phones). No data is sent from our side. */
export function directionsHref(address: string, district: string): string {
  const q = [address, district, 'Egypt'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * "Please fix the highlighted fields" plus a list of each problem, linking to its field,
 * so nobody has to hunt for a red field lower down the page. Passwords and chosen files
 * are cleared by the browser after an error, so the summary also says to re-enter them.
 */
export function errorSummary(ctx: Ctx, errors: FieldErrors | undefined, o: { idPrefix?: string; reenter?: ('password' | 'file')[] } = {}): SafeHtml {
  const entries = Object.entries(errors ?? {}).filter((e): e is [string, MessageKey] => !!e[1]);
  if (!entries.length) return html``;
  const reenter = (o.reenter ?? []).filter((r) => r === 'file' || !entries.some(([k]) => k === 'password'));
  return html`<div class="alert alert-error error-summary" role="alert" tabindex="-1">
    <strong class="alert-title">${ctx.t('common.fixErrors')}</strong>
    <ul>${entries.map(([name, key]) => html`<li><a href="#${o.idPrefix ?? ''}${name}">${ctx.t(key)}</a></li>`)}</ul>
    ${reenter.length ? html`<p class="small">${ctx.t(reenter.includes('file') ? 'common.reenterFile' : 'common.reenterPassword')}</p>` : ''}
  </div>`;
}
