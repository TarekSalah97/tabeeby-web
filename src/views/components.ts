import { html, trusted, attrIf, type SafeHtml, type HtmlValue } from './html.js';
import type { Ctx } from '../http/context.js';
import { href } from '../http/context.js';
import type { MessageKey } from '../i18n/index.js';
import { CSRF_FIELD } from '../auth/csrf.js';
import type { FieldErrors } from '../services/accounts.js';
import type { District, ReferenceData } from '../services/reference.js';
import { displayYears } from '../domain/experience.js';
import { docField, type DocKind } from '../domain/documents.js';

export const icon = {
  user: trusted(
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>',
  ),
  stethoscope: trusted(
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v5a5 5 0 0 0 10 0V3"></path><path d="M10 13v3a5 5 0 0 0 10 0v-2"></path><circle cx="20" cy="12" r="2"></circle></svg>',
  ),
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
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="4"></rect><path d="M8 3v4M16 3v4M12 10v7M8.5 13.5h7"></path></svg>',
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
  // Logo: a booking calendar with a medical cross and a tick ("booked").
  logo: trusted(
    '<svg class="logo-mark" width="34" height="34" viewBox="0 0 36 36" aria-hidden="true"><rect class="lm-bg" width="36" height="36" rx="9" fill="none"></rect><rect x="3" y="6" width="30" height="27" rx="7" fill="currentColor"></rect><path d="M3 14v-1a7 7 0 0 1 7-7h16a7 7 0 0 1 7 7v1z" fill="#0A4F44"></path><rect x="10" y="2.5" width="3.6" height="8" rx="1.8" fill="#0A4F44"></rect><rect x="22.4" y="2.5" width="3.6" height="8" rx="1.8" fill="#0A4F44"></rect><rect x="15.5" y="17" width="5" height="13" rx="1.3" fill="#fff"></rect><rect x="11.5" y="21" width="13" height="5" rx="1.3" fill="#fff"></rect><circle cx="29" cy="29" r="6.6" fill="#F2705E" stroke="#fff" stroke-width="1.6"></circle><path d="M25.9 29.1l2.2 2.2 4-4.4" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
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
  clock: trusted(
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
  ),
  menu: trusted(
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
  ),
  record: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2.5"></rect><path d="M9 4.5V3h6v1.5M12 9.5v5M9.5 12h5M9 18h6"></path></svg>',
  ),
  sparkle: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"></path><path d="M18.5 16v4M16.5 18h4"></path></svg>',
  ),
  cash: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle><path d="M6 9.5v5M18 9.5v5"></path></svg>',
  ),
  card: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"></rect><path d="M2.5 10h19M6.5 15h4"></path></svg>',
  ),
  instapay: trusted(
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"></rect><path d="M13 7l-3 5h4l-3 5"></path></svg>',
  ),
  lock: trusted(
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>',
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
  /** id of a <datalist> with suggestions. */
  list?: string;
  errors?: FieldErrors | undefined;
  extra?: SafeHtml;
  /** Extra attributes on the <input>, e.g. dictateAttrs(). */
  attrs?: SafeHtml;
}

/**
 * Marks a text box for voice typing (doctor pages only; public/app.js adds the microphone button).
 * mode 'digits' keeps only the numbers spoken (mobile numbers) and replaces what was there.
 */
export function dictateAttrs(ctx: Ctx, mode: 'text' | 'digits' = 'text', short = false): SafeHtml {
  return html`data-dictate data-dictate-start="${ctx.t(short ? 'dictate.short' : 'dictate.start')}" data-dictate-stop="${ctx.t('dictate.stop')}" data-dictate-note="${ctx.t('dictate.note')}"
    data-dictate-lang="${ctx.locale === 'ar' ? 'ar-EG' : 'en-US'}" data-dictate-other="${ctx.t('dictate.otherLang')}" data-dictate-denied="${ctx.t('dictate.denied')}"${mode === 'digits' ? html` data-dictate-mode="digits"` : ''}`;
}

export type SearchTab = 'doctors' | 'pharmacy' | 'lab' | 'radiology';

/**
 * One row of tabs for everything people search for: doctors, pharmacies, labs and scan centres.
 * Shown above the home search box, on the doctor search page and on the pharmacy/lab/scan pages.
 */
export function searchTabs(ctx: Ctx, current: SearchTab): SafeHtml {
  const tabs: [SearchTab, string, MessageKey, SafeHtml][] = [
    ['doctors', '/search', 'tabs.doctors', icon.search],
    ['pharmacy', '/pharmacies', 'tabs.pharmacies', icon.pill],
    ['lab', '/labs', 'tabs.labs', icon.flask],
    ['radiology', '/scan-centres', 'tabs.scans', icon.scan],
  ];
  return html`<nav class="search-tabs" aria-label="${ctx.t('tabs.label')}">${tabs.map(
    ([k, path, label, ic]) => html`<a href="${href(ctx, path)}"${attrIf(k === current, 'aria-current="page"')}>${ic}<span>${ctx.t(label)}</span></a>`,
  )}</nav>`;
}

/**
 * Upload boxes for sign-up documents. On phones the picker offers the camera too.
 * `onlyFor` marks a document needed only for one facility kind (the page script shows or hides it).
 */
export function documentFields(ctx: Ctx, specs: readonly { kind: DocKind; required: boolean }[], errors: FieldErrors | undefined, onlyFor: Partial<Record<DocKind, string>> = {}): SafeHtml {
  return html`<fieldset class="stack docs-fieldset span-all">
    <legend>${ctx.t('docs.title')}</legend>
    <p class="hint">${ctx.t('docs.lead')}</p>
    <div class="docs-grid">${specs.map((d) => {
      const name = docField(d.kind);
      const id = `doc-${d.kind}`;
      const label = ctx.t(`docs.kind.${d.kind}` as MessageKey);
      return html`<div class="field doc-field${errors?.[name] ? ' has-error' : ''}"${onlyFor[d.kind] ? html` data-only-kind="${onlyFor[d.kind]}"` : ''}>
        <label class="dropzone" for="${id}">
          ${icon.upload}
          <span class="stack-sm"><strong>${label}</strong>
            <span class="hint">${d.required ? html`<span class="req-tag">${ctx.t('docs.required.tag')}</span>` : ctx.t('docs.optional')} · ${ctx.t('docs.takePhoto')}</span>
            <span class="file-name small" data-file-name></span></span>
          <input id="${id}" name="${name}" type="file" accept="image/*,application/pdf"${attrIf(d.required && !onlyFor[d.kind], 'required')}>
        </label>
        ${fieldError(ctx, errors, name)}
      </div>`;
    })}</div>
  </fieldset>`;
}

export function input(ctx: Ctx, o: InputOpts): SafeHtml {
  const err = o.errors?.[o.name];
  const id = `${o.idPrefix ?? ''}${o.name}`;
  const describedBy = [o.hint ? `${id}-hint` : '', err ? `${id}-error` : ''].filter(Boolean).join(' ');
  const control = html`<input id="${id}" name="${o.name}" type="${o.type ?? 'text'}" value="${o.value ?? ''}"
    ${o.autocomplete ? html`autocomplete="${o.autocomplete}"` : ''} ${o.inputmode ? html`inputmode="${o.inputmode}"` : ''}
    ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''} ${o.maxlength ? html`maxlength="${o.maxlength}"` : ''} ${o.list ? html`list="${o.list}"` : ''}
    ${describedBy ? html`aria-describedby="${describedBy}"` : ''}${attrIf(!!err, 'aria-invalid="true"')}${attrIf(!!o.required, 'required')} ${o.attrs ?? ''}>`;
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
/** "Smouha, Alexandria" / "سموحة، الإسكندرية" — district names repeat across Egypt, so the city goes with them. */
export function placeName(ctx: Ctx, d: District): string {
  return ctx.locale === 'ar' ? `${d.name_ar}، ${d.governorate_ar}` : `${d.name_en}, ${d.governorate_en}`;
}

/** For map links: always in English, with the city. */
export const placeForMaps = (d: District | undefined): string => (d ? `${d.name_en}, ${d.governorate_en}` : '');

/** Every district, grouped under its governorate (launch city first), sorted in the reader's language. */
export function districtOptionGroups(ctx: Ctx, ref: ReferenceData, by: 'id' | 'slug'): { group: string; options: Option[] }[] {
  const ar = ctx.locale === 'ar';
  return ref.governorates.map((g) => ({
    group: ar ? g.name_ar : g.name_en,
    options: g.districts
      .map((d) => ({ value: by === 'id' ? String(d.id) : d.slug, label: ar ? d.name_ar : d.name_en }))
      .sort((a, b) => a.label.localeCompare(b.label, ar ? 'ar' : 'en')),
  }));
}

/** The governorates as options (value = slug). */
export function cityOptions(ctx: Ctx, ref: ReferenceData): Option[] {
  return ref.governorates.map((g) => ({ value: g.slug, label: ctx.locale === 'ar' ? g.name_ar : g.name_en }));
}

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

/** "2015 – 2019" or "2021 – Present" for a doctor's position. */
export function yearsLabel(ctx: Ctx, p: { start: string; end: string | null }): string {
  const y = displayYears(p, ctx.deps.now());
  return y.to === null ? `${y.from} – ${ctx.t('common.present')}` : y.from === y.to ? y.from : `${y.from} – ${y.to}`;
}

/** The doctor's photo when they added one, otherwise their initials. */
export function doctorAvatar(ctx: Ctx, d: { slug: string; fullName: string; photoVersion: number | null }, size: '' | 'xl' = ''): SafeHtml {
  return d.photoVersion
    ? html`<img class="avatar${size ? ` ${size}` : ''} photo" src="${href(ctx, `/photos/doctors/${d.slug}`, { v: String(d.photoVersion) })}" alt="${ctx.t('photo.alt', { name: d.fullName })}" width="${size ? 128 : 84}" height="${size ? 128 : 84}" loading="lazy">`
    : html`<div class="avatar${size ? ` ${size}` : ''}" aria-hidden="true">${initials(d.fullName)}</div>`;
}

/**
 * Subspecialties per specialty for the page script that shows only the chosen specialty's
 * subspecialties (JSON in a data attribute; the HTML escaping is undone by getAttribute).
 */
export function subMap(ctx: Ctx, ref: { specialties: { id: number; slug: string; name_en: string; name_ar: string; subspecialties: { id: number; slug: string; name_en: string; name_ar: string }[] }[] }, key: 'id' | 'slug'): string {
  const label = (x: { name_en: string; name_ar: string }) => (ctx.locale === 'ar' ? x.name_ar : x.name_en);
  return JSON.stringify(Object.fromEntries(ref.specialties.map((s) => [String(s[key]), s.subspecialties.map((x) => [String(x[key]), label(x)])])));
}

/** "New visit", "Follow-up", or the doctor's own service name. */
export function visitLabel(ctx: Ctx, a: { visit_type: string; service_name: string | null; service_name_ar?: string | null }): string {
  if (a.visit_type === 'service' && a.service_name) return ctx.locale === 'ar' ? a.service_name_ar ?? a.service_name : a.service_name;
  return ctx.t(a.visit_type === 'follow_up' ? 'book.followUp' : 'book.new');
}

export const WEEKDAY_SHORT: Record<'en' | 'ar', string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
};
const MONTHS: Record<'en' | 'ar', string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};

/**
 * A large month calendar made of plain links (works without JavaScript, easy to tap on a phone).
 * Weeks start on Saturday, as in Egypt. Days outside [min, max] are shown but not clickable;
 * days the clinic is closed are greyed (still clickable, the clinic may add extra hours).
 */
export function monthCalendar(
  ctx: Ctx,
  o: { month: string; selected: string; min: string; max: string; today: string; openWeekdays?: Set<number>; dayHref: (d: string) => string; monthHref: (m: string) => string },
): SafeHtml {
  const [y, m] = o.month.split('-').map(Number) as [number, number];
  const first = `${o.month}-01`;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const lead = (firstWeekday + 1) % 7; // columns before day 1 when weeks start on Saturday
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const canPrev = `${prev}-31` >= o.min;
  const canNext = `${next}-01` <= o.max;
  const order = [6, 0, 1, 2, 3, 4, 5];
  const cells: SafeHtml[] = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span class="cal-cell cal-empty" aria-hidden="true"></span>`);
  for (let d = 1; d <= daysIn; d++) {
    const date = `${o.month}-${String(d).padStart(2, '0')}`;
    const wd = (firstWeekday + d - 1) % 7;
    const inRange = date >= o.min && date <= o.max;
    const closed = o.openWeekdays && !o.openWeekdays.has(wd);
    const cls = ['cal-cell', date === o.selected ? 'is-selected' : '', date === o.today ? 'is-today' : '', closed ? 'is-closed' : ''].filter(Boolean).join(' ');
    const label = `${d} ${MONTHS[ctx.locale][m - 1]}`;
    cells.push(
      inRange
        ? html`<a class="${cls}" href="${o.dayHref(date)}" aria-label="${label}"${date === o.selected ? html` aria-current="date"` : ''}>${d}</a>`
        : html`<span class="${cls} is-out" aria-disabled="true">${d}</span>`,
    );
  }
  void first;
  return html`<div class="cal" role="group" aria-label="${MONTHS[ctx.locale][m - 1]} ${y}">
    <div class="cal-head">
      ${canPrev ? html`<a class="cal-nav" href="${o.monthHref(prev)}" aria-label="${ctx.t('cal.prev')}">‹</a>` : html`<span class="cal-nav is-out">‹</span>`}
      <strong class="cal-title">${MONTHS[ctx.locale][m - 1]} ${y}</strong>
      ${canNext ? html`<a class="cal-nav" href="${o.monthHref(next)}" aria-label="${ctx.t('cal.next')}">›</a>` : html`<span class="cal-nav is-out">›</span>`}
    </div>
    <div class="cal-grid">
      ${order.map((wd) => html`<span class="cal-wd">${WEEKDAY_SHORT[ctx.locale][wd]}</span>`)}
      ${cells}
    </div>
    ${o.openWeekdays ? html`<p class="small muted cal-legend"><span class="cal-dot"></span>${ctx.t('cal.closedLegend')}</p>` : ''}
  </div>`;
}
