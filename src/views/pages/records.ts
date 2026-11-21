import type { OrderPart } from '../../services/orderResults.js';
import { html, attrIf, type SafeHtml, type HtmlValue } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href, alternateHref } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, input, select, fieldError, errorSummary, icon } from '../components.js';
import { formatFullDate as formatDate, formatFullDateTime as formatDateTime, formatNumber, pick, type MessageKey } from '../../i18n/index.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { OwnDoctor } from '../../services/doctors.js';
import type { ReferenceData } from '../../services/reference.js';
import type {
  RecordListItem, PatientRecord, VisitSummary, VisitDetail, PrescriptionView, LabOrderView, PrintHeader,
  OrderProblem, VisitErrors, AppointmentFile, PhoneFile,
} from '../../services/records.js';
import { MAX_RX_LINES } from '../../services/records.js';
import {
  SEXES, MARITAL_STATUSES, HABITS, MEDICINE_FORMS, FREQUENCIES, TIMINGS, LAB_TESTS, LAB_GROUPS, labTest, ageOn,
} from '../../domain/clinical.js';
import { todayIn } from '../../domain/time.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { shell } from './dashboard.js';

type Notice = { kind: 'success' | 'error'; key: MessageKey };

// ---------------------------------------------------------------- small pieces

function textArea(ctx: Ctx, o: { name: string; label: string; value?: string | null; rows?: number; maxlength: number; hint?: string; errors?: FieldErrors | undefined; required?: boolean; idPrefix?: string }): SafeHtml {
  const id = `${o.idPrefix ?? ''}${o.name}`;
  const err = o.errors?.[o.name];
  const described = [o.hint ? `${id}-hint` : '', err ? `${id}-error` : ''].filter(Boolean).join(' ');
  return html`<div class="field${err ? ' has-error' : ''}">
    <label for="${id}">${o.label}</label>
    <textarea id="${id}" name="${o.name}" rows="${o.rows ?? 3}" maxlength="${o.maxlength}"${attrIf(!!o.required, 'required')}${attrIf(!!err, 'aria-invalid="true"')}
      data-dictate data-dictate-start="${ctx.t('dictate.start')}" data-dictate-stop="${ctx.t('dictate.stop')}" data-dictate-note="${ctx.t('dictate.note')}"
      data-dictate-lang="${ctx.locale === 'ar' ? 'ar-EG' : 'en-US'}" data-dictate-other="${ctx.t('dictate.otherLang')}" data-dictate-denied="${ctx.t('dictate.denied')}"
      ${described ? html`aria-describedby="${described}"` : ''}>${o.value ?? ''}</textarea>
    ${o.hint ? html`<p class="hint" id="${id}-hint">${o.hint}</p>` : ''}
    ${fieldError(ctx, o.errors, o.name, id)}
  </div>`;
}

const today = (ctx: Ctx) => todayIn(ctx.deps.cfg.TIME_ZONE, ctx.deps.now());

/** In Arabic a middle dot next to Arabic-Indic digits looks like a zero ("٢ · أدوية" reads as ٢٠), so use a dash. */
const sep = (ctx: Ctx) => (ctx.locale === 'ar' ? ' – ' : ' · ');

/** Doctors often store their name with the title already in it. */
function doctorName(ctx: Ctx, name: string): string {
  return /^(dr\.?|د\.?)\s/i.test(name) ? name : `${ctx.t('rx.doctorPrefix')} ${name}`;
}

/** "34 years · Female" style line; empty parts are skipped. */
function patientFacts(ctx: Ctx, r: { date_of_birth: string | null; sex: string | null }): string {
  const age = ageOn(r.date_of_birth, today(ctx));
  return [age !== null ? ctx.t('records.age', { n: formatNumber(age, ctx.locale) }) : '', r.sex ? ctx.t.dynamic(`records.sex.${r.sex}`) : '']
    .filter(Boolean)
    .join(sep(ctx));
}

function orderProblem(ctx: Ctx, p: OrderProblem | undefined): SafeHtml {
  if (!p) return html``;
  return alert('error', ctx.t(p.key, p.line !== undefined ? { n: formatNumber(p.line, ctx.locale) } : undefined));
}

function multiline(text: string | null): HtmlValue {
  return text ? html`<span class="prose">${text}</span>` : html`<span class="muted">—</span>`;
}

// ---------------------------------------------------------------- patients list

export function patientsListPage(ctx: Ctx, doctor: OwnDoctor, list: RecordListItem[], q: string, notice?: Notice): SafeHtml {
  const content = html`
    <div class="row-between">
      <div><h1>${ctx.t('records.title')}</h1><p class="muted">${ctx.t('records.lead')}</p></div>
      <a class="btn btn-primary" href="${href(ctx, '/dashboard/patients/new')}">${ctx.t('records.addWalkIn')}</a>
    </div>
    <form method="get" action="${href(ctx, '/dashboard/patients')}" class="search-form compact" role="search">
      <div class="search-field wide"><label class="search-label" for="q">${ctx.t('records.search')}</label>
        <input id="q" name="q" type="search" value="${q}" placeholder="${ctx.t('records.searchPlaceholder')}"></div>
      <button class="btn btn-primary btn-search" type="submit">${ctx.t('common.search')}</button>
    </form>
    <section class="panel flush">
      ${list.length
        ? html`<ul class="record-list">${list.map(
            (r) => html`<li><a class="record-row" href="${href(ctx, `/dashboard/patients/${r.id}`)}">
              <span class="stack-sm"><strong>${r.full_name}</strong>
                <span class="muted">${[patientFacts(ctx, r), r.phone_e164 ? formatEgyptMobile(r.phone_e164) : ''].filter(Boolean).join(sep(ctx))}</span></span>
              <span class="stack-sm record-row-end">
                <span class="muted">${r.last_visit_at ? ctx.t('records.lastVisit', { date: formatDate(r.last_visit_at, ctx.locale, ctx.deps.cfg.TIME_ZONE) }) : ctx.t('records.noVisits')}</span>
                ${r.patient_user_id ? html`<span class="chip status-confirmed">${ctx.t('records.onTabeeby')}</span>` : html`<span class="chip status-completed">${ctx.t('records.walkIn')}</span>`}
              </span></a></li>`,
          )}</ul>`
        : html`<div class="empty"><p>${q ? ctx.t('records.noMatch') : ctx.t('records.none')}</p></div>`}
    </section>`;
  return shell(ctx, doctor, 'patients', content, notice);
}

// ---------------------------------------------------------------- patient file form

export type RecordFormValues = Record<string, string> & { habits?: string };

function recordFields(ctx: Ctx, v: Record<string, string>, habits: string[], errors: FieldErrors | undefined): SafeHtml {
  const opt = (prefix: string, list: readonly string[]) => [{ value: '', label: '—' }, ...list.map((x) => ({ value: x, label: ctx.t.dynamic(`${prefix}.${x}`) }))];
  return html`
    <fieldset class="form-grid">
      <legend>${ctx.t('records.personal')}</legend>
      ${input(ctx, { name: 'fullName', label: ctx.t('records.fullName'), value: v['fullName'], errors, maxlength: 120, required: true, autocomplete: 'off' })}
      ${input(ctx, { name: 'phone', label: ctx.t('records.phone'), type: 'tel', inputmode: 'tel', value: v['phone'], errors, hint: ctx.t('common.optional') })}
      ${input(ctx, { name: 'dateOfBirth', label: ctx.t('records.dob'), type: 'date', value: v['dateOfBirth'], errors, hint: ctx.t('records.dobHint') })}
      ${select(ctx, { name: 'sex', label: ctx.t('records.sex'), value: v['sex'] ?? '', options: opt('records.sex', SEXES) })}
      ${input(ctx, { name: 'occupation', label: ctx.t('records.occupation'), value: v['occupation'], maxlength: 120 })}
      ${select(ctx, { name: 'maritalStatus', label: ctx.t('records.marital'), value: v['maritalStatus'] ?? '', options: opt('records.marital', MARITAL_STATUSES) })}
    </fieldset>
    <fieldset class="stack-sm">
      <legend>${ctx.t('records.habits')}</legend>
      <div class="check-grid">${HABITS.map(
        (h) => html`<label class="check"><input type="checkbox" name="habits" value="${h}"${attrIf(habits.includes(h), 'checked')}><span>${ctx.t.dynamic(`records.habit.${h}`)}</span></label>`,
      )}</div>
      ${input(ctx, { name: 'habitsNote', label: ctx.t('records.habitsNote'), value: v['habitsNote'], maxlength: 500, hint: ctx.t('records.habitsNoteHint') })}
    </fieldset>
    <fieldset class="form-grid">
      <legend>${ctx.t('records.background')}</legend>
      ${textArea(ctx, { name: 'allergies', label: ctx.t('records.allergies'), value: v['allergies'], maxlength: 2000, rows: 2, hint: ctx.t('records.allergiesHint') })}
      ${textArea(ctx, { name: 'chronicConditions', label: ctx.t('records.chronic'), value: v['chronicConditions'], maxlength: 2000, rows: 2 })}
      ${textArea(ctx, { name: 'pastHistory', label: ctx.t('records.pastHistory'), value: v['pastHistory'], maxlength: 2000, rows: 2 })}
      ${textArea(ctx, { name: 'currentMedications', label: ctx.t('records.currentMeds'), value: v['currentMedications'], maxlength: 2000, rows: 2 })}
      ${textArea(ctx, { name: 'familyHistory', label: ctx.t('records.familyHistory'), value: v['familyHistory'], maxlength: 2000, rows: 2 })}
    </fieldset>`;
}

export function recordValuesFrom(r: PatientRecord): Record<string, string> {
  return {
    fullName: r.full_name,
    phone: r.phone_e164 ? '0' + r.phone_e164.slice(3) : '',
    dateOfBirth: r.date_of_birth ?? '',
    sex: r.sex ?? '',
    occupation: r.occupation ?? '',
    maritalStatus: r.marital_status ?? '',
    habitsNote: r.habits_note ?? '',
    allergies: r.allergies ?? '',
    chronicConditions: r.chronic_conditions ?? '',
    pastHistory: r.past_history ?? '',
    currentMedications: r.current_medications ?? '',
    familyHistory: r.family_history ?? '',
  };
}

export function newRecordPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  o: { values: Record<string, string>; habits: string[]; errors?: FieldErrors; appointment?: Extract<AppointmentFile, { kind: 'new' }>; linkError?: MessageKey; samePhone?: PhoneFile[] },
): SafeHtml {
  const appt = o.appointment;
  const tz = ctx.deps.cfg.TIME_ZONE;
  const content = html`
    <a href="${href(ctx, '/dashboard/patients')}">← ${ctx.t('records.title')}</a>
    <div><h1>${ctx.t(appt ? 'records.newFromAppt' : 'records.newWalkIn')}</h1>
      <p class="muted">${ctx.t(appt ? 'records.newFromApptLead' : 'records.newWalkInLead')}</p></div>
    ${o.linkError ? alert('error', ctx.t(o.linkError)) : ''}
    ${appt && appt.walkIns.length
      ? html`<section class="panel stack">
          <h2>${ctx.t('records.linkTitle')}</h2>
          <p class="muted">${ctx.t('records.linkLead', { phone: formatEgyptMobile(appt.patientPhone) })}</p>
          <ul class="appt-list">${appt.walkIns.map(
            (w) => html`<li class="appt-row"><span><strong>${w.full_name}</strong> <span class="muted">· ${ctx.t('records.created', { date: formatDate(w.created_at, ctx.locale, ctx.deps.cfg.TIME_ZONE) })}</span></span>
              <form method="post" action="${href(ctx, `/dashboard/patients/${w.id}/link`)}">${csrfField(ctx)}
                <input type="hidden" name="appointment" value="${appt.appointmentId}">
                <button class="btn btn-outline btn-sm" type="submit">${ctx.t('records.linkThis')}</button></form></li>`,
          )}</ul>
        </section>`
      : ''}
    ${o.samePhone?.length
      ? html`<section class="panel stack alert-panel" role="alert">
          <h2>${ctx.t('records.samePhoneTitle')}</h2>
          <p>${ctx.t('records.samePhoneLead')}</p>
          <ul class="appt-list">${o.samePhone.map(
            (f) => html`<li class="appt-row"><span><strong dir="auto">${f.full_name}</strong> <span class="muted">· ${ctx.t('records.created', { date: formatDate(f.created_at, ctx.locale, tz) })}</span></span>
              <a class="btn btn-primary btn-sm" href="${appt && !f.patient_user_id ? href(ctx, `/dashboard/patients/${f.id}/visits/new`, { appointment: appt.appointmentId }) : href(ctx, `/dashboard/patients/${f.id}`)}">${ctx.t('records.openThisFile')}</a></li>`,
          )}</ul>
          <p class="small muted">${ctx.t('records.samePhoneNew')}</p>
        </section>`
      : ''}
    <form method="post" action="${href(ctx, '/dashboard/patients')}" class="panel stack-lg" novalidate>
      ${csrfField(ctx)}
      ${appt ? html`<input type="hidden" name="appointment" value="${appt.appointmentId}">` : ''}
      ${o.samePhone?.length ? html`<input type="hidden" name="newPerson" value="yes">` : ''}
      ${errorSummary(ctx, o.errors)}
      ${recordFields(ctx, o.values, o.habits, o.errors)}
      <div class="field${o.errors?.['consent'] ? ' has-error' : ''}">
        <label class="check"><input type="checkbox" name="consent" value="yes" required${attrIf(o.values['consent'] === 'yes', 'checked')}><span>${ctx.t('records.consent')}</span></label>
        ${fieldError(ctx, o.errors, 'consent')}
      </div>
      <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t(o.samePhone?.length ? 'records.createAnyway' : 'records.create')}</button></div>
    </form>`;
  return shell(ctx, doctor, 'patients', content);
}

export function editRecordPage(ctx: Ctx, doctor: OwnDoctor, r: PatientRecord, o: { values: Record<string, string>; habits: string[]; errors?: FieldErrors }): SafeHtml {
  const content = html`
    <a href="${href(ctx, `/dashboard/patients/${r.id}`)}">← ${r.full_name}</a>
    <h1>${ctx.t('records.edit')}</h1>
    <form method="post" action="${href(ctx, `/dashboard/patients/${r.id}`)}" class="panel stack-lg" novalidate>
      ${csrfField(ctx)}
      ${errorSummary(ctx, o.errors)}
      ${recordFields(ctx, o.values, o.habits, o.errors)}
      <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('common.save')}</button></div>
    </form>`;
  return shell(ctx, doctor, 'patients', content);
}

// ---------------------------------------------------------------- patient file

export function recordPage(ctx: Ctx, doctor: OwnDoctor, r: PatientRecord & { account_phone: string | null }, visits: VisitSummary[], notice?: Notice): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const phone = r.phone_e164 ?? r.account_phone;
  const row = (label: MessageKey, value: HtmlValue) => html`<div><dt>${ctx.t(label)}</dt><dd>${value}</dd></div>`;
  const content = html`
    <a href="${href(ctx, '/dashboard/patients')}">← ${ctx.t('records.title')}</a>
    <div class="row-between align-start">
      <div class="stack-sm"><h1>${r.full_name}</h1>
        <p class="muted">${[patientFacts(ctx, r), phone ? formatEgyptMobile(phone) : ''].filter(Boolean).join(sep(ctx))}</p>
        <p class="hint">${ctx.t(r.patient_user_id ? 'records.linkedNote' : 'records.walkInNote')}</p></div>
      <div class="row-wrap">
        <a class="btn btn-primary" href="${href(ctx, `/dashboard/patients/${r.id}/visits/new`)}">${ctx.t('visit.new')}</a>
        <a class="btn btn-outline" href="${href(ctx, `/dashboard/patients/${r.id}/edit`)}">${ctx.t('records.edit')}</a>
      </div>
    </div>
    ${r.allergies ? alert('warning', html`<span class="prose">${r.allergies}</span>`, ctx.t('records.allergies')) : ''}
    <div class="card-grid two">
      <section class="panel stack">
        <h2>${ctx.t('records.personal')}</h2>
        <dl class="summary">
          ${row('records.dob', r.date_of_birth ? html`<span dir="ltr">${r.date_of_birth}</span>` : '—')}
          ${row('records.sex', r.sex ? ctx.t.dynamic(`records.sex.${r.sex}`) : '—')}
          ${row('records.marital', r.marital_status ? ctx.t.dynamic(`records.marital.${r.marital_status}`) : '—')}
          ${row('records.occupation', r.occupation ?? '—')}
          ${row('records.habits', [r.habits.map((h) => ctx.t.dynamic(`records.habit.${h}`)).join('، '), r.habits_note ?? ''].filter(Boolean).join(' — ') || '—')}
        </dl>
      </section>
      <section class="panel stack">
        <h2>${ctx.t('records.background')}</h2>
        <dl class="summary">
          ${row('records.chronic', multiline(r.chronic_conditions))}
          ${row('records.pastHistory', multiline(r.past_history))}
          ${row('records.currentMeds', multiline(r.current_medications))}
          ${row('records.familyHistory', multiline(r.family_history))}
        </dl>
      </section>
    </div>
    <section class="panel stack">
      <h2>${ctx.t('visit.history')}</h2>
      ${visits.length
        ? html`<ol class="visit-timeline">${visits.map(
            (v) => html`<li><a class="record-row" href="${href(ctx, `/dashboard/visits/${v.id}`)}">
              <span class="stack-sm"><strong>${formatDate(v.visit_at, ctx.locale, tz)}</strong>
                <span>${v.chief_complaint}</span>
                ${v.diagnosis ? html`<span class="muted">${ctx.t('visit.diagnosis')}: ${v.diagnosis}</span>` : ''}</span>
              <span class="row-wrap record-row-end">
                ${v.clinic_name ? html`<span class="muted">${v.clinic_name}</span>` : ''}
                ${v.prescriptions ? html`<span class="chip status-confirmed">${ctx.t('visit.rxCount', { n: formatNumber(v.prescriptions, ctx.locale) })}</span>` : ''}
                ${v.lab_orders ? html`<span class="chip status-arrived">${ctx.t('visit.labCount', { n: formatNumber(v.lab_orders, ctx.locale) })}</span>` : ''}
              </span></a></li>`,
          )}</ol>`
        : html`<p class="muted">${ctx.t('records.noVisits')}</p>`}
    </section>`;
  return shell(ctx, doctor, 'patients', content, notice);
}

// ---------------------------------------------------------------- prescription and lab fields

export interface RxFormValues {
  lines: { medicine: string; form: string; dose: string; frequency: string; timing: string; duration: string; instructions: string }[];
  notes: string;
}
export interface LabFormValues {
  codes: string[];
  other: string;
  notes: string;
}

const emptyLine = () => ({ medicine: '', form: '', dose: '', frequency: '', timing: '', duration: '', instructions: '' });

/** Medicine lines. A few blank lines are always offered; JavaScript can add more. */
function rxFields(ctx: Ctx, v: RxFormValues | undefined, problem: OrderProblem | undefined, minLines = 2): SafeHtml {
  const lines = [...(v?.lines ?? [])].filter((l) => Object.values(l).some((x) => x.trim()));
  while (lines.length < minLines) lines.push(emptyLine());
  if (lines.length < MAX_RX_LINES && v) lines.push(emptyLine());
  const opts = (prefix: string, list: readonly string[], value: string, blank: string) =>
    html`<option value=""${attrIf(value === '', 'selected')}>${blank}</option>${list.map((x) => html`<option value="${x}"${attrIf(x === value, 'selected')}>${ctx.t.dynamic(`${prefix}.${x}`)}</option>`)}`;
  return html`<div class="stack" data-rx>
    ${orderProblem(ctx, problem)}
    <ol class="rx-lines" data-rx-lines>${lines.slice(0, MAX_RX_LINES).map(
      (l) => html`<li class="rx-line" data-rx-line>
        <label class="rx-medicine"><span>${ctx.t('rx.medicine')}</span>
          <input name="rx_medicine" value="${l.medicine}" list="medicine-list" maxlength="160" autocomplete="off" placeholder="${ctx.t('rx.medicinePlaceholder')}" data-medicine></label>
        <label><span>${ctx.t('rx.form')}</span><select name="rx_form" data-form>${opts('rx.form', MEDICINE_FORMS, l.form, '—')}</select></label>
        <label><span>${ctx.t('rx.dose')}</span><input name="rx_dose" value="${l.dose}" maxlength="60" placeholder="${ctx.t('rx.dosePlaceholder')}"></label>
        <label><span>${ctx.t('rx.frequency')}</span><select name="rx_frequency">${opts('rx.freq', FREQUENCIES, l.frequency, '—')}</select></label>
        <label><span>${ctx.t('rx.timing')}</span><select name="rx_timing">${opts('rx.timing', TIMINGS, l.timing, ctx.t('rx.timingAny'))}</select></label>
        <label><span>${ctx.t('rx.duration')}</span><input name="rx_duration" value="${l.duration}" maxlength="60" placeholder="${ctx.t('rx.durationPlaceholder')}"></label>
        <label class="rx-instructions"><span>${ctx.t('rx.instructions')}</span><input name="rx_instructions" value="${l.instructions}" maxlength="200" placeholder="${ctx.t('rx.instructionsPlaceholder')}"></label>
      </li>`,
    )}</ol>
    <div><button type="button" class="btn btn-outline btn-sm" data-rx-add data-max="${MAX_RX_LINES}" hidden>${ctx.t('rx.addLine')}</button></div>
    ${textArea(ctx, { name: 'rx_notes', label: ctx.t('rx.notes'), value: v?.notes, rows: 2, maxlength: 500, hint: ctx.t('rx.notesHint'), idPrefix: 'rx-' })}
  </div>`;
}

function medicineList(medicines: { name: string; form: string }[]): SafeHtml {
  return html`<datalist id="medicine-list">${medicines.map((m) => html`<option value="${m.name}" data-form="${m.form}"></option>`)}</datalist>`;
}

function labFields(ctx: Ctx, v: LabFormValues | undefined, problem: OrderProblem | undefined): SafeHtml {
  const chosen = new Set(v?.codes ?? []);
  return html`<div class="stack">
    ${orderProblem(ctx, problem)}
    ${LAB_GROUPS.map((g) => {
      const tests = LAB_TESTS.filter((t) => t.group === g);
      const picked = tests.filter((t) => chosen.has(t.code)).length;
      return html`<details class="lab-group"${attrIf(picked > 0, 'open')}><summary>${ctx.t.dynamic(`lab.group.${g}`)} <span class="muted">(${formatNumber(tests.length, ctx.locale)})</span></summary>
        <div class="check-grid">${tests.map(
          (t) => html`<label class="check"><input type="checkbox" name="lab_code" value="${t.code}"${attrIf(chosen.has(t.code), 'checked')}><span>${pick(ctx.locale, { name_en: t.en, name_ar: t.ar })}</span></label>`,
        )}</div></details>`;
    })}
    ${textArea(ctx, { name: 'lab_other', label: ctx.t('lab.other'), value: v?.other, rows: 2, maxlength: 2000, hint: ctx.t('lab.otherHint'), idPrefix: 'lab-' })}
    ${textArea(ctx, { name: 'lab_notes', label: ctx.t('lab.notes'), value: v?.notes, rows: 2, maxlength: 500, hint: ctx.t('lab.notesHint'), idPrefix: 'lab-' })}
  </div>`;
}

export interface NotesValues {
  complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  plan: string;
}

/**
 * DEMO ONLY: the fictional "Tabeeby AI" panel. It reads the notes above when the doctor asks and
 * suggests possibilities; the doctor decides what, if anything, goes into the diagnosis or plan.
 */
function demoAssistantPanel(ctx: Ctx, recordId: string): SafeHtml {
  if (!ctx.deps.cfg.DEMO_MODE) return html``;
  const t = (k: MessageKey) => ctx.t(k);
  return html`<div class="ai-panel" data-ai-assist data-url="${href(ctx, '/dashboard/ai-assist')}" data-record="${recordId}"
      data-l-steps="${[t('ai.step1'), t('ai.step2'), t('ai.step3')].join('|')}" data-l-ddx="${t('ai.ddx')}" data-l-tests="${t('ai.tests')}"
      data-l-flags="${t('ai.flags')}" data-l-ask="${t('ai.ask')}" data-l-cautions="${t('ai.cautions')}" data-l-none="${t('ai.none')}"
      data-l-error="${t('ai.error')}" data-l-add-dx="${t('ai.addDx')}" data-l-add-plan="${t('ai.addPlan')}" data-l-added="${t('ai.added')}"
      data-l-high="${t('ai.high')}" data-l-medium="${t('ai.medium')}" data-l-low="${t('ai.low')}">
    <div class="ai-head"><span class="ai-mark" aria-hidden="true">✦</span><strong>${t('ai.title')}</strong><span class="chip ai-chip">${t('ai.demoChip')}</span></div>
    <p class="small muted">${t('ai.lead')}</p>
    <div><button type="button" class="btn btn-outline btn-sm" data-ai-run>${t('ai.run')}</button></div>
    <div class="ai-out" aria-live="polite"></div>
  </div>`;
}

function notesFields(ctx: Ctx, v: Partial<NotesValues>, errors: FieldErrors | undefined, idPrefix = '', recordId?: string): SafeHtml {
  return html`
    ${textArea(ctx, { idPrefix, name: 'complaint', label: ctx.t('visit.complaint'), value: v.complaint, rows: 2, maxlength: 500, required: true, errors, hint: ctx.t('visit.complaintHint') })}
    ${textArea(ctx, { idPrefix, name: 'history', label: ctx.t('visit.historyField'), value: v.history, rows: 3, maxlength: 4000, hint: ctx.t('visit.historyHint') })}
    ${textArea(ctx, { idPrefix, name: 'examination', label: ctx.t('visit.examination'), value: v.examination, rows: 3, maxlength: 4000, hint: ctx.t('visit.examinationHint') })}
    ${recordId ? demoAssistantPanel(ctx, recordId) : ''}
    ${textArea(ctx, { idPrefix, name: 'diagnosis', label: ctx.t('visit.diagnosis'), value: v.diagnosis, rows: 2, maxlength: 1000 })}
    ${textArea(ctx, { idPrefix, name: 'plan', label: ctx.t('visit.plan'), value: v.plan, rows: 3, maxlength: 4000, hint: ctx.t('visit.planHint') })}`;
}

// ---------------------------------------------------------------- new visit

export function newVisitPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  r: PatientRecord,
  o: { appointmentId: string | null; notes?: Partial<NotesValues>; rx?: RxFormValues; lab?: LabFormValues; errors?: VisitErrors; medicines: { name: string; form: string }[]; notice?: MessageKey },
): SafeHtml {
  const content = html`
    <a href="${href(ctx, `/dashboard/patients/${r.id}`)}">← ${r.full_name}</a>
    <div><h1>${ctx.t('visit.new')}</h1><p class="muted">${[r.full_name, patientFacts(ctx, r)].filter(Boolean).join(sep(ctx))}</p></div>
    ${o.notice ? alert('info', ctx.t(o.notice)) : ''}
    ${r.allergies ? alert('warning', html`<span class="prose">${r.allergies}</span>`, ctx.t('records.allergies')) : ''}
    <form method="post" action="${href(ctx, `/dashboard/patients/${r.id}/visits`)}" class="stack-lg" novalidate>
      ${csrfField(ctx)}
      ${o.appointmentId ? html`<input type="hidden" name="appointment" value="${o.appointmentId}">` : ''}
      ${o.errors?.general ? alert('error', ctx.t(o.errors.general)) : ''}
      ${o.errors && (o.errors.fields || o.errors.rx || o.errors.lab) ? alert('error', ctx.t('visit.err.nothingSaved')) : ''}
      <section class="panel stack"><h2>${ctx.t('visit.notes')}</h2>${notesFields(ctx, o.notes ?? {}, o.errors?.fields, '', r.id)}</section>
      <section class="panel stack"><h2>${ctx.t('rx.title')}</h2><p class="hint">${ctx.t('rx.lead')}</p>${rxFields(ctx, o.rx, o.errors?.rx)}</section>
      <section class="panel stack"><h2>${ctx.t('lab.title')}</h2><p class="hint">${ctx.t('lab.lead')}</p>${labFields(ctx, o.lab, o.errors?.lab)}</section>
      <div class="row-wrap"><button class="btn btn-primary btn-lg" type="submit">${ctx.t('visit.save')}</button>
        <a class="btn btn-ghost" href="${href(ctx, `/dashboard/patients/${r.id}`)}">${ctx.t('common.cancel')}</a></div>
      ${medicineList(o.medicines)}
    </form>`;
  return shell(ctx, doctor, 'patients', content);
}

// ---------------------------------------------------------------- one visit

function rxLineText(ctx: Ctx, l: PrescriptionView['items'][number]): SafeHtml {
  const parts: HtmlValue[] = [html`<bdi>${l.dose}</bdi>`, ctx.t.dynamic(`rx.freq.${l.frequency}`)];
  if (l.timing) parts.push(ctx.t.dynamic(`rx.timing.${l.timing}`));
  if (l.duration) {
    const [before, after] = ctx.t('rx.forDuration', { d: '\u0000' }).split('\u0000');
    parts.push(html`${before ?? ''}<bdi>${l.duration}</bdi>${after ?? ''}`);
  }
  return html`${parts.map((p, i) => html`${i ? sep(ctx) : ''}${p}`)}`;
}

function voidForm(ctx: Ctx, action: string, idPrefix: string, label: MessageKey): SafeHtml {
  return html`<details class="void-box"><summary class="btn btn-ghost btn-sm">${ctx.t(label)}</summary>
    <form method="post" action="${action}" class="stack-sm">${csrfField(ctx)}
      <div class="field"><label for="${idPrefix}-reason">${ctx.t('rx.voidReason')}</label>
        <input id="${idPrefix}-reason" name="reason" maxlength="300" required minlength="3"></div>
      <div><button class="btn btn-outline btn-sm" type="submit">${ctx.t('rx.voidConfirm')}</button></div></form></details>`;
}

function voidedNote(ctx: Ctx, o: { status: string; void_reason: string | null; voided_at: Date | null }): SafeHtml {
  return o.status === 'voided'
    ? html`<p class="voided-note">${ctx.t('rx.voided', { date: formatDateTime(o.voided_at!, ctx.locale, ctx.deps.cfg.TIME_ZONE) })} — ${o.void_reason ?? ''}</p>`
    : html``;
}

export function visitPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  r: PatientRecord,
  v: VisitDetail,
  o: {
    medicines: { name: string; form: string }[];
    notesErrors?: FieldErrors;
    notesValues?: Partial<NotesValues>;
    rx?: RxFormValues;
    rxError?: OrderProblem;
    lab?: LabFormValues;
    labError?: OrderProblem;
    notice?: Notice;
    error?: MessageKey;
    /** Where the patient sent each order part ("<labOrderId>:lab|imaging") and the released results. */
    orderResults?: Map<string, OrderPart['request']>;
  },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const notes: Partial<NotesValues> = o.notesValues ?? { complaint: v.chief_complaint, history: v.history ?? '', examination: v.examination ?? '', diagnosis: v.diagnosis ?? '', plan: v.plan ?? '' };
  const noteRow = (label: MessageKey, value: string | null) => html`<div><dt>${ctx.t(label)}</dt><dd>${multiline(value)}</dd></div>`;
  const content = html`
    <a href="${href(ctx, `/dashboard/patients/${r.id}`)}">← ${r.full_name}</a>
    <div class="stack-sm"><h1>${ctx.t('visit.of', { date: formatDate(v.visit_at, ctx.locale, tz) })}</h1>
      <p class="muted">${[r.full_name, patientFacts(ctx, r), v.clinic_name ?? ''].filter(Boolean).join(sep(ctx))}</p></div>
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${r.allergies ? alert('warning', html`<span class="prose">${r.allergies}</span>`, ctx.t('records.allergies')) : ''}
    <section class="panel stack">
      <h2>${ctx.t('visit.notes')}</h2>
      <dl class="summary">
        ${noteRow('visit.complaint', v.chief_complaint)}
        ${noteRow('visit.historyField', v.history)}
        ${noteRow('visit.examination', v.examination)}
        ${noteRow('visit.diagnosis', v.diagnosis)}
        ${noteRow('visit.plan', v.plan)}
      </dl>
      ${v.updated_at.getTime() - v.created_at.getTime() > 1000 ? html`<p class="hint">${ctx.t('visit.edited', { date: formatDateTime(v.updated_at, ctx.locale, tz) })}</p>` : ''}
      <details${attrIf(!!o.notesErrors, 'open')}><summary class="btn btn-outline btn-sm">${ctx.t('visit.editNotes')}</summary>
        <form method="post" action="${href(ctx, `/dashboard/visits/${v.id}`)}" class="stack" novalidate>${csrfField(ctx)}
          ${notesFields(ctx, notes, o.notesErrors, 'edit-', r.id)}
          <div><button class="btn btn-primary" type="submit">${ctx.t('common.save')}</button></div></form>
      </details>
    </section>
    <section class="panel stack">
      <h2>${ctx.t('rx.title')}</h2>
      ${v.prescriptions.length ? v.prescriptions.map((p, i) => html`<article class="order-card${p.status === 'voided' ? ' voided' : ''}">
          <div class="row-between"><strong>${ctx.t('rx.numbered', { n: formatNumber(i + 1, ctx.locale) })}${sep(ctx)}${formatDateTime(p.issued_at, ctx.locale, tz)}</strong>
            <div class="row-wrap">
              <a class="btn btn-outline btn-sm" href="${href(ctx, `/dashboard/prescriptions/${p.id}/print`)}">${ctx.t('rx.print')}</a>
              ${p.status === 'active' ? voidForm(ctx, href(ctx, `/dashboard/prescriptions/${p.id}/void`), `rx${i}`, 'rx.void') : ''}
            </div></div>
          ${voidedNote(ctx, p)}
          <ol class="rx-print-list">${p.items.map((l) => html`<li><strong><bdi>${l.medicine}</bdi></strong> <span class="muted">(${ctx.t.dynamic(`rx.form.${l.form}`)})</span>
            <div>${rxLineText(ctx, l)}</div>${l.instructions ? html`<div class="muted" dir="auto">${l.instructions}</div>` : ''}</li>`)}</ol>
          ${p.notes ? html`<p class="prose">${p.notes}</p>` : ''}
        </article>`) : html`<p class="muted">${ctx.t('rx.none')}</p>`}
      <details${attrIf(!!o.rxError, 'open')}><summary class="btn btn-primary btn-sm">${ctx.t('rx.add')}</summary>
        <form method="post" action="${href(ctx, `/dashboard/visits/${v.id}/prescriptions`)}" class="stack" novalidate>${csrfField(ctx)}
          ${rxFields(ctx, o.rx, o.rxError)}
          <div><button class="btn btn-primary" type="submit">${ctx.t('rx.issue')}</button></div></form>
      </details>
    </section>
    <section class="panel stack">
      <h2>${ctx.t('lab.title')}</h2>
      ${v.labOrders.length ? v.labOrders.map((l, i) => html`<article class="order-card${l.status === 'voided' ? ' voided' : ''}">
          <div class="row-between"><strong>${ctx.t('lab.numbered', { n: formatNumber(i + 1, ctx.locale) })}${sep(ctx)}${formatDateTime(l.issued_at, ctx.locale, tz)}</strong>
            <div class="row-wrap">
              <a class="btn btn-outline btn-sm" href="${href(ctx, `/dashboard/lab-orders/${l.id}/print`)}">${ctx.t('rx.print')}</a>
              ${l.status === 'active' ? voidForm(ctx, href(ctx, `/dashboard/lab-orders/${l.id}/void`), `lab${i}`, 'lab.void') : ''}
            </div></div>
          ${voidedNote(ctx, l)}
          <ul class="lab-print-list">${l.items.map((it) => html`<li><bdi>${labItemName(ctx, it)}</bdi></li>`)}</ul>
          ${l.notes ? html`<p class="prose">${l.notes}</p>` : ''}
          ${(['lab', 'imaging'] as const).map((section) => {
            const q = o.orderResults?.get(`${l.id}:${section}`);
            if (!q) return '';
            return html`<div class="hr-request stack-sm" data-testid="doctor-results">
              <span class="small">${ctx.t('hr.doctor.sentTo', { centre: q.facilityName })}${sep(ctx)}<strong>${ctx.t(q.status === 'ready' ? 'hr.status.ready' : q.status === 'received' ? 'hr.status.received' : 'hr.status.sent')}</strong></span>
              ${q.status === 'ready' ? html`${q.facilityNote ? html`<p class="hr-note" dir="auto">${q.facilityNote}</p>` : ''}
                <ul class="result-files">${q.results.map((f, n) => html`<li><a href="${href(ctx, `/results/${f.id}`)}" target="_blank" rel="noopener">${icon.upload}${ctx.t('hr.resultFile', { n: formatNumber(n + 1, ctx.locale) })} (${f.mime === 'application/pdf' ? 'PDF' : ctx.t('hr.image')})</a></li>`)}</ul>` : ''}
            </div>`;
          })}
        </article>`) : html`<p class="muted">${ctx.t('lab.none')}</p>`}
      <details${attrIf(!!o.labError, 'open')}><summary class="btn btn-primary btn-sm">${ctx.t('lab.add')}</summary>
        <form method="post" action="${href(ctx, `/dashboard/visits/${v.id}/lab-orders`)}" class="stack" novalidate>${csrfField(ctx)}
          ${labFields(ctx, o.lab, o.labError)}
          <div><button class="btn btn-primary" type="submit">${ctx.t('lab.issue')}</button></div></form>
      </details>
    </section>
    ${medicineList(o.medicines)}`;
  return shell(ctx, doctor, 'patients', content, o.notice);
}

export function labItemName(ctx: Ctx, it: { test_code: string | null; test_name: string | null }): string {
  if (it.test_code) {
    const t = labTest(it.test_code);
    return t ? pick(ctx.locale, { name_en: t.en, name_ar: t.ar }) : it.test_code;
  }
  return it.test_name ?? '';
}

// ---------------------------------------------------------------- printable pages

function printDocument(ctx: Ctx, title: string, back: string, body: SafeHtml, extraActions: SafeHtml = html``): SafeHtml {
  const dir = ctx.locale === 'ar' ? 'rtl' : 'ltr';
  return html`<html lang="${ctx.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
<script src="/static/app.js" defer></script>
</head>
<body class="print-page">
<div class="print-toolbar no-print">
  <a class="btn btn-ghost" href="${back}">← ${ctx.t('common.back')}</a>
  <a class="btn btn-outline" href="${alternateHref(ctx)}" hreflang="${ctx.locale === 'ar' ? 'en' : 'ar'}">${ctx.t('rx.printOtherLanguage')}</a>
  ${extraActions}
  <button type="button" class="btn btn-primary" data-print hidden>${ctx.t('rx.print')}</button>
</div>
<main class="sheet">${body}</main>
</body>
</html>`;
}

function sheetHeader(ctx: Ctx, h: PrintHeader, ref: ReferenceData, kind: MessageKey): SafeHtml {
  const spec = ref.specialtyById.get(h.specialty_id);
  const title = ctx.locale === 'ar' ? h.doctor_title_ar : h.doctor_title_en;
  const tz = ctx.deps.cfg.TIME_ZONE;
  return html`<header class="sheet-head">
    <div class="stack-sm">
      <strong class="sheet-doctor"><bdi>${doctorName(ctx, h.doctor_name)}</bdi></strong>
      ${spec ? html`<span>${pick(ctx.locale, spec)}</span>` : ''}
      ${title ? html`<span class="muted">${title}</span>` : ''}
    </div>
    <div class="stack-sm sheet-clinic">
      ${h.clinic_name ? html`<strong dir="auto">${h.clinic_name}</strong>` : ''}
      ${h.clinic_address ? html`<span dir="auto">${h.clinic_address}</span>` : ''}
      ${h.clinic_phone ? html`<span dir="ltr">${formatEgyptMobile(h.clinic_phone)}</span>` : ''}
    </div>
  </header>
  <div class="sheet-patient">
    <span><span class="muted">${ctx.t('rx.patient')}:</span> <strong><bdi>${h.patient_name}</bdi></strong></span>
    ${patientFacts(ctx, h) ? html`<span>${patientFacts(ctx, h)}</span>` : ''}
    <span><span class="muted">${ctx.t('rx.date')}:</span> ${formatDate(h.visit_at, ctx.locale, tz)}</span>
  </div>
  <h1 class="sheet-title">${ctx.t(kind)}</h1>`;
}

function sheetFooter(ctx: Ctx, id: string): SafeHtml {
  return html`<footer class="sheet-foot">
    <div class="signature"><span>${ctx.t('rx.signature')}</span></div>
    <p class="muted">${ctx.t('rx.issuedVia', { ref: id.slice(0, 8).toUpperCase() })}</p>
  </footer>`;
}

export function prescriptionPrintPage(ctx: Ctx, ref: ReferenceData, h: PrintHeader, rx: PrescriptionView, back: string): SafeHtml {
  const body = html`
    ${sheetHeader(ctx, h, ref, 'rx.sheetTitle')}
    ${rx.status === 'voided' ? html`<p class="voided-stamp">${ctx.t('rx.voidedStamp')} — ${rx.void_reason ?? ''}</p>` : ''}
    <ol class="rx-print-list sheet-list">${rx.items.map(
      (l) => html`<li><div><strong dir="auto">${l.medicine}</strong> <span class="muted">(${ctx.t.dynamic(`rx.form.${l.form}`)})</span></div>
        <div>${rxLineText(ctx, l)}</div>${l.instructions ? html`<div class="muted" dir="auto">${l.instructions}</div>` : ''}</li>`,
    )}</ol>
    ${rx.notes ? html`<p class="prose" dir="auto">${rx.notes}</p>` : ''}
    ${sheetFooter(ctx, rx.id)}`;
  return printDocument(ctx, `${ctx.t('rx.sheetTitle')} — ${h.patient_name}`, back, body);
}

export function labOrderPrintPage(ctx: Ctx, ref: ReferenceData, h: PrintHeader, lab: LabOrderView, back: string, forPatient = false): SafeHtml {
  const body = html`
    ${sheetHeader(ctx, h, ref, 'lab.sheetTitle')}
    ${lab.status === 'voided' ? html`<p class="voided-stamp">${ctx.t('rx.voidedStamp')} — ${lab.void_reason ?? ''}</p>` : ''}
    <ul class="lab-print-list sheet-list">${lab.items.map((it) => html`<li dir="auto">${labItemName(ctx, it)}</li>`)}</ul>
    ${lab.notes ? html`<p class="prose" dir="auto">${lab.notes}</p>` : ''}
    ${sheetFooter(ctx, lab.id)}`;
  // For the patient: compare labs / scan centres that do these tests (nothing is sent to them).
  const codes = lab.items.map((it) => it.test_code).filter((c): c is string => !!c);
  const isScan = (c: string) => ['imaging', 'dental'].includes(labTest(c)?.group ?? '');
  const labCodes = codes.filter((c) => !isScan(c));
  const scanCodes = codes.filter(isScan);
  const find =
    forPatient && lab.status !== 'voided'
      ? html`${labCodes.length ? html`<a class="btn btn-outline" href="${href(ctx, '/labs', { tests: labCodes.join(',') })}">${ctx.t('lab.findLab')}</a>` : ''}
          ${scanCodes.length ? html`<a class="btn btn-outline" href="${href(ctx, '/scan-centres', { tests: scanCodes.join(',') })}">${ctx.t('lab.findScan')}</a>` : ''}`
      : html``;
  return printDocument(ctx, `${ctx.t('lab.sheetTitle')} — ${h.patient_name}`, back, body, find);
}
