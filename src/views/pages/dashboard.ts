import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon, input, select, statusChip } from '../components.js';
import { pick, formatDate, formatTime, formatShortDate, formatNumber, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { OwnDoctor, ClinicRow, RuleRow, BlockRow, PositionRow } from '../../services/doctors.js';
import { LANGUAGES, SLOT_LENGTHS } from '../../services/doctors.js';
import type { DoctorDayAppointment } from '../../services/dashboard.js';
import { nextDoctorAction } from '../../domain/appointmentStatus.js';
import { addDays, todayIn } from '../../domain/time.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { money } from './public.js';

type Section = 'today' | 'clinics' | 'hours' | 'profile';

function shell(ctx: Ctx, doctor: OwnDoctor, section: Section, content: SafeHtml, notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const items: { key: Section; path: string; label: MessageKey }[] = [
    { key: 'today', path: '/dashboard', label: 'dash.nav.today' },
    { key: 'clinics', path: '/dashboard/clinics', label: 'dash.nav.clinics' },
    { key: 'hours', path: '/dashboard/hours', label: 'dash.nav.hours' },
    { key: 'profile', path: '/dashboard/profile', label: 'dash.nav.profile' },
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
        (i) => html`<li><a href="${href(ctx, i.path)}"${attrIf(i.key === section, 'aria-current="page"')}>${ctx.t(i.label)}</a></li>`,
      )}</ul>
      ${status === 'approved' ? html`<a class="dash-public" href="${href(ctx, `/doctors/${doctor.slug}`)}">${ctx.t('dash.publicProfile')}${icon.arrow}</a>` : ''}
    </nav>
    <div class="dash-content stack-lg">
      ${banner}
      ${notice ? alert(notice.kind, ctx.t(notice.key)) : ''}
      ${content}
    </div>
  </div>`;
  return layout(ctx, { title: `${ctx.t('dash.nav')} — ${ctx.t('brand')}`, body, variant: 'app', noindex: true });
}

export function todayPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  o: { date: string; appointments: DoctorDayAppointment[]; weekCount: number; clinics: ClinicRow[]; rules: RuleRow[]; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const live = o.appointments.filter((a) => a.status !== 'cancelled');
  const done = live.filter((a) => a.status === 'completed').length;
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
      <button type="submit" class="btn ${primary ? 'btn-primary' : 'btn-outline'} btn-sm">${ctx.t(label)}</button></form>`;

  const content = html`
    <div class="row-between">
      <div><h1>${ctx.t('dash.greeting', { name: doctor.full_name })}</h1><p class="muted">${dayLabel}</p></div>
    </div>
    ${setup}
    <div class="kpis">
      <div class="kpi"><span>${ctx.t('dash.kpiToday')}</span><strong>${n(live.length)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiCompleted')}</span><strong>${n(done)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiWaiting')}</span><strong>${n(waiting)}</strong></div>
      <div class="kpi"><span>${ctx.t('dash.kpiWeek')}</span><strong>${n(o.weekCount)}</strong></div>
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
        ? html`<div class="table-scroll"><table class="table">
            <thead><tr><th scope="col">${ctx.t('dash.time')}</th><th scope="col">${ctx.t('dash.patient')}</th><th scope="col">${ctx.t('dash.clinic')}</th>
              <th scope="col">${ctx.t('dash.type')}</th><th scope="col">${ctx.t('dash.reason')}</th><th scope="col">${ctx.t('dash.status')}</th><th scope="col">${ctx.t('dash.action')}</th></tr></thead>
            <tbody>${o.appointments.map((a) => {
              const next = nextDoctorAction(a.status);
              const started = ctx.deps.now().getTime() >= a.starts_at.getTime();
              return html`<tr class="${a.status === 'in_consultation' ? 'row-active' : ''}">
                <td class="nowrap"><strong>${formatTime(a.starts_at, ctx.locale, tz)}</strong></td>
                <td><span class="stack-sm"><strong>${a.patient_name}</strong><a class="muted" dir="ltr" href="tel:${a.patient_phone}">${formatEgyptMobile(a.patient_phone)}</a></span></td>
                <td>${a.clinic_name}</td>
                <td>${ctx.t(a.visit_type === 'new' ? 'book.new' : 'book.followUp')}</td>
                <td class="muted">${a.reason ?? '—'}</td>
                <td>${statusChip(ctx, a.status)}</td>
                <td><div class="row-wrap">
                  ${next ? actionForm(a, next, `action.${next}` as MessageKey, true) : ''}
                  ${a.status === 'confirmed' && started ? actionForm(a, 'no_show', 'action.no_show', false) : ''}
                  ${a.status === 'confirmed' || a.status === 'arrived' ? actionForm(a, 'cancelled', 'action.cancel', false) : ''}
                </div></td>
              </tr>`;
            })}</tbody></table></div>`
        : html`<p class="empty">${ctx.t('dash.noAppointments')}</p>`}
    </section>`;
  return shell(ctx, doctor, 'today', content, o.notice);
}

export function clinicsPage(ctx: Ctx, doctor: OwnDoctor, ref: ReferenceData, clinics: ClinicRow[], o: { errors?: FieldErrors; values?: Record<string, string>; editing?: string | null; notice?: { kind: 'success' | 'error'; key: MessageKey } }): SafeHtml {
  const districtOptions = ref.districts.map((d) => ({ value: String(d.id), label: pick(ctx.locale, d) }));
  const form = (c: ClinicRow | null) => {
    const isTarget = (o.editing ?? null) === (c?.id ?? null);
    const v = isTarget && o.values ? o.values : c ? { name: c.name, district: String(c.district_id), address: c.address, phone: c.phone_e164 ? c.phone_e164.replace(/^\+20/, '0') : '', fee: String(c.fee_egp), active: c.is_active ? 'yes' : '' } : { active: 'yes' };
    const errors = isTarget ? o.errors : undefined;
    const idPrefix = c ? `c${c.id.slice(0, 8)}-` : 'new-';
    return html`<form method="post" action="${href(ctx, c ? `/dashboard/clinics/${c.id}` : '/dashboard/clinics')}" class="stack">
      ${csrfField(ctx)}
      <div class="form-grid">
        ${input(ctx, { idPrefix, name: 'name', label: ctx.t('clinics.name'), value: v['name'], errors, maxlength: 120, required: true })}
        ${select(ctx, { idPrefix, name: 'district', label: ctx.t('clinics.district'), value: v['district'] ?? '', options: [{ value: '', label: '—' }, ...districtOptions], errors, required: true })}
        ${input(ctx, { idPrefix, name: 'address', label: ctx.t('clinics.address'), value: v['address'], errors, maxlength: 300, required: true })}
        ${input(ctx, { idPrefix, name: 'fee', label: ctx.t('clinics.fee'), value: v['fee'], inputmode: 'numeric', errors, required: true })}
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

export function hoursPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  clinics: ClinicRow[],
  rules: RuleRow[],
  blocks: BlockRow[],
  o: { ruleError?: MessageKey; blockError?: MessageKey; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
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
            ${o.ruleError ? alert('error', ctx.t(o.ruleError)) : ''}
            <div class="form-grid five">
              ${select(ctx, { name: 'clinic', label: ctx.t('hours.clinic'), options: clinics.map((c) => ({ value: c.id, label: c.name })) })}
              ${select(ctx, { name: 'weekday', label: ctx.t('hours.weekday'), options: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: ctx.t.dynamic(`weekday.${d}`) })) })}
              ${input(ctx, { name: 'start', label: ctx.t('hours.start'), type: 'time', value: '17:00', required: true })}
              ${input(ctx, { name: 'end', label: ctx.t('hours.end'), type: 'time', value: '21:00', required: true })}
              ${select(ctx, { name: 'slot', label: ctx.t('hours.slot'), value: '30', options: SLOT_LENGTHS.map((m) => ({ value: String(m), label: ctx.t('common.minutes', { n: formatNumber(m, ctx.locale) }) })) })}
            </div>
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
            (p) => html`<li class="appt-row"><span class="stack-sm"><strong>${p.title}</strong><span class="muted">${p.workplace} · <span dir="ltr">${p.start} – ${p.end ?? ctx.t('common.present')}</span></span></span>
              <form method="post" action="${href(ctx, `/dashboard/profile/positions/${p.id}/delete`)}">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${ctx.t('common.delete')}</button></form></li>`,
          )}</ul>`
        : ''}
      <form method="post" action="${href(ctx, '/dashboard/profile/positions')}" class="stack">
        ${csrfField(ctx)}
        ${o.positionError ? alert('error', ctx.t(o.positionError)) : ''}
        <div class="position-row">
          <div class="field"><label for="p-title">${ctx.t('join.position')}</label><input id="p-title" name="posTitle" maxlength="120" required></div>
          <div class="field"><label for="p-place">${ctx.t('join.workplace')}</label><input id="p-place" name="posWorkplace" maxlength="160" required></div>
          <div class="field"><label for="p-start">${ctx.t('join.from')}</label><input id="p-start" name="posStart" type="month" max="${maxMonth}" placeholder="YYYY-MM" required></div>
          <div class="field"><label for="p-end">${ctx.t('join.to')}</label><input id="p-end" name="posEnd" type="month" max="${maxMonth}" placeholder="YYYY-MM"></div>
        </div>
        <p class="hint">${ctx.t('join.toHint')}</p>
        <div><button type="submit" class="btn btn-outline">${ctx.t('profile.addPosition')}</button></div>
      </form>
    </section>`;
  return shell(ctx, doctor, 'profile', content, o.notice);
}
