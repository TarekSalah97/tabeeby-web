import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, consentField, csrfField, input, passwordInput } from '../components.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { MessageKey } from '../../i18n/index.js';
import { maskEgyptMobile } from '../../domain/phone.js';
import { DEMO_PASSWORD, DEMO_PATIENT_PHONE, DEMO_DOCTOR_PHONE } from '../../demo.js';

export function loginPage(ctx: Ctx, o: { phone?: string; error?: MessageKey; next?: string | null }): SafeHtml {
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t('auth.signInTitle')}</h1>
      ${ctx.deps.cfg.DEMO_MODE
        ? alert('info', html`${ctx.t('demo.patient')}: <span dir="ltr">${DEMO_PATIENT_PHONE}</span> · ${ctx.t('demo.doctor')}: <span dir="ltr">${DEMO_DOCTOR_PHONE}</span>`, ctx.t('demo.logins', { password: DEMO_PASSWORD }))
        : ''}
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${href(ctx, '/login')}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        ${input(ctx, { name: 'phone', label: ctx.t('auth.phone'), type: 'tel', value: o.phone, prefix: '+20', autocomplete: 'tel-national', inputmode: 'tel', hint: ctx.t('auth.phoneHint'), required: true })}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'current-password', required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('auth.submitSignIn')}</button>
      </form>
      <p class="center muted">${ctx.t('auth.noAccount')} <a href="${href(ctx, '/signup', { next: o.next ?? undefined })}">${ctx.t('nav.signUp')}</a></p>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('auth.signInTitle')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function signupPage(ctx: Ctx, o: { values?: Record<string, string>; errors?: FieldErrors; next?: string | null }): SafeHtml {
  const v = o.values ?? {};
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t('auth.signUpTitle')}</h1>
      <p class="muted">${ctx.t('auth.signUpLead')}</p>
      ${o.errors && Object.keys(o.errors).length ? alert('error', ctx.t('common.fixErrors')) : ''}
      <form method="post" action="${href(ctx, '/signup')}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        ${input(ctx, { name: 'fullName', label: ctx.t('auth.fullName'), value: v['fullName'], autocomplete: 'name', maxlength: 120, errors: o.errors, required: true })}
        ${input(ctx, { name: 'phone', label: ctx.t('auth.phone'), type: 'tel', value: v['phone'], prefix: '+20', autocomplete: 'tel-national', inputmode: 'tel', hint: ctx.t('auth.phoneHint'), errors: o.errors, required: true })}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'new-password', hint: ctx.t('auth.passwordHint'), errors: o.errors, required: true })}
        ${consentField(ctx, o.errors)}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('auth.submitSignUp')}</button>
      </form>
      <p class="center muted">${ctx.t('auth.haveAccount')} <a href="${href(ctx, '/login', { next: o.next ?? undefined })}">${ctx.t('nav.signIn')}</a></p>
      <p class="center muted">${ctx.t('auth.areYouDoctor')} <a href="${href(ctx, '/for-doctors/join')}">${ctx.t('auth.joinAsDoctor')}</a></p>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('auth.signUpTitle')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function verifyPage(ctx: Ctx, o: { error?: MessageKey; notice?: MessageKey; next?: string | null; demoCode?: string | null }): SafeHtml {
  const phone = ctx.user ? maskEgyptMobile(ctx.user.phone) : '';
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t('verify.title')}</h1>
      <p class="muted">${ctx.t('verify.lead', { phone })}</p>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
      ${o.demoCode ? alert('warning', ctx.t('demo.code', { code: o.demoCode })) : ''}
      <form method="post" action="${href(ctx, '/verify-phone')}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        ${input(ctx, { name: 'code', label: ctx.t('verify.code'), inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('verify.submit')}</button>
      </form>
      <form method="post" action="${href(ctx, '/verify-phone/resend')}" class="center">
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        <button class="btn btn-ghost" type="submit">${ctx.t('verify.resend')}</button>
      </form>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('verify.title')} — ${ctx.t('brand')}`, body, noindex: true });
}
