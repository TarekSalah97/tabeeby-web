import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, directionsHref, icon, statusChip, starRow } from '../components.js';
import { formatDate, formatTime, formatShortDate, type MessageKey } from '../../i18n/index.js';
import type { BookingTarget, PatientAppointment } from '../../services/booking.js';
import type { PatientWaitlistEntry } from '../../services/waitlist.js';
import type { ReviewTarget } from '../../services/reviews.js';
import { MAX_REVIEW_COMMENT } from '../../services/reviews.js';
import { zonedToUtc } from '../../domain/time.js';
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

export function appointmentsPage(
  ctx: Ctx,
  list: PatientAppointment[],
  waitlist: PatientWaitlistEntry[],
  o: { notice?: MessageKey; error?: MessageKey },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const now = ctx.deps.now().getTime();
  const upcoming = list.filter((a) => a.starts_at.getTime() >= now && (a.status === 'confirmed' || a.status === 'arrived')).reverse();
  const past = list.filter((a) => !upcoming.includes(a));
  const district = (a: PatientAppointment) => (ctx.locale === 'ar' ? a.district_ar : a.district_en);

  const upcomingRow = (a: PatientAppointment) => html`<li class="appt-card">
    <div class="appt-when"><strong>${formatDate(a.starts_at, ctx.locale, tz)}</strong><span class="appt-time">${formatTime(a.starts_at, ctx.locale, tz)}</span></div>
    <div class="stack-sm">
      <span><a href="${href(ctx, `/doctors/${a.doctor_slug}`)}" dir="auto"><strong>${a.doctor_name}</strong></a> · <span dir="auto">${a.clinic_name}</span></span>
      <span class="muted" dir="auto">${a.clinic_address} · ${district(a)} · ${money(ctx, a.fee_egp)}</span>
      <div>${statusChip(ctx, a.status)}</div>
    </div>
    <div class="appt-actions">
      <a class="btn btn-primary" href="${directionsHref(a.clinic_address, a.district_en)}" target="_blank" rel="noopener noreferrer">${icon.directions}${ctx.t('doctor.directions')}</a>
      ${a.clinic_phone ? html`<a class="btn btn-outline" href="tel:${a.clinic_phone}">${icon.phone}${ctx.t('doctor.call')}</a>` : ''}
      ${a.status === 'confirmed'
        ? html`<form method="post" action="${href(ctx, `/appointments/${a.id}/cancel`)}" class="inline-form">${csrfField(ctx)}
            <button class="btn btn-ghost" type="submit">${ctx.t('appts.cancel')}</button></form>`
        : ''}
    </div>
  </li>`;

  const pastRow = (a: PatientAppointment) => html`<li class="appt-row">
    <div class="stack-sm">
      <strong>${formatDate(a.starts_at, ctx.locale, tz)} · ${formatTime(a.starts_at, ctx.locale, tz)}</strong>
      <span><a href="${href(ctx, `/doctors/${a.doctor_slug}`)}" dir="auto">${a.doctor_name}</a> · <span dir="auto">${a.clinic_name}</span></span>
      <div class="row-wrap">${statusChip(ctx, a.status)}${a.my_rating ? starRow(ctx, a.my_rating) : ''}</div>
    </div>
    <div class="appt-actions">
      ${a.status === 'completed'
        ? html`<a class="btn ${a.my_rating ? 'btn-ghost' : 'btn-outline'}" href="${href(ctx, `/appointments/${a.id}/review`)}">${icon.star}${ctx.t(a.my_rating ? 'review.edit' : 'review.rate')}</a>`
        : ''}
      <a class="btn btn-primary" href="${href(ctx, `/doctors/${a.doctor_slug}`, { clinic: a.clinic_id })}#book-title">${icon.repeat}${ctx.t('appts.bookAgain')}</a>
    </div>
  </li>`;

  const waitRow = (w: PatientWaitlistEntry) => {
    const day = formatShortDate(zonedToUtc(w.wanted_date, '12:00', tz), ctx.locale, tz);
    return html`<li class="appt-row${w.status === 'notified' ? ' highlight' : ''}">
      <div class="stack-sm">
        <strong>${day}</strong>
        <span dir="auto">${w.doctor_name} · ${w.clinic_name}</span>
        <span class="${w.status === 'notified' ? 'avail' : 'muted'}">${ctx.t(w.status === 'notified' ? 'waitlist.opened' : 'waitlist.waiting')}</span>
      </div>
      <div class="appt-actions">
        ${w.status === 'notified' ? html`<a class="btn btn-primary" href="${href(ctx, `/doctors/${w.doctor_slug}`, { clinic: w.clinic_id, date: w.wanted_date })}#book-title">${ctx.t('waitlist.bookNow')}</a>` : ''}
        <form method="post" action="${href(ctx, `/waitlist/${w.id}/leave`)}" class="inline-form">${csrfField(ctx)}
          <button class="btn btn-ghost" type="submit">${ctx.t('waitlist.leave')}</button></form>
      </div>
    </li>`;
  };

  const body = html`<div class="container page narrow stack-lg">
    <div class="row-between"><h1>${ctx.t('appts.title')}</h1>
      <div class="row-wrap"><a class="btn btn-primary" href="${href(ctx, '/search')}">${icon.search}${ctx.t('appts.findDoctor')}</a>
      <a class="btn btn-outline" href="${href(ctx, '/prescriptions')}">${ctx.t('appts.myDocs')}</a></div></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${ctx.user && !ctx.user.phoneVerified && ctx.deps.cfg.SMS_PROVIDER !== 'none' ? alert('warning', html`<a href="${href(ctx, '/verify-phone')}">${ctx.t('book.verifyFirst')}</a>`) : ''}
    <section class="stack"><h2>${ctx.t('appts.upcoming')}</h2>
      ${upcoming.length ? html`<ul class="appt-list">${upcoming.map(upcomingRow)}</ul>`
        : html`<div class="empty"><p>${ctx.t('appts.none')}</p><a class="btn btn-primary btn-lg" href="${href(ctx, '/search')}">${ctx.t('appts.findDoctor')}</a></div>`}
    </section>
    ${waitlist.length ? html`<section class="stack"><h2>${ctx.t('waitlist.myTitle')}</h2><ul class="appt-list">${waitlist.map(waitRow)}</ul></section>` : ''}
    ${past.length ? html`<section class="stack"><h2>${ctx.t('appts.past')}</h2><ul class="appt-list">${past.map(pastRow)}</ul></section>` : ''}
  </div>`;
  return layout(ctx, { title: `${ctx.t('appts.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function reviewPage(ctx: Ctx, t: ReviewTarget, o: { error?: MessageKey; rating?: number | null; comment?: string }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const rating = o.rating ?? t.rating ?? 0;
  const comment = o.comment ?? t.comment ?? '';
  const body = html`<div class="container page narrow">
    <div class="panel stack">
      <h1>${ctx.t(t.rating ? 'review.editTitle' : 'review.title')}</h1>
      <p class="lead-sm" dir="auto">${t.doctor_name} · ${t.clinic_name} · ${formatDate(t.starts_at, ctx.locale, tz)}</p>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${href(ctx, `/appointments/${t.appointment_id}/review`)}" class="stack">
        ${csrfField(ctx)}
        <fieldset class="stack-sm">
          <legend class="label">${ctx.t('review.ratingLabel')}</legend>
          <div class="star-input">${[5, 4, 3, 2, 1].map(
            (n) => html`<input type="radio" id="rating-${String(n)}" name="rating" value="${String(n)}"${rating === n ? html` checked` : ''} required>
              <label for="rating-${String(n)}" title="${ctx.t('reviews.stars', { n })}">${icon.star}<span class="sr-only">${ctx.t('reviews.stars', { n })}</span></label>`,
          )}</div>
        </fieldset>
        <div class="field">
          <label for="comment">${ctx.t('review.commentLabel')} <span class="muted">(${ctx.t('common.optional')})</span></label>
          <textarea id="comment" name="comment" rows="4" maxlength="${String(MAX_REVIEW_COMMENT)}" aria-describedby="comment-hint" dir="auto">${comment}</textarea>
          <p class="hint" id="comment-hint">${ctx.t('review.commentHint')}</p>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${ctx.t('review.submit')}</button>
        <a class="btn btn-ghost btn-block" href="${href(ctx, '/appointments')}">${ctx.t('common.back')}</a>
      </form>
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('review.title')} — ${ctx.t('brand')}`, body, noindex: true });
}
