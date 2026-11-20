import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, statusChip } from '../components.js';
import { formatDate, formatTime, type MessageKey } from '../../i18n/index.js';
import type { BookingTarget, PatientAppointment } from '../../services/booking.js';
import { money } from './public.js';

export function confirmPage(ctx: Ctx, target: BookingTarget, o: { error?: MessageKey; reason?: string; visitType?: string }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const visit = o.visitType === 'follow_up' ? 'follow_up' : 'new';
  const body = html`<div class="container page narrow">
    <div class="panel stack">
      <h1>${ctx.t('book.title')}</h1>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <dl class="summary">
        <div><dt>${ctx.t('book.with')}</dt><dd><a href="${href(ctx, `/doctors/${target.doctorSlug}`)}">${target.doctorName}</a></dd></div>
        <div><dt>${ctx.t('book.when')}</dt><dd>${formatDate(target.startsAt, ctx.locale, tz)} · ${formatTime(target.startsAt, ctx.locale, tz)}</dd></div>
        <div><dt>${ctx.t('book.where')}</dt><dd>${target.clinicName}<br><span class="muted">${target.clinicAddress}</span></dd></div>
        <div><dt>${ctx.t('book.fee')}</dt><dd>${money(ctx, target.fee)} · ${ctx.t('doctor.payAtClinic')}</dd></div>
      </dl>
      <form method="post" action="${href(ctx, '/book')}" class="stack">
        ${csrfField(ctx)}
        <input type="hidden" name="clinic" value="${target.clinicId}">
        <input type="hidden" name="start" value="${target.startsAt.toISOString()}">
        <fieldset class="stack-sm">
          <legend class="label">${ctx.t('book.visitType')}</legend>
          <div class="segmented">
            <label><input type="radio" name="visitType" value="new"${visit === 'new' ? html` checked` : ''}><span>${ctx.t('book.new')}</span></label>
            <label><input type="radio" name="visitType" value="follow_up"${visit === 'follow_up' ? html` checked` : ''}><span>${ctx.t('book.followUp')}</span></label>
          </div>
        </fieldset>
        <div class="field">
          <label for="reason">${ctx.t('book.reason')} <span class="muted">(${ctx.t('common.optional')})</span></label>
          <textarea id="reason" name="reason" maxlength="200" rows="3" aria-describedby="reason-hint">${o.reason ?? ''}</textarea>
          <p class="hint" id="reason-hint">${ctx.t('book.reasonHint')}</p>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('book.confirm')}</button>
        <p class="hint center">${ctx.t('book.cancelPolicy', { hours: ctx.deps.cfg.CANCEL_CUTOFF_HOURS })}</p>
      </form>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('book.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function appointmentsPage(ctx: Ctx, list: PatientAppointment[], o: { notice?: MessageKey; error?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const now = ctx.deps.now().getTime();
  const upcoming = list.filter((a) => a.starts_at.getTime() >= now && (a.status === 'confirmed' || a.status === 'arrived')).reverse();
  const past = list.filter((a) => !upcoming.includes(a));
  const row = (a: PatientAppointment, canCancel: boolean) => html`<li class="appt-row">
    <div class="stack-sm">
      <strong>${formatDate(a.starts_at, ctx.locale, tz)} · ${formatTime(a.starts_at, ctx.locale, tz)}</strong>
      <span><a href="${href(ctx, `/doctors/${a.doctor_slug}`)}">${a.doctor_name}</a> · ${a.clinic_name}</span>
      <span class="muted">${a.clinic_address} · ${money(ctx, a.fee_egp)}</span>
    </div>
    <div class="row-wrap">${statusChip(ctx, a.status)}
      ${canCancel
        ? html`<form method="post" action="${href(ctx, `/appointments/${a.id}/cancel`)}">${csrfField(ctx)}
            <button class="btn btn-outline" type="submit">${ctx.t('appts.cancel')}</button></form>`
        : ''}</div>
  </li>`;
  const body = html`<div class="container page narrow stack-lg">
    <h1>${ctx.t('appts.title')}</h1>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${ctx.user && !ctx.user.phoneVerified && ctx.deps.cfg.SMS_PROVIDER !== 'none' ? alert('warning', html`<a href="${href(ctx, '/verify-phone')}">${ctx.t('book.verifyFirst')}</a>`) : ''}
    <section class="stack"><h2>${ctx.t('appts.upcoming')}</h2>
      ${upcoming.length ? html`<ul class="appt-list">${upcoming.map((a) => row(a, a.status === 'confirmed'))}</ul>`
        : html`<div class="empty"><p>${ctx.t('appts.none')}</p><a class="btn btn-primary" href="${href(ctx, '/search')}">${ctx.t('appts.findDoctor')}</a></div>`}
    </section>
    ${past.length ? html`<section class="stack"><h2>${ctx.t('appts.past')}</h2><ul class="appt-list">${past.map((a) => row(a, false))}</ul></section>` : ''}
  </div>`;
  return layout(ctx, { title: `${ctx.t('appts.title')} — ${ctx.t('brand')}`, body, noindex: true });
}
