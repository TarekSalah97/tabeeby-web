import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, consentField, csrfField, icon, input, passwordInput, errorSummary } from '../components.js';
import { emailEnabled } from '../../config.js';
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
      ${emailEnabled(ctx.deps.cfg) ? html`<a class="btn btn-ghost btn-block" href="${href(ctx, '/login/email', { next: o.next ?? undefined })}">${ctx.t('loginEmail.link')}</a>` : ''}
      <p class="center muted">${ctx.t('auth.noAccount')} <a href="${href(ctx, '/join', { next: o.next ?? undefined })}">${ctx.t('nav.signUp')}</a></p>
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
      ${errorSummary(ctx, o.errors, { reenter: ['password'] })}
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

/** "Enter the 6-digit code we emailed to a•••@gmail.com" — for booking without an account and for email sign-in. */
export function emailCodePage(
  ctx: Ctx,
  o: { action: string; maskedEmail: string; title: MessageKey; lead: MessageKey; error?: MessageKey; next?: string | null; startOver: string },
): SafeHtml {
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t(o.title)}</h1>
      <p class="muted">${ctx.t(o.lead, { email: o.maskedEmail })}</p>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${o.action}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        ${input(ctx, { name: 'code', label: ctx.t('verify.code'), inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('verify.submit')}</button>
      </form>
      <p class="hint center">${ctx.t('emailCode.checkSpam')}</p>
      <p class="center"><a href="${o.startOver}">${ctx.t('emailCode.startOver')}</a></p>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t(o.title)} — ${ctx.t('brand')}`, body, noindex: true });
}

export function loginEmailPage(ctx: Ctx, o: { email?: string; error?: MessageKey; next?: string | null }): SafeHtml {
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t('loginEmail.title')}</h1>
      <p class="muted">${ctx.t('loginEmail.lead')}</p>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${href(ctx, '/login/email')}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${o.next ? html`<input type="hidden" name="next" value="${o.next}">` : ''}
        ${input(ctx, { name: 'email', label: ctx.t('guest.email'), type: 'email', value: o.email, autocomplete: 'email', inputmode: 'email', maxlength: 254, required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('loginEmail.send')}</button>
      </form>
      <p class="center"><a href="${href(ctx, '/login', { next: o.next ?? undefined })}">${ctx.t('loginEmail.usePassword')}</a></p>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('loginEmail.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function setPasswordPage(ctx: Ctx, o: { error?: MessageKey }): SafeHtml {
  const body = html`<div class="container page auth-page">
    <div class="auth-card">
      <h1>${ctx.t('password.setTitle')}</h1>
      <p class="muted">${ctx.t('password.setLead')}</p>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${href(ctx, '/account/password')}" class="stack" novalidate>
        ${csrfField(ctx)}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'new-password', hint: ctx.t('auth.passwordHint'), required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('password.setButton')}</button>
      </form>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('password.setTitle')} — ${ctx.t('brand')}`, body, noindex: true });
}

/**
 * Shown instead of a bare redirect when a visitor opens a patient-only page
 * (My appointments, My prescriptions & tests) without being signed in as a patient.
 */
export function patientGatePage(ctx: Ctx, kind: 'appointments' | 'prescriptions' | 'messages', returnTo: string): SafeHtml {
  const staff = ctx.user && ctx.user.role !== 'patient';
  const title: MessageKey = `gate.${kind}Title`;
  const body = html`<div class="container page auth-page">
    <div class="auth-card gate">
      <span class="gate-icon" aria-hidden="true">${kind === 'appointments' ? icon.calendar : kind === 'messages' ? icon.chat : icon.check}</span>
      <h1>${ctx.t(title)}</h1>
      ${staff
        ? html`<p class="muted">${ctx.t('gate.staffLead')}</p>
           <a class="btn btn-primary btn-lg btn-block" href="${href(ctx, ctx.user!.role === 'doctor' ? '/dashboard' : ctx.user!.role === 'facility' ? '/facility' : '/admin')}">${ctx.t(ctx.user!.role === 'admin' ? 'nav.admin' : 'nav.dashboard')}</a>`
        : html`<p class="muted">${ctx.t(`gate.${kind}Lead`)}</p>
           <a class="btn btn-primary btn-lg btn-block" href="${href(ctx, '/login', { next: returnTo })}">${ctx.t('gate.signIn')}</a>
           <a class="btn btn-outline btn-lg btn-block" href="${href(ctx, '/signup', { next: returnTo })}">${ctx.t('gate.signUp')}</a>
           <p class="hint center">${ctx.t('gate.free')}</p>
           <p class="center muted small">${ctx.t('auth.areYouDoctor')} <a href="${href(ctx, '/login')}">${ctx.t('gate.doctorSignIn')}</a></p>`}
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t(title)} — ${ctx.t('brand')}`, body, noindex: true });
}

/** "Create account": choose patient or doctor first (pharmacies and labs have a smaller link). */
export function joinChoicePage(ctx: Ctx, next: string | null): SafeHtml {
  const body = html`<div class="container page narrow stack-lg">
    <div class="center stack-sm"><h1>${ctx.t('joinChoice.title')}</h1><p class="muted">${ctx.t('joinChoice.lead')}</p></div>
    <div class="join-choices">
      <a class="panel join-choice" href="${href(ctx, '/signup', { next: next ?? undefined })}">
        ${icon.user}<strong>${ctx.t('joinChoice.patient')}</strong><span class="muted">${ctx.t('joinChoice.patientLead')}</span>
        <span class="btn btn-primary btn-block">${ctx.t('joinChoice.patientCta')}</span>
      </a>
      <a class="panel join-choice" href="${href(ctx, '/for-doctors/join')}">
        ${icon.stethoscope}<strong>${ctx.t('joinChoice.doctor')}</strong><span class="muted">${ctx.t('joinChoice.doctorLead')}</span>
        <span class="btn btn-outline btn-block">${ctx.t('joinChoice.doctorCta')}</span>
      </a>
    </div>
    <p class="center muted">${ctx.t('joinChoice.facility')} <a href="${href(ctx, '/facilities/join')}">${ctx.t('joinChoice.facilityLink')}</a></p>
    <p class="center muted">${ctx.t('joinChoice.haveAccount')} <a href="${href(ctx, '/login', { next: next ?? undefined })}">${ctx.t('nav.signIn')}</a></p>
  </div>`;
  return layout(ctx, { title: `${ctx.t('joinChoice.title')} — ${ctx.t('brand')}`, body });
}
