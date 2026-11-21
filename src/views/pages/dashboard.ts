import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon, input, ratingBadge, select, statusChip, errorSummary, yearsLabel } from '../components.js';
import { pick, formatDate, formatTime, formatShortDate, formatNumber, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { OwnDoctor, ClinicRow, RuleRow, BlockRow, PositionRow, RuleProblem } from '../../services/doctors.js';
import { LANGUAGES, SLOT_LENGTHS } from '../../services/doctors.js';
import type { DoctorDayAppointment } from '../../services/dashboard.js';
import { nextDoctorAction } from '../../domain/appointmentStatus.js';
import { addDays, todayIn } from '../../domain/time.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { money } from './public.js';
import { markPaidForm, paidChip } from './payments.js';
import type { PaymentMethod } from '../../services/payments.js';
import type { ClinicForBooking, FollowUpSource } from '../../services/clinicBooking.js';
import type { Slot } from '../../domain/availability.js';

export type Section = 'today' | 'messages' | 'income' | 'patients' | 'clinics' | 'hours' | 'profile';

export function shell(ctx: Ctx, doctor: OwnDoctor, section: Section, content: SafeHtml, notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  // Menu: Schedule, Patients, Messages, Income (if the doctor uses it), Profile (which holds clinics and hours).
  const items: { key: Section; path: string; label: MessageKey }[] = [
    { key: 'today', path: '/dashboard', label: 'dash.nav.today' },
    ...(doctor.records_enabled ? [{ key: 'patients' as const, path: '/dashboard/patients', label: 'dash.nav.patients' as const }] : []),
    { key: 'messages', path: '/dashboard/messages', label: 'msg.title' },
    ...(doctor.show_income ? [{ key: 'income' as const, path: '/dashboard/income', label: 'pay.incomeTitle' as const }] : []),
    { key: 'profile', path: '/dashboard/profile', label: 'dash.nav.profile' },
  ];
  const inProfile = section === 'profile' || section === 'clinics' || section === 'hours';
  const profileTabs: { key: Section; path: string; label: MessageKey }[] = [
    { key: 'profile', path: '/dashboard/profile', label: 'dash.tab.details' },
    { key: 'clinics', path: '/dashboard/clinics', label: 'dash.nav.clinics' },
    { key: 'hours', path: '/dashboard/hours', label: 'dash.nav.hours' },
  ];
  const status = doctor.verification_status;
  const banner =
    status === 'pending'
      ? alert('info', ctx.t('dash.pendingBody'), ctx.t('dash.pendingTitle'))
      : status === 'rejected'
        ? alert('error', ctx.t('dash.rejectedBody', { note: doctor.verification_note ?? '—' }), ctx.t('dash.rejectedTitle'))
        : status === 'suspended'
          ? alert('error', ctx.t('dash.suspendedBody'), ctx.t('dash.suspendedTitle'))
          : html``;
  const body = html`<div class="dash">
    <nav class="dash-nav" aria-label="${ctx.t('dash.nav')}">
      <ul>${items.map(
        (i) => html`<li><a href="${href(ctx, i.path)}"${attrIf(i.key === section || (i.key === 'profile' && inProfile), 'aria-current="page"')}>${ctx.t(i.label)}${
          i.key === 'messages' && ctx.unreadMessages ? html` <span class="count-badge inline" aria-label="${ctx.t('msg.unreadCount', { n: ctx.unreadMessages })}">${ctx.unreadMessages}</span>` : ''
        }</a></li>`,
      )}</ul>
      ${status === 'approved' ? html`<a class="dash-public" href="${href(ctx, `/doctors/${doctor.slug}`)}">${ctx.t('dash.publicProfile')}${icon.arrow}</a>` : ''}
    </nav>
    <div class="dash-content stack-lg">
      ${banner}
      ${inProfile
        ? html`<nav class="row-wrap sub-tabs" aria-label="${ctx.t('dash.nav.profile')}">${profileTabs.map(
            (t) => html`<a class="chip-link" href="${href(ctx, t.path)}"${attrIf(t.key === section, 'aria-current="true"')}>${ctx.t(t.label)}</a>`,
          )}</nav>`
        : ''}
      ${notice ? alert(notice.kind, ctx.t(notice.key)) : ''}
      ${content}
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('dash.nav')} — ${ctx.t('brand')}`, body, variant: 'app', noindex: true });
}

export function todayPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  o: {
    date: string;
    appointments: DoctorDayAppointment[];
    weekCount: number;
    clinics: ClinicRow[];
    rules: RuleRow[];
    rating?: { avg: number; count: number } | null;
    /** By patient id (accounts) or phone (walk-ins). */
    noShows?: Map<string, number>;
    /** Live payment per appointment id. */
    payments?: Map<string, { id: string; amount: number; method: PaymentMethod }>;
    /** Active strikes (cancellations of online bookings) and the limit at which online booking pauses. */
    strikes?: { active: number; limit: number };
    /** Confirmed bookings on this day (for "Can't work this day?"). */
    confirmedToday?: number;
    notice?: { kind: 'success' | 'error'; key: MessageKey };
  },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const live = o.appointments.filter((a) => a.status !== 'cancelled');
  const done = live.filter((a) => a.status === 'completed').length;
  const paidOf = (a: DoctorDayAppointment) => o.payments?.get(a.id);
  const collected = live.reduce((sum, a) => sum + (paidOf(a)?.amount ?? 0), 0);
  const canBook = doctor.verification_status === 'approved' && o.clinics.some((c) => c.is_active) && o.rules.length > 0;
  const noShowsOf = (a: DoctorDayAppointment) => o.noShows?.get(a.patient_id ?? a.patient_phone) ?? 0;
  const waiting = live.filter((a) => a.status === 'arrived').length;
  const isToday = o.date === todayIn(tz, ctx.deps.now());
  const dayLabel = formatDate(new Date(`${o.date}T12:00:00Z`), ctx.locale, 'UTC');
  const n = (x: number) => formatNumber(x, ctx.locale);

  const setup =
    !o.clinics.length || !o.rules.length
      ? html`<div class="panel stack-sm"><strong>${ctx.t('dash.setupTitle')}</strong><div class="row-wrap">
          ${!o.clinics.length ? html`<a class="btn btn-primary" href="${href(ctx, '/dashboard/clinics')}">${ctx.t('dash.setupClinic')}</a>` : ''}
          ${o.clinics.length && !o.rules.length ? html`<a class="btn btn-primary" href="${href(ctx, '/dashboard/hours')}">${ctx.t('dash.setupHours')}</a>` : ''}
        </div></div>`
      : '';

  const actionForm = (a: DoctorDayAppointment, to: string, label: MessageKey, primary: boolean) =>
    html`<form method="post" action="${href(ctx, `/dashboard/appointments/${a.id}/status`)}" class="inline-form">
      ${csrfField(ctx)}<input type="hidden" name="to" value="${to}"><input type="hidden" name="date" value="${o.date}">
      <button type="submit" class="btn ${primary ? 'btn-primary action-main' : 'btn-outline btn-sm'}">${ctx.t(label)}</button></form>`;

  // Cancelling a visit the patient booked online: say who asked, because only the clinic's own cancellations are strikes.
  const cancelChoice = (a: DoctorDayAppointment) => html`<details class="cancel-choice"><summary class="btn btn-outline btn-sm">${ctx.t('action.cancel')}</summary>
    <div class="stack-sm">
      <form method="post" action="${href(ctx, `/dashboard/appointments/${a.id}/status`)}">${csrfField(ctx)}
        <input type="hidden" name="to" value="cancelled"><input type="hidden" name="date" value="${o.date}"><input type="hidden" name="cancelKind" value="patient_request">
        <button type="submit" class="btn btn-outline btn-sm">${ctx.t('strike.patientAsked')}</button></form>
      <form method="post" action="${href(ctx, `/dashboard/appointments/${a.id}/status`)}">${csrfField(ctx)}
        <input type="hidden" name="to" value="cancelled"><input type="hidden" name="date" value="${o.date}"><input type="hidden" name="cancelKind" value="clinic">
        <button type="submit" class="btn btn-outline btn-sm danger">${ctx.t('strike.clinicCancels')}</button></form>
      <p class="hint">${ctx.t('strike.cancelHint')}</p>
    </div></details>`;
  const strikes = o.strikes;
  const strikeBanner = strikes && strikes.active
    ? strikes.active >= strikes.limit
      ? alert('error', ctx.t('strike.pausedBody'), ctx.t('strike.pausedTitle'))
      : alert('warning', ctx.t('strike.countBody', { n: strikes.active, limit: strikes.limit }))
    : '';
  const isPast = o.date < todayIn(tz, ctx.deps.now());
  const dayOff = !isPast && canBook
    ? html`<details class="panel day-off"><summary class="h3">${ctx.t('dayoff.title')}</summary>
        <form method="post" action="${href(ctx, '/dashboard/day-off')}" class="stack-sm">${csrfField(ctx)}
          <input type="hidden" name="date" value="${o.date}">
          <p class="muted">${ctx.t(o.confirmedToday ? 'dayoff.leadCount' : 'dayoff.leadNone', { n: o.confirmedToday ?? 0, day: dayLabel })}</p>
          <div class="field"><label for="dayoff-reason">${ctx.t('dayoff.reason')}</label><input id="dayoff-reason" name="reason" maxlength="200" required></div>
          <div><button type="submit" class="btn btn-outline danger">${ctx.t(o.confirmedToday ? 'dayoff.confirmCount' : 'dayoff.confirm', { n: o.confirmedToday ?? 0 })}</button></div>
        </form></details>`
    : '';

  const content = html`
    ${strikeBanner}
    <div class="row-between">
      <div><h1>${ctx.t('dash.greeting', { name: doctor.full_name })}</h1><p class="muted">${dayLabel}</p></div>
      ${canBook ? html`<a class="btn btn-primary btn-lg" href="${href(ctx, '/dashboard/book', { date: o.date })}">${icon.plus}${ctx.t('cbook.add')}</a>` : ''}
    </div>
    ${setup}
    <div class="kpis">
      <div class="kpi"><span>${ctx.t('dash.kpiToday')}</span><strong>${n(live.length)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiCompleted')}</span><strong>${n(done)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiWaiting')}</span><strong>${n(waiting)}</strong></div>
      ${doctor.show_income ? html`<div class="kpi"><span>${ctx.t('dash.kpiCollected')}</span><strong>${money(ctx, collected)}</strong></div>` : ''}
      <div class="kpi"><span>${ctx.t('dash.kpiWeek')}</span><strong>${n(o.weekCount)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiRating')}</span>${o.rating ? html`<strong>${ratingBadge(ctx, o.rating)}</strong>` : html`<span class="muted">${ctx.t('dash.noRatingYet')}</span>`}</div>
    </div>
    <section class="panel flush">
      <div class="panel-head row-between">
        <h2>${ctx.t('dash.scheduleFor')}</h2>
        <nav class="row-wrap" aria-label="${ctx.t('dash.scheduleFor')}">
          <a class="btn btn-outline btn-sm" href="${href(ctx, '/dashboard', { date: addDays(o.date, -1) })}">${icon.chevronStart}<span class="sr-only">${ctx.t('dash.prevDay')}</span></a>
          ${isToday ? '' : html`<a class="btn btn-outline btn-sm" href="${href(ctx, '/dashboard')}">${ctx.t('common.today')}</a>`}
          <a class="btn btn-outline btn-sm" href="${href(ctx, '/dashboard', { date: addDays(o.date, 1) })}">${icon.chevronEnd}<span class="sr-only">${ctx.t('dash.nextDay')}</span></a>
        </nav>
      </div>
      ${o.appointments.length
        ? html`<div class="table-scroll"><table class="table cards-on-phone">
            <thead><tr><th scope="col">${ctx.t('dash.time')}</th><th scope="col">${ctx.t('dash.patient')}</th><th scope="col">${ctx.t('dash.clinic')}</th>
              <th scope="col">${ctx.t('dash.type')}</th><th scope="col">${ctx.t('dash.reason')}</th><th scope="col">${ctx.t('dash.status')}</th><th scope="col">${ctx.t('dash.action')}</th></tr></thead>
            <tbody>${o.appointments.map((a) => {
              const next = nextDoctorAction(a.status);
              const started = ctx.deps.now().getTime() >= a.starts_at.getTime();
              return html`<tr class="${a.status === 'in_consultation' ? 'row-active' : ''}">
                <td class="nowrap cell-time" data-label="${ctx.t('dash.time')}"><strong>${formatTime(a.starts_at, ctx.locale, tz)}</strong></td>
                <td class="cell-patient" data-label="${ctx.t('dash.patient')}"><span class="stack-sm"><strong dir="auto">${a.patient_name}</strong>${
                  a.booked_by === 'doctor' || noShowsOf(a)
                    ? html`<span class="row-wrap tight">${a.booked_by === 'doctor' ? html`<span class="chip">${ctx.t('cbook.byClinic')}</span>` : ''}${
                        noShowsOf(a) ? html`<span class="chip status-cancelled">${ctx.t('cbook.noShows', { n: noShowsOf(a) })}</span>` : ''}</span>`
                    : ''}<a class="muted" dir="ltr" href="tel:${a.patient_phone}">${formatEgyptMobile(a.patient_phone)}</a>${a.patient_email ? html`<a class="muted small" dir="ltr" href="mailto:${a.patient_email}">${a.patient_email}</a>` : ''}</span></td>
                <td data-label="${ctx.t('dash.clinic')}">${a.clinic_name}</td>
                <td data-label="${ctx.t('dash.type')}">${ctx.t(a.visit_type === 'new' ? 'book.new' : 'book.followUp')} <span class="muted small">· ${money(ctx, a.fee_egp)}</span></td>
                <td class="muted" data-label="${ctx.t('dash.reason')}">${a.reason ?? '—'}</td>
                <td data-label="${ctx.t('dash.status')}">${statusChip(ctx, a.status)}</td>
                <td class="cell-actions"><div class="row-wrap">
                  ${next ? actionForm(a, next, `action.${next}` as MessageKey, true) : ''}
                  ${a.status === 'confirmed' && started ? actionForm(a, 'no_show', 'action.no_show', false) : ''}
                  ${a.status === 'confirmed' || a.status === 'arrived' ? (a.booked_by === 'patient' ? cancelChoice(a) : actionForm(a, 'cancelled', 'action.cancel', false)) : ''}
                  ${!doctor.show_income
                    ? ''
                    : paidOf(a)
                    ? paidChip(ctx, paidOf(a)!, href(ctx, `/dashboard/appointments/${a.id}/receipt`))
                    : a.status === 'arrived' || a.status === 'in_consultation' || a.status === 'completed'
                      ? markPaidForm(ctx, a.id, a.fee_egp, { date: o.date }, { big: a.status === 'completed' })
                      : ''}
                  ${canBook && (a.status === 'completed' || a.status === 'in_consultation') ? html`<a class="btn btn-outline btn-sm" href="${href(ctx, '/dashboard/book', { from: a.id, date: addDays(todayIn(tz, ctx.deps.now()), 7) })}">${ctx.t('cbook.bookFollowUp')}</a>` : ''}
                  ${doctor.records_enabled && a.status !== 'cancelled' ? html`<a class="btn btn-outline btn-sm" href="${href(ctx, `/dashboard/appointments/${a.id}/file`)}">${ctx.t('records.openFile')}</a>` : ''}
                </div></td>
              </tr>`;
            })}</tbody></table></div>`
        : html`<p class="empty">${ctx.t('dash.noAppointments')}</p>`}
    </section>
    ${dayOff}`;
  return shell(ctx, doctor, 'today', content, o.notice);
}

export function clinicsPage(ctx: Ctx, doctor: OwnDoctor, ref: ReferenceData, clinics: ClinicRow[], o: { errors?: FieldErrors; values?: Record<string, string>; editing?: string | null; notice?: { kind: 'success' | 'error'; key: MessageKey } }): SafeHtml {
  const districtOptions = ref.districts.map((d) => ({ value: String(d.id), label: pick(ctx.locale, d) }));
  const form = (c: ClinicRow | null) => {
    const isTarget = (o.editing ?? null) === (c?.id ?? null);
    const v = isTarget && o.values ? o.values : c ? { name: c.name, district: String(c.district_id), address: c.address, phone: c.phone_e164 ? c.phone_e164.replace(/^\+20/, '0') : '', fee: String(c.fee_egp), followUpFee: c.follow_up_fee_egp === null ? '' : String(c.follow_up_fee_egp), followUpDays: String(c.follow_up_days), active: c.is_active ? 'yes' : '' } : { active: 'yes', followUpDays: '14' };
    const errors = isTarget ? o.errors : undefined;
    const idPrefix = c ? `c${c.id.slice(0, 8)}-` : 'new-';
    return html`<form method="post" action="${href(ctx, c ? `/dashboard/clinics/${c.id}` : '/dashboard/clinics')}" class="stack">
      ${csrfField(ctx)}
      <div class="form-grid">
        ${input(ctx, { idPrefix, name: 'name', label: ctx.t('clinics.name'), value: v['name'], errors, maxlength: 120, required: true })}
        ${select(ctx, { idPrefix, name: 'district', label: ctx.t('clinics.district'), value: v['district'] ?? '', options: [{ value: '', label: '—' }, ...districtOptions], errors, required: true })}
        ${input(ctx, { idPrefix, name: 'address', label: ctx.t('clinics.address'), value: v['address'], errors, maxlength: 300, required: true })}
        ${input(ctx, { idPrefix, name: 'fee', label: ctx.t('clinics.fee'), value: v['fee'], inputmode: 'numeric', errors, required: true })}
        ${input(ctx, { idPrefix, name: 'followUpFee', label: ctx.t('clinics.followUpFee'), value: v['followUpFee'], inputmode: 'numeric', hint: ctx.t('clinics.followUpFeeHint'), errors })}
        ${input(ctx, { idPrefix, name: 'followUpDays', label: ctx.t('clinics.followUpDays'), value: v['followUpDays'], inputmode: 'numeric', hint: ctx.t('clinics.followUpDaysHint'), errors })}
        ${input(ctx, { idPrefix, name: 'phone', label: ctx.t('clinics.phone'), type: 'tel', value: v['phone'], inputmode: 'tel', errors })}
        <div class="field"><label class="check"><input type="checkbox" name="active" value="yes"${attrIf(v['active'] === 'yes', 'checked')}><span>${ctx.t('clinics.active')}</span></label></div>
      </div>
      <div><button type="submit" class="btn btn-primary">${c ? ctx.t('clinics.update') : ctx.t('clinics.add')}</button></div>
    </form>`;
  };
  const content = html`
    <div><h1>${ctx.t('clinics.title')}</h1><p class="muted">${ctx.t('clinics.lead')}</p></div>
    ${clinics.length ? clinics.map((c) => html`<section class="panel stack"><h2>${c.name} <span class="muted">· ${money(ctx, c.fee_egp)}</span></h2>${form(c)}</section>`) : html`<p class="muted">${ctx.t('clinics.none')}</p>`}
    <section class="panel stack"><h2>${ctx.t('clinics.add')}</h2>${form(null)}</section>`;
  return shell(ctx, doctor, 'clinics', content, o.notice);
}

/** What the doctor typed into the working-hours form, kept when it is shown again with an error. */
export interface HoursFormValues {
  clinic: string;
  slot: string;
  days: number[];
  times: Partial<Record<number, { start: string; end: string }>>;
}

/** Egyptian working week order: Saturday first. Values are JS weekdays (0 = Sunday). */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

function dayRow(ctx: Ctx, d: number, checked: boolean, times: { start: string; end: string }): SafeHtml {
  const day = ctx.t.dynamic(`weekday.${d}`);
  return html`<div class="day-row" data-day-row>
    <label class="check day-pick"><input type="checkbox" name="days" value="${String(d)}" id="day-${String(d)}"${attrIf(checked, 'checked')}><span>${day}</span></label>
    <div class="day-times">
      <div class="field"><label for="start_${String(d)}">${ctx.t('hours.start')}<span class="sr-only"> (${day})</span></label>
        <input id="start_${String(d)}" name="start_${String(d)}" type="time" value="${times.start}" data-time="start"></div>
      <div class="field"><label for="end_${String(d)}">${ctx.t('hours.end')}<span class="sr-only"> (${day})</span></label>
        <input id="end_${String(d)}" name="end_${String(d)}" type="time" value="${times.end}" data-time="end"></div>
    </div>
  </div>`;
}

export function hoursPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  clinics: ClinicRow[],
  rules: RuleRow[],
  blocks: BlockRow[],
  o: { ruleError?: RuleProblem; ruleValues?: HoursFormValues; blockError?: MessageKey; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const v = o.ruleValues;
  const ruleErrorText = o.ruleError
    ? ctx.t(o.ruleError.key, o.ruleError.weekday !== undefined ? { day: ctx.t.dynamic(`weekday.${o.ruleError.weekday}`) } : undefined)
    : '';
  const tz = ctx.deps.cfg.TIME_ZONE;
  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name ?? '';
  const today = todayIn(tz, ctx.deps.now());
  const content = html`
    <div><h1>${ctx.t('hours.title')}</h1><p class="muted">${ctx.t('hours.lead')}</p></div>
    <section class="panel stack">
      ${rules.length
        ? html`<div class="table-scroll"><table class="table"><thead><tr><th scope="col">${ctx.t('hours.weekday')}</th><th scope="col">${ctx.t('hours.clinic')}</th>
            <th scope="col">${ctx.t('hours.start')}</th><th scope="col">${ctx.t('hours.end')}</th><th scope="col">${ctx.t('hours.slot')}</th><th scope="col"><span class="sr-only">${ctx.t('common.delete')}</span></th></tr></thead>
            <tbody>${rules.map(
              (r) => html`<tr><td>${ctx.t.dynamic(`weekday.${r.weekday}`)}</td><td>${clinicName(r.clinic_id)}</td><td dir="ltr">${r.start_time}</td><td dir="ltr">${r.end_time}</td>
                <td>${ctx.t('common.minutes', { n: formatNumber(r.slot_minutes, ctx.locale) })}</td>
                <td><form method="post" action="${href(ctx, `/dashboard/hours/rules/${r.id}/delete`)}">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${ctx.t('common.delete')}</button></form></td></tr>`,
            )}</tbody></table></div>`
        : html`<p class="muted">${ctx.t('hours.none')}</p>`}
      ${clinics.length
        ? html`<form method="post" action="${href(ctx, '/dashboard/hours/rules')}" class="stack">
            ${csrfField(ctx)}
            ${o.ruleError ? alert('error', ruleErrorText) : ''}
            <div class="form-grid">
              ${select(ctx, { name: 'clinic', label: ctx.t('hours.clinic'), value: v?.clinic, options: clinics.map((c) => ({ value: c.id, label: c.name })) })}
              ${select(ctx, { name: 'slot', label: ctx.t('hours.slot'), value: v?.slot || '30', options: SLOT_LENGTHS.map((m) => ({ value: String(m), label: ctx.t('common.minutes', { n: formatNumber(m, ctx.locale) }) })) })}
            </div>
            <fieldset class="stack-sm">
              <legend>${ctx.t('hours.days')}</legend>
              <p class="hint">${ctx.t('hours.daysHint')}</p>
              <div class="day-list">
                ${WEEK_ORDER.map((d) => dayRow(ctx, d, v ? v.days.includes(d) : false, v?.times[d] ?? { start: '17:00', end: '21:00' }))}
              </div>
              <div><button type="button" class="btn btn-outline btn-sm" data-copy-hours hidden>${ctx.t('hours.copyTimes')}</button></div>
            </fieldset>
            <div><button type="submit" class="btn btn-primary">${ctx.t('hours.add')}</button></div>
          </form>`
        : html`<p><a class="btn btn-primary" href="${href(ctx, '/dashboard/clinics')}">${ctx.t('hours.needClinic')}</a></p>`}
    </section>
    <section class="panel stack">
      <h2>${ctx.t('hours.blocksTitle')}</h2>
      <p class="muted">${ctx.t('hours.blocksLead')}</p>
      ${blocks.length
        ? html`<ul class="appt-list">${blocks.map(
            (b) => html`<li class="appt-row"><span>${formatShortDate(b.starts_at, ctx.locale, tz)} → ${formatShortDate(new Date(b.ends_at.getTime() - 1), ctx.locale, tz)}${b.note ? html` · <span class="muted">${b.note}</span>` : ''}</span>
              <form method="post" action="${href(ctx, `/dashboard/hours/blocks/${b.id}/delete`)}">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${ctx.t('common.delete')}</button></form></li>`,
          )}</ul>`
        : html`<p class="muted">${ctx.t('hours.noBlocks')}</p>`}
      <form method="post" action="${href(ctx, '/dashboard/hours/blocks')}" class="stack">
        ${csrfField(ctx)}
        ${o.blockError ? alert('error', ctx.t(o.blockError)) : ''}
        <div class="form-grid">
          ${input(ctx, { name: 'fromDate', label: ctx.t('hours.blockDate'), type: 'date', value: today, required: true })}
          ${input(ctx, { name: 'toDate', label: ctx.t('hours.blockToDate'), type: 'date', value: today })}
          ${input(ctx, { name: 'note', label: ctx.t('hours.blockNote'), maxlength: 200 })}
        </div>
        <div><button type="submit" class="btn btn-outline">${ctx.t('hours.addBlock')}</button></div>
      </form>
    </section>`;
  return shell(ctx, doctor, 'hours', content, o.notice);
}

export function profileEditPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  ref: ReferenceData,
  o: { subspecialtyIds: number[]; insurerIds: number[]; positions: PositionRow[]; years: number; errors?: FieldErrors; positionError?: MessageKey; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const spec = ref.specialtyById.get(doctor.specialty_id);
  const maxMonth = ctx.deps.now().toISOString().slice(0, 7);
  const content = html`
    <div><h1>${ctx.t('profile.title')}</h1><p class="muted">${ctx.t('profile.lead')}</p></div>
    <form method="post" action="${href(ctx, '/dashboard/settings/income')}" class="panel row-between">
      ${csrfField(ctx)}
      <div class="stack-sm"><strong>${ctx.t('pay.incomeTitle')} — ${ctx.t(doctor.show_income ? 'msgset.on' : 'msgset.off')}</strong>
        <span class="muted small">${ctx.t('dash.incomeToggleHint')}</span></div>
      <input type="hidden" name="show" value="${doctor.show_income ? 'no' : 'yes'}">
      <button type="submit" class="btn ${doctor.show_income ? 'btn-outline' : 'btn-primary'}">${ctx.t(doctor.show_income ? 'dash.incomeTurnOff' : 'dash.incomeTurnOn')}</button>
    </form>
    <form method="post" action="${href(ctx, '/dashboard/profile')}" class="panel stack">
      ${csrfField(ctx)}
      <div class="form-grid">
        ${input(ctx, { name: 'titleEn', label: ctx.t('profile.titleEn'), value: doctor.title_en, hint: ctx.t('profile.titleHint'), maxlength: 160 })}
        ${input(ctx, { name: 'titleAr', label: ctx.t('profile.titleAr'), value: doctor.title_ar, maxlength: 160 })}
      </div>
      <div class="field${o.errors?.['bio'] ? ' has-error' : ''}"><label for="bio">${ctx.t('profile.bio')}</label>
        <textarea id="bio" name="bio" rows="5" maxlength="2000">${doctor.bio}</textarea></div>
      <div class="form-grid">
        ${select(ctx, {
          name: 'subspecialties',
          label: `${ctx.t('join.subspecialties')}${spec ? ` — ${pick(ctx.locale, spec)}` : ''}`,
          multiple: true,
          size: 5,
          value: o.subspecialtyIds.map(String),
          options: (spec?.subspecialties ?? []).map((s) => ({ value: String(s.id), label: pick(ctx.locale, s) })),
          hint: ctx.t('join.subspecialtiesHint'),
          errors: o.errors,
        })}
        ${ref.insurers.length
          ? select(ctx, { name: 'insurers', label: ctx.t('profile.insurers'), multiple: true, size: 5, value: o.insurerIds.map(String), options: ref.insurers.map((i) => ({ value: String(i.id), label: pick(ctx.locale, i) })) })
          : ''}
        <fieldset class="stack-sm"><legend class="label">${ctx.t('profile.languages')}</legend>
          ${LANGUAGES.map((l) => html`<label class="check"><input type="checkbox" name="languages" value="${l}"${attrIf(doctor.languages.includes(l), 'checked')}><span>${ctx.t.dynamic(`lang.${l}`)}</span></label>`)}
        </fieldset>
        ${select(ctx, {
          name: 'gender',
          label: ctx.t('profile.gender'),
          value: doctor.gender ?? '',
          options: [
            { value: '', label: ctx.t('profile.unspecified') },
            { value: 'female', label: ctx.t('profile.female') },
            { value: 'male', label: ctx.t('profile.male') },
          ],
        })}
      </div>
      <div><button type="submit" class="btn btn-primary">${ctx.t('common.save')}</button></div>
    </form>
    <section class="panel stack">
      <h2>${ctx.t('profile.positions')}</h2>
      <p class="pill small">${ctx.t('profile.experienceTotal', { n: formatNumber(o.years, ctx.locale) })}</p>
      ${o.positions.length
        ? html`<ul class="appt-list">${o.positions.map(
            (p) => html`<li class="appt-row"><span class="stack-sm"><strong>${p.title}</strong><span class="muted">${p.workplace} · <span dir="ltr">${yearsLabel(ctx, p)}</span></span></span>
              <form method="post" action="${href(ctx, `/dashboard/profile/positions/${p.id}/delete`)}">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${ctx.t('common.delete')}</button></form></li>`,
          )}</ul>`
        : ''}
      <form method="post" action="${href(ctx, '/dashboard/profile/positions')}" class="stack">
        ${csrfField(ctx)}
        ${o.positionError ? alert('error', ctx.t(o.positionError)) : ''}
        <div class="position-row">
          <div class="field"><label for="p-title">${ctx.t('join.position')}</label><input id="p-title" name="posTitle" maxlength="120" required></div>
          <div class="field"><label for="p-place">${ctx.t('join.workplace')}</label><input id="p-place" name="posWorkplace" maxlength="160" required></div>
          <div class="field"><label for="p-start">${ctx.t('join.from')}</label><input id="p-start" name="posStart" type="text" inputmode="numeric" maxlength="7" placeholder="${ctx.t('join.yearPlaceholder')}" required></div>
          <div class="field"><label for="p-end">${ctx.t('join.to')}</label><input id="p-end" name="posEnd" type="text" inputmode="numeric" maxlength="7" placeholder="${ctx.t('join.yearPlaceholder')}"></div>
        </div>
        <p class="hint">${ctx.t('join.toHint')}</p>
        <div><button type="submit" class="btn btn-outline">${ctx.t('profile.addPosition')}</button></div>
      </form>
    </section>`;
  return shell(ctx, doctor, 'profile', content, o.notice);
}

export interface ClinicBookView {
  clinics: ClinicForBooking[];
  clinicId: string;
  date: string;
  today: string;
  lastDate: string;
  slots: Slot[];
  source: FollowUpSource | null;
  values?: Record<string, string>;
  errors?: FieldErrors;
  error?: MessageKey;
}

/** The clinic books for someone: a phone call, a walk-in, or a follow-up from today's list. Two steps on one page: pick a day, then a time. */
export function clinicBookPage(ctx: Ctx, doctor: OwnDoctor, v: ClinicBookView): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const values = v.values ?? {};
  const clinic = v.clinics.find((c) => c.id === v.clinicId)!;
  const from = v.source ? { from: v.source.id } : {};
  const dayHref = (date: string) => href(ctx, '/dashboard/book', { ...from, clinic: clinic.id, date });
  const quick: { label: MessageKey; days: number }[] = v.source
    ? [{ label: 'cbook.in1w', days: 7 }, { label: 'cbook.in2w', days: 14 }, { label: 'cbook.in1m', days: 30 }]
    : [{ label: 'common.today', days: 0 }, { label: 'cbook.tomorrow', days: 1 }];
  const chosen = values['start'] ?? '';
  const visit = v.source ? 'follow_up' : values['visitType'] === 'follow_up' ? 'follow_up' : 'new';
  const followUpPrice = clinic.followUpFee ?? clinic.fee;

  const content = html`
    <div class="stack-sm">
      <a class="back-link" href="${href(ctx, '/dashboard', { date: v.date })}">${icon.chevronStart}${ctx.t('cbook.back')}</a>
      <h1>${v.source ? ctx.t('cbook.followUpTitle', { name: v.source.name }) : ctx.t('cbook.title')}</h1>
      <p class="muted">${v.source ? ctx.t('cbook.followUpLead', { date: formatDate(v.source.startsAt, ctx.locale, tz) }) : ctx.t('cbook.lead')}</p>
    </div>
    ${v.error ? alert('error', ctx.t(v.error)) : errorSummary(ctx, v.errors)}
    <section class="panel stack">
      <h2 class="h3">${ctx.t('cbook.step1')}</h2>
      <div class="row-wrap">${quick.map((q) => {
        const d = addDays(v.today, q.days);
        return d <= v.lastDate ? html`<a class="chip-link"${attrIf(d === v.date, 'aria-current="true"')} href="${dayHref(d)}">${ctx.t(q.label)}</a>` : '';
      })}</div>
      <form method="get" action="${href(ctx, '/dashboard/book')}" class="cbook-day">
        ${v.source ? html`<input type="hidden" name="from" value="${v.source.id}">` : ''}
        ${v.clinics.length > 1
          ? select(ctx, { name: 'clinic', label: ctx.t('dash.clinic'), value: clinic.id, options: v.clinics.map((c) => ({ value: c.id, label: c.name })) })
          : html`<input type="hidden" name="clinic" value="${clinic.id}">`}
        <div class="field"><label for="date">${ctx.t('cbook.date')}</label>
          <input id="date" type="date" name="date" value="${v.date}" min="${v.today}" max="${v.lastDate}" required></div>
        <div class="field"><button class="btn btn-outline" type="submit">${ctx.t('cbook.showTimes')}</button></div>
      </form>
    </section>
    <form method="post" action="${href(ctx, '/dashboard/book')}" class="panel stack" novalidate>
      ${csrfField(ctx)}
      <input type="hidden" name="clinic" value="${clinic.id}">
      <input type="hidden" name="date" value="${v.date}">
      ${v.source ? html`<input type="hidden" name="from" value="${v.source.id}">` : ''}
      <fieldset class="stack-sm">
        <legend class="h3">${ctx.t('cbook.step2', { day: formatDate(new Date(`${v.date}T12:00:00Z`), ctx.locale, 'UTC') })}</legend>
        ${v.errors?.['start'] ? html`<p class="field-error" id="start-error">${ctx.t(v.errors['start'])}</p>` : ''}
        ${v.slots.length
          ? html`<div class="slot-grid slot-pick">${v.slots.map(
              (s) => html`<label class="slot"><input type="radio" name="start" value="${s.startsAt.toISOString()}"${attrIf(chosen === s.startsAt.toISOString(), 'checked')} required><span>${formatTime(s.startsAt, ctx.locale, tz)}</span></label>`,
            )}</div>`
          : html`<p class="empty">${ctx.t('cbook.noSlots')}</p>`}
      </fieldset>
      ${v.source
        ? html`<dl class="summary">
            <div><dt>${ctx.t('dash.patient')}</dt><dd><strong dir="auto">${v.source.name}</strong> · <span dir="ltr">${formatEgyptMobile(v.source.phone)}</span></dd></div>
            <div><dt>${ctx.t('book.feeFollowUp')}</dt><dd>${money(ctx, followUpPrice)}</dd></div>
          </dl>`
        : html`<div class="form-grid">
            ${input(ctx, { name: 'name', label: ctx.t('cbook.name'), value: values['name'], autocomplete: 'off', maxlength: 120, errors: v.errors, required: true })}
            ${input(ctx, { name: 'phone', label: ctx.t('auth.phone'), type: 'tel', value: values['phone'], prefix: '+20', inputmode: 'tel', autocomplete: 'off', errors: v.errors, required: true })}
          </div>
          <fieldset class="stack-sm">
            <legend class="label">${ctx.t('book.visitType')}</legend>
            <div class="segmented">
              <label><input type="radio" name="visitType" value="new"${attrIf(visit === 'new', 'checked')}><span>${ctx.t('book.new')} · ${money(ctx, clinic.fee)}</span></label>
              <label><input type="radio" name="visitType" value="follow_up"${attrIf(visit === 'follow_up', 'checked')}><span>${ctx.t('book.followUp')} · ${money(ctx, followUpPrice)}</span></label>
            </div>
          </fieldset>`}
      <div class="field">
        <label for="reason">${ctx.t('book.reason')} <span class="muted">(${ctx.t('common.optional')})</span></label>
        <input id="reason" type="text" name="reason" maxlength="200" value="${values['reason'] ?? ''}">
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit"${attrIf(!v.slots.length, 'disabled')}>${ctx.t('cbook.confirm')}</button>
      <p class="hint">${ctx.t(v.source?.patientId ? 'cbook.noticeAccount' : 'cbook.noticeWalkIn')}</p>
    </form>`;
  return shell(ctx, doctor, 'today', content);
}
