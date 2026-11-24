import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon, input, passwordInput, errorSummary } from '../components.js';
import { formatDateTime, type MessageKey } from '../../i18n/index.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { OwnDoctor } from '../../services/doctors.js';
import type { TeamMember } from '../../services/team.js';
import { MAX_TEAM } from '../../services/team.js';
import { shell } from './dashboard.js';

function accessChoice(ctx: Ctx, name: string, current: string, idPrefix: string): SafeHtml {
  return html`${(['schedule', 'files'] as const).map(
    (a) => html`<label class="pay-option"><input type="radio" name="${name}" value="${a}" id="${idPrefix}-${a}"${attrIf(current === a, 'checked')} required>
      <span class="stack-sm"><strong>${ctx.t(`team.access.${a}`)}</strong><span class="small muted">${ctx.t(a === 'schedule' ? 'team.access.scheduleHint' : 'team.access.filesHint')}</span></span></label>`,
  )}`;
}

export function teamPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  members: TeamMember[],
  o: { values?: Record<string, string>; errors?: FieldErrors; invite?: { link: string; name: string }; notice?: { kind: 'success' | 'error'; key: MessageKey } } = {},
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const v = o.values ?? {};
  const invite = o.invite
    ? html`<section class="panel stack invite-box" aria-live="polite">
        <h2 class="h3">${ctx.t('team.inviteTitle', { name: o.invite.name })}</h2>
        <p class="muted">${ctx.t('team.inviteLead')}</p>
        <input class="invite-link" readonly value="${o.invite.link}" dir="ltr" aria-label="${ctx.t('team.inviteTitle', { name: o.invite.name })}">
        <div class="row-wrap">
          <a class="btn btn-whatsapp" href="https://wa.me/?text=${encodeURIComponent(ctx.t('team.whatsappText', { link: o.invite.link }))}" target="_blank" rel="noopener noreferrer">${icon.chat}${ctx.t('team.sendWhatsapp')}</a>
        </div>
      </section>`
    : '';
  const content = html`
    <div class="stack-sm"><h1>${ctx.t('team.title')}</h1><p class="muted">${ctx.t('team.lead')}</p></div>
    ${invite}
    <section class="panel stack">
      ${members.length
        ? html`<ul class="appt-list">${members.map(
            (m) => html`<li class="appt-row team-row">
              <div class="stack-sm">
                <strong dir="auto">${m.full_name}</strong>
                <span class="muted small"><span dir="ltr">${formatEgyptMobile(m.phone_e164)}</span>${
                  m.invited ? html` · <span class="chip">${ctx.t('team.invited')}</span>` : m.last_seen ? html` · ${ctx.t('team.lastSeen')}: ${formatDateTime(m.last_seen, ctx.locale, tz)}` : ''}</span>
                <form method="post" action="${href(ctx, `/dashboard/team/${m.user_id}/access`)}" class="row-wrap">${csrfField(ctx)}
                  <label class="sr-only" for="acc-${m.user_id}">${ctx.t('team.access')}</label>
                  <select id="acc-${m.user_id}" name="access">${(['schedule', 'files'] as const).map((a) => html`<option value="${a}"${attrIf(m.access === a, 'selected')}>${ctx.t(`team.access.${a}`)}</option>`)}</select>
                  <button class="btn btn-outline btn-sm" type="submit">${ctx.t('team.changeAccess')}</button>
                </form>
              </div>
              <div class="stack-sm account-actions">
                ${m.invited
                  ? html`<form method="post" action="${href(ctx, `/dashboard/team/${m.user_id}/reinvite`)}">${csrfField(ctx)}<button class="btn btn-outline btn-sm" type="submit">${ctx.t('team.newLink')}</button></form>`
                  : ''}
                <form method="post" action="${href(ctx, `/dashboard/team/${m.user_id}/remove`)}">${csrfField(ctx)}
                  <button class="btn btn-ghost btn-sm danger" type="submit" data-confirm="${ctx.t('team.removeConfirm')}">${ctx.t('team.remove')}</button></form>
              </div>
            </li>`,
          )}</ul>`
        : html`<p class="muted">${ctx.t('team.none')}</p>`}
    </section>
    ${members.length < MAX_TEAM
      ? html`<form method="post" action="${href(ctx, '/dashboard/team')}" class="panel stack" novalidate>${csrfField(ctx)}
          <h2 class="h3">${icon.plus}${ctx.t('team.add')}</h2>
          ${o.errors && Object.keys(o.errors).length ? errorSummary(ctx, o.errors) : ''}
          <div class="form-grid">
            ${input(ctx, { name: 'fullName', label: ctx.t('team.name'), value: v['fullName'], maxlength: 120, autocomplete: 'off', errors: o.errors, required: true })}
            ${input(ctx, { name: 'phone', label: ctx.t('team.phone'), type: 'tel', value: v['phone'], prefix: '+20', inputmode: 'tel', autocomplete: 'off', errors: o.errors, required: true })}
          </div>
          <fieldset class="stack-sm pay-choice"><legend class="label">${ctx.t('team.access')}</legend>
            ${accessChoice(ctx, 'access', v['access'] ?? 'schedule', 'new')}
            ${o.errors?.['access'] ? html`<p class="field-error" role="alert">${ctx.t(o.errors['access'])}</p>` : ''}
          </fieldset>
          <p class="hint">${icon.lock} ${ctx.t('team.doctorOnly')}</p>
          <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('team.create')}</button></div>
        </form>`
      : ''}`;
  return shell(ctx, doctor, 'team', content, o.notice);
}

export function teamJoinPage(ctx: Ctx, o: { token: string; name: string; doctor: string; phone: string; error?: MessageKey } | null): SafeHtml {
  const body = o
    ? html`<div class="container page narrow"><form method="post" action="${href(ctx, `/team/join/${o.token}`)}" class="panel stack" novalidate>
        ${csrfField(ctx)}
        <h1>${ctx.t('team.joinTitle', { doctor: o.doctor })}</h1>
        <p class="muted">${ctx.t('team.joinLead', { phone: `⁦${formatEgyptMobile(o.phone)}⁩` })}</p>
        ${o.error ? alert('error', ctx.t(o.error)) : ''}
        ${passwordInput(ctx, { name: 'password', label: ctx.t('auth.password'), autocomplete: 'new-password', hint: ctx.t('auth.passwordHint'), required: true })}
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('team.joinButton')}</button>
      </form></div>`
    : html`<div class="container page narrow"><div class="panel stack">${alert('error', ctx.t('team.joinExpired'))}
        <a class="btn btn-outline" href="${href(ctx, '/login')}">${ctx.t('nav.signIn')}</a></div></div>`;
  return layout(ctx, { title: `${ctx.t('team.title')} — ${ctx.t('brand')}`, body, noindex: true });
}
