import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon } from '../components.js';
import { formatFullDate, formatFullDateTime, formatNumber, formatTime, type MessageKey } from '../../i18n/index.js';
import { formatLinkCode } from '../../services/accountLink.js';
import { labItemName } from './records.js';
import { facilityShell } from './facilities.js';
import type { OwnFacility } from '../../services/facilities.js';
import {
  PHARMACY_REPLIES, MAX_PATIENT_NOTE, MAX_PHARMACY_NOTE,
  type PharmacyChoice, type PharmacyInboxItem, type RxItem,
} from '../../services/pharmacyRequests.js';
import type { PrescriptionSummary } from '../../services/orderResults.js';
import {
  MAX_FACILITY_NOTE,
  type CentreChoice, type CentreRequest, type HealthRecord, type KidneyResult, type OrderPart, type RequestStatus, type ResultFile, type Section,
} from '../../services/orderResults.js';
import { prepFor, mayNeedContrast } from '../../domain/labPrep.js';

export type HealthTab = 'prescriptions' | 'lab' | 'imaging';
export const HEALTH_TABS: readonly HealthTab[] = ['prescriptions', 'lab', 'imaging'];

const sep = (ctx: Ctx) => (ctx.locale === 'ar' ? ' – ' : ' · ');

const STATUS_KEY: Record<Exclude<RequestStatus, 'cancelled'>, MessageKey> = {
  sent: 'hr.status.sent',
  received: 'hr.status.received',
  ready: 'hr.status.ready',
};

function fileLabel(ctx: Ctx, f: ResultFile, i: number): string {
  const kind = f.mime === 'application/pdf' ? 'PDF' : ctx.t('hr.image');
  const kb = Math.max(1, Math.round(f.size_bytes / 1024));
  // The size part is isolated left-to-right so it reads correctly inside Arabic.
  return `${ctx.t('hr.resultFile', { n: formatNumber(i + 1, ctx.locale) })} \u2066(${kind}, ${kb} KB)\u2069`;
}

/** The result files as links that open in a new tab. */
export function resultLinks(ctx: Ctx, files: ResultFile[]): SafeHtml {
  return html`<ul class="result-files">${files.map(
    (f, i) => html`<li><a href="${href(ctx, `/results/${f.id}`)}" target="_blank" rel="noopener">${icon.upload}${fileLabel(ctx, f, i)}</a></li>`,
  )}</ul>`;
}

const RX_OPEN = ['sent', 'ready', 'out_for_delivery', 'partly_available'];

/** Where the prescription was sent and the pharmacy's answer, or the button to send it. */
function pharmacyBlock(ctx: Ctx, p: PrescriptionSummary): SafeHtml {
  const q = p.pharmacy;
  const sendBtn = (label: MessageKey) => html`<div><a class="btn btn-primary btn-sm" href="${href(ctx, `/health-record/prescriptions/${p.id}/send`)}">${icon.pill}${ctx.t(label)}</a></div>`;
  if (!q) return sendBtn('rxsend.title');
  const tz = ctx.deps.cfg.TIME_ZONE;
  return html`<div class="hr-request stack-sm">
    <div class="row-between"><span>${ctx.t('rxsend.sentTo')} <a href="${href(ctx, `/pharmacies/${q.pharmacy_slug}`)}"><bdi>${q.pharmacy_name}</bdi></a>
      <span class="muted small">${sep(ctx)}${formatFullDateTime(q.replied_at ?? q.created_at, ctx.locale, tz)}</span></span>
      <span class="chip hr-status rx-${q.status}">${ctx.t(`rxsend.status.${q.status}` as MessageKey)}</span></div>
    ${q.total_egp !== null ? html`<p><strong>${ctx.t('rxsend.total')}:</strong> ${ctx.t('common.egp', { amount: formatNumber(q.total_egp, ctx.locale) })}</p>` : ''}
    ${q.pharmacy_note ? html`<p class="hr-note" dir="auto">${q.pharmacy_note}</p>` : ''}
    ${contactButtons(ctx, q.pharmacy_phone, q.pharmacy_whatsapp)}
    ${q.status === 'sent'
      ? html`<form method="post" action="${href(ctx, `/health-record/pharmacy-requests/${q.id}/cancel`)}" class="inline-form">${csrfField(ctx)}
          <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('rxsend.cancel')}</button></form>`
      : ''}
  </div>
  ${RX_OPEN.includes(q.status) ? '' : sendBtn('rxsend.sendAgain')}`;
}

/** The patient picks a pharmacy for one prescription. */
export function sendToPharmacyPage(
  ctx: Ctx,
  rx: { id: string; issued_at: Date; doctor_name: string; items: RxItem[] },
  choices: PharmacyChoice[],
  o: { error?: MessageKey; values?: { facility?: string; delivery?: boolean; note?: string } } = {},
): SafeHtml {
  const v = o.values ?? {};
  const body = html`<div class="container page narrow stack-lg">
    <a href="${href(ctx, '/health-record')}">← ${ctx.t('hr.title')}</a>
    <div><h1>${ctx.t('rxsend.title')}</h1><p class="muted">${ctx.t('rxsend.lead')}</p></div>
    <section class="panel stack-sm">
      <span class="muted small">${ctx.t('rxsend.prescribedBy')} <bdi>${rx.doctor_name}</bdi>${sep(ctx)}${formatFullDate(rx.issued_at, ctx.locale, ctx.deps.cfg.TIME_ZONE)}</span>
      <ul class="hr-tests">${rx.items.map((it) => html`<li dir="auto"><strong>${it.medicine}</strong> <span class="muted">(${ctx.t.dynamic(`rx.form.${it.form}`)})</span></li>`)}</ul>
    </section>
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${choices.length
      ? html`<form method="post" action="${href(ctx, `/health-record/prescriptions/${rx.id}/send`)}" class="stack">
          ${csrfField(ctx)}
          <fieldset class="stack-sm"><legend class="label">${ctx.t('rxsend.choose')}</legend>
            ${choices.map(
              (c, i) => html`<label class="hr-choice"><input type="radio" name="facility" value="${c.user_id}"${attrIf(v.facility ? v.facility === c.user_id : i === 0, 'checked')} required>
                <span class="stack-sm"><strong><bdi>${c.name}</bdi></strong>
                  <span class="small muted">${[ctx.locale === 'ar' ? c.district_ar : c.district_en, c.home_service ? ctx.t('rxsend.delivers') : null].filter(Boolean).join(sep(ctx))}</span></span></label>`,
            )}
          </fieldset>
          <fieldset class="stack-sm"><legend class="label">${ctx.t('rxsend.how')}</legend>
            <label class="check"><input type="radio" name="delivery" value="no"${attrIf(!v.delivery, 'checked')}> <span>${ctx.t('rxsend.pickup')}</span></label>
            ${choices.some((c) => c.home_service) ? html`<label class="check"><input type="radio" name="delivery" value="yes"${attrIf(!!v.delivery, 'checked')}> <span>${ctx.t('rxsend.delivery')}</span></label>` : ''}
          </fieldset>
          <div class="field"><label for="rx-note">${ctx.t('rxsend.note')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <textarea id="rx-note" name="note" rows="2" maxlength="${MAX_PATIENT_NOTE}">${v.note ?? ''}</textarea>
            <p class="hint">${ctx.t('rxsend.noteHint')}</p></div>
          <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('rxsend.send')}</button></div>
        </form>`
      : html`<div class="empty"><p>${ctx.t('rxsend.none')}</p><a class="btn btn-outline" href="${href(ctx, `/prescriptions/${rx.id}`)}">${ctx.t('rx.print')}</a></div>`}
  </div>`;
  return layout(ctx, { title: `${ctx.t('rxsend.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

// ---------------------------------------------------------------- pharmacy side

export function pharmacyInboxPage(ctx: Ctx, f: OwnFacility, list: PharmacyInboxItem[], notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const content = html`<div class="stack-sm"><h1>${ctx.t('rxsend.inbox')}</h1><p class="muted">${ctx.t('rxsend.inboxLead')}</p></div>
    ${list.length
      ? html`<ul class="appt-list">${list.map(
          (r) => html`<li class="appt-row">
            <div class="stack-sm">
              <strong><bdi>${r.patient_name}</bdi></strong>
              <span class="small muted">${formatFullDateTime(r.created_at, ctx.locale, tz)}${sep(ctx)}${ctx.t(r.delivery ? 'rxsend.wantsDelivery' : 'rxsend.wantsPickup')}</span>
              <span class="chip hr-status rx-${r.status}">${ctx.t(`rxsend.status.${r.status}` as MessageKey)}</span>
            </div>
            <a class="btn ${r.status === 'sent' ? 'btn-primary' : 'btn-ghost'}" href="${href(ctx, `/facility/prescriptions/${r.id}`)}">${ctx.t('mydocs.open')}</a>
          </li>`,
        )}</ul>`
      : html`<div class="empty"><p>${ctx.t('rxsend.inboxNone')}</p></div>`}`;
  return facilityShell(ctx, f, 'prescriptions', content, notice);
}

export function pharmacyRequestPage(ctx: Ctx, f: OwnFacility, r: PharmacyInboxItem & { items: RxItem[] }, notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const open = RX_OPEN.includes(r.status);
  const replies = r.delivery ? PHARMACY_REPLIES : PHARMACY_REPLIES.filter((x) => x !== 'out_for_delivery');
  const content = html`<a href="${href(ctx, '/facility/prescriptions')}">← ${ctx.t('rxsend.inbox')}</a>
    <div class="stack-sm"><h1><bdi>${r.patient_name}</bdi></h1>
      <p class="muted"><a href="tel:${r.patient_phone}" dir="ltr">${r.patient_phone}</a>${sep(ctx)}${ctx.t('rxsend.prescribedBy')} <bdi>${r.doctor_name}</bdi>${sep(ctx)}${formatFullDate(r.issued_at, ctx.locale, tz)}</p>
      ${contactButtons(ctx, r.patient_phone, r.patient_phone)}
      <span class="chip hr-status rx-${r.status}">${ctx.t(`rxsend.status.${r.status}` as MessageKey)}</span></div>
    ${r.prescription_voided ? alert('warning', ctx.t('rxsend.voided')) : ''}
    <section class="panel stack">
      <h2>${ctx.t('rx.title')}</h2>
      <ol class="rx-print-list">${r.items.map((it) => html`<li><strong><bdi>${it.medicine}</bdi></strong> <span class="muted">(${ctx.t.dynamic(`rx.form.${it.form}`)})</span>
        <div class="muted small"><bdi>${it.dose}</bdi>${sep(ctx)}${ctx.t.dynamic(`rx.freq.${it.frequency}`)}${it.duration ? html`${sep(ctx)}<bdi>${it.duration}</bdi>` : ''}</div></li>`)}</ol>
      <p><span class="pill small">${ctx.t(r.delivery ? 'rxsend.wantsDelivery' : 'rxsend.wantsPickup')}</span></p>
      ${r.patient_note ? html`<p class="hr-note" dir="auto"><strong>${ctx.t('rxsend.patientNote')}:</strong> ${r.patient_note}</p>` : ''}
    </section>
    ${open && !r.prescription_voided
      ? html`<form method="post" action="${href(ctx, `/facility/prescriptions/${r.id}/reply`)}" class="panel stack">${csrfField(ctx)}
          <fieldset class="stack-sm"><legend class="label">${ctx.t('rxsend.reply')}</legend>
            ${replies.map((x) => html`<label class="check"><input type="radio" name="status" value="${x}"${attrIf(r.status === x, 'checked')} required> <span>${ctx.t(`rxsend.status.${x}` as MessageKey)}</span></label>`)}
          </fieldset>
          <div class="field"><label for="total">${ctx.t('rxsend.totalEgp')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <input id="total" name="total" inputmode="numeric" maxlength="8" value="${r.total_egp ?? ''}" dir="ltr"></div>
          <div class="field"><label for="reply-note">${ctx.t('rxsend.replyNote')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <textarea id="reply-note" name="note" rows="3" maxlength="${MAX_PHARMACY_NOTE}">${r.pharmacy_note ?? ''}</textarea>
            <p class="hint">${ctx.t('rxsend.replyNoteHint')}</p></div>
          <div class="row-wrap"><button class="btn btn-primary btn-lg" type="submit">${ctx.t('rxsend.sendReply')}</button></div>
        </form>
        ${r.status !== 'sent'
          ? html`<form method="post" action="${href(ctx, `/facility/prescriptions/${r.id}/done`)}">${csrfField(ctx)}
              <button class="btn btn-outline" type="submit">${ctx.t('rxsend.markDone')}</button></form>`
          : ''}`
      : html`${r.total_egp !== null ? html`<p><strong>${ctx.t('rxsend.total')}:</strong> ${ctx.t('common.egp', { amount: formatNumber(r.total_egp, ctx.locale) })}</p>` : ''}
          ${r.pharmacy_note ? html`<p class="hr-note" dir="auto">${r.pharmacy_note}</p>` : ''}`}`;
  return facilityShell(ctx, f, 'prescriptions', content, notice);
}

/** Call / WhatsApp buttons for a pharmacy, lab or scan centre. */
export function contactButtons(ctx: Ctx, phone: string | null, whatsapp: string | null): SafeHtml {
  if (!phone && !whatsapp) return html``;
  return html`<div class="row-wrap">
    ${phone ? html`<a class="btn btn-ghost btn-sm" href="tel:${phone}">${icon.phone}${ctx.t('rxsend.call')}</a>` : ''}
    ${whatsapp ? html`<a class="btn btn-ghost btn-sm" href="https://wa.me/${whatsapp.replace('+', '')}" target="_blank" rel="noopener noreferrer">${icon.chat}${ctx.t('rxsend.whatsapp')}</a>` : ''}
  </div>`;
}

/** How to prepare for the ordered tests (general advice; the doctor's or centre's instructions come first). */
export function prepBlock(ctx: Ctx, items: readonly { test_code: string | null }[], open = true): SafeHtml {
  const keys = prepFor(items);
  if (!keys.length) return html``;
  return html`<details class="prep"${attrIf(open, 'open')} data-testid="prep">
    <summary><strong>${ctx.t('prep.title')}</strong></summary>
    <ul>${keys.map((k) => html`<li>${ctx.t(k)}</li>`)}</ul>
    <p class="small muted">${ctx.t('prep.caveat')}</p>
  </details>`;
}

/** Requested → received → sample taken / scan done → results ready → reviewed by the doctor. */
function tracker(ctx: Ctx, section: Section, r: NonNullable<OrderPart['request']>): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const steps: { label: MessageKey; at: Date | null }[] = [
    { label: 'track.sent', at: r.createdAt },
    { label: 'track.received', at: r.receivedAt },
    { label: section === 'imaging' ? 'track.scanned' : 'track.sampled', at: r.sampleTakenAt ?? r.readyAt },
    { label: 'track.ready', at: r.readyAt },
    { label: 'track.reviewed', at: r.reviewedAt },
  ];
  const current = steps.findIndex((st) => !st.at);
  return html`<ol class="tracker" aria-label="${ctx.t('track.title')}" data-testid="tracker">${steps.map(
    (st, i) => html`<li class="${st.at ? 'done' : i === current ? 'current' : ''}"${attrIf(i === current, 'aria-current="step"')}>
      <span class="tracker-dot" aria-hidden="true"></span>
      <span class="tracker-label">${ctx.t(st.label)}${st.at ? html`<span class="sr-only">: </span><span class="tracker-time">${formatFullDateTime(st.at, ctx.locale, tz)}</span>` : ''}</span>
    </li>`,
  )}</ol>`;
}

function partCard(ctx: Ctx, p: OrderPart): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const r = p.request;
  const centreWord: MessageKey = p.section === 'imaging' ? 'hr.scanCentre' : 'hr.lab';
  return html`<li class="hr-card" data-testid="hr-${p.section}">
    <div class="row-between">
      <div class="stack-sm">
        <strong>${formatFullDate(p.issuedAt, ctx.locale, tz)}</strong>
        <span class="muted small">${ctx.t('hr.orderedBy')} <a href="${href(ctx, `/doctors/${p.doctorSlug}`)}"><bdi>${p.doctorName}</bdi></a></span>
      </div>
      ${r ? html`<span class="chip hr-status hr-${r.status}">${ctx.t(STATUS_KEY[r.status as Exclude<RequestStatus, 'cancelled'>])}</span>` : html`<span class="chip">${ctx.t('hr.status.notSent')}</span>`}
    </div>
    <ul class="hr-tests">${p.items.map((it) => html`<li dir="auto">${labItemName(ctx, it)}</li>`)}</ul>
    ${p.notes ? html`<p class="small muted" dir="auto">${ctx.t('hr.doctorNotes')}: ${p.notes}</p>` : ''}
    ${r ? tracker(ctx, p.section, r) : ''}
    ${r?.reviewedAt
      ? html`<div class="doctor-review stack-sm" data-testid="doctor-review">
          <strong>${ctx.t('res.patientReviewed', { doctor: p.doctorName })}</strong>
          ${r.doctorComment ? html`<p class="hr-note" dir="auto">${r.doctorComment}</p>` : ''}
          ${r.followUp
            ? html`<p>${ctx.t('res.patientFollowUp')}</p><div><a class="btn btn-primary btn-sm" href="${href(ctx, `/doctors/${p.doctorSlug}`)}">${ctx.t('res.bookFollowUp')}</a></div>`
            : ''}
        </div>`
      : ''}
    ${r?.status === 'ready' ? '' : prepBlock(ctx, p.items, !r || r.status === 'sent')}
    ${r
      ? html`<div class="hr-request stack-sm">
          <span>${ctx.t(r.status === 'ready' ? 'hr.resultsFrom' : 'hr.sentToLabel')} <a href="${href(ctx, `${r.facilityKind === 'radiology' ? '/scan-centres' : '/labs'}/${r.facilitySlug}`)}"><bdi>${r.facilityName}</bdi></a>${
            r.readyAt ? html`${sep(ctx)}<span class="muted">${formatFullDateTime(r.readyAt, ctx.locale, tz)}</span>` : ''
          }</span>
          ${r.status === 'ready'
            ? html`${r.facilityNote ? html`<p class="hr-note" dir="auto">${r.facilityNote}</p>` : ''}${resultLinks(ctx, r.results)}`
            : html`<p class="small muted">${ctx.t(r.status === 'sent' ? 'hr.waitingReceive' : 'hr.waitingResults')}</p>`}
          ${r.facilityInstructions ? html`<p class="hr-note" dir="auto"><strong>${ctx.t('hr.instructionsFrom')}:</strong> ${r.facilityInstructions}</p>` : ''}
          ${contactButtons(ctx, r.facilityPhone, r.facilityWhatsapp)}
          ${r.status === 'sent'
            ? html`<form method="post" action="${href(ctx, `/health-record/requests/${r.id}/cancel`)}" class="inline-form">${csrfField(ctx)}
                <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('hr.cancelSend')}</button></form>`
            : ''}
        </div>`
      : html`<div class="row-wrap">
          <a class="btn btn-primary btn-sm" href="${href(ctx, `/health-record/orders/${p.labOrderId}/${p.section}/send`)}">${ctx.t('hr.sendTo', { centre: ctx.t(centreWord) })}</a>
          <a class="btn btn-ghost btn-sm" href="${href(ctx, `/lab-orders/${p.labOrderId}`)}">${ctx.t('hr.printOrder')}</a>
        </div>`}
  </li>`;
}

/** "Seeing a doctor without booking online?" — the code that lets the doctor send things here. */
function linkCodeCard(ctx: Ctx, code?: { code: string; expiresAt: Date }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  return html`<details class="panel link-code-card"${code ? html` open` : ''}>
    <summary><strong>${ctx.t('link.patientTitle')}</strong></summary>
    <p class="small muted">${ctx.t('link.patientLead')}</p>
    ${code
      ? html`<div class="link-code-show" aria-live="polite">
          <span class="link-code-value" dir="ltr">${formatLinkCode(code.code)}</span>
          <span class="small muted">${ctx.t('link.validUntil', { time: `\u2068${formatTime(code.expiresAt, ctx.locale, tz)}\u2069` })}</span>
          <span class="small">${ctx.t('link.patientWarn')}</span>
        </div>`
      : ''}
    <form method="post" action="${href(ctx, '/health-record/link-code')}">${csrfField(ctx)}
      <button class="btn ${code ? 'btn-ghost' : 'btn-primary'} btn-sm" type="submit">${ctx.t(code ? 'link.newCode' : 'link.showCode')}</button>
    </form>
  </details>`;
}

export function healthRecordPage(
  ctx: Ctx,
  rec: HealthRecord,
  tab: HealthTab,
  notice?: { kind: 'success' | 'error'; key: MessageKey },
  linkCode?: { code: string; expiresAt: Date },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const counts: Record<HealthTab, number> = { prescriptions: rec.prescriptions.length, lab: rec.lab.length, imaging: rec.imaging.length };
  const label: Record<HealthTab, MessageKey> = { prescriptions: 'hr.tab.prescriptions', lab: 'hr.tab.lab', imaging: 'hr.tab.imaging' };
  const lead: Record<HealthTab, MessageKey> = { prescriptions: 'hr.lead.prescriptions', lab: 'hr.lead.lab', imaging: 'hr.lead.imaging' };
  const tabs = html`<nav class="hr-tabs" aria-label="${ctx.t('hr.title')}">${HEALTH_TABS.map(
    (t) => html`<a href="${href(ctx, '/health-record', { tab: t })}"${attrIf(t === tab, 'aria-current="page"')}>${ctx.t(label[t])} <span class="hr-count">${formatNumber(counts[t], ctx.locale)}</span></a>`,
  )}</nav>`;

  const prescriptions = rec.prescriptions.length
    ? html`<a class="alert alert-info row-between med-link" href="${href(ctx, '/medicines')}"><span>${icon.bell}${ctx.t('med.banner')}</span><span aria-hidden="true">›</span></a>
      <ul class="appt-list">${rec.prescriptions.map(
        (p) => html`<li class="hr-card">
          <div class="row-between"><strong>${formatFullDate(p.issued_at, ctx.locale, tz)}</strong>
            <a class="btn btn-outline btn-sm" href="${href(ctx, `/prescriptions/${p.id}`)}">${ctx.t('mydocs.open')}</a></div>
          <span class="muted small">${ctx.t('hr.prescribedBy')} <a href="${href(ctx, `/doctors/${p.doctor_slug}`)}"><bdi>${p.doctor_name}</bdi></a></span>
          <ul class="hr-tests">${p.medicines.map((m) => html`<li dir="auto">${m}</li>`)}</ul>
          <div><a class="btn btn-outline btn-sm" href="${href(ctx, `/medicines/setup/${p.id}`)}" data-testid="set-reminders">${icon.bell}${ctx.t('med.setReminders')}</a></div>
          ${pharmacyBlock(ctx, p)}
        </li>`,
      )}</ul>`
    : html`<div class="empty"><p>${ctx.t('hr.none.prescriptions')}</p></div>`;
  const parts = (list: OrderPart[], empty: MessageKey) =>
    list.length ? html`<ul class="appt-list">${list.map((p) => partCard(ctx, p))}</ul>` : html`<div class="empty"><p>${ctx.t(empty)}</p></div>`;

  const body = html`<div class="container page narrow stack-lg">
    <div><h1>${ctx.t('hr.title')}</h1><p class="muted">${ctx.t('hr.lead')}</p></div>
    ${notice ? alert(notice.kind, ctx.t(notice.key)) : ''}
    ${linkCodeCard(ctx, linkCode)}
    ${tabs}
    <section class="stack" aria-labelledby="hr-section">
      <h2 id="hr-section" class="sr-only">${ctx.t(label[tab])}</h2>
      <p class="small muted">${ctx.t(lead[tab])}</p>
      ${tab === 'prescriptions' ? prescriptions : tab === 'lab' ? parts(rec.lab, 'hr.none.lab') : parts(rec.imaging, 'hr.none.imaging')}
    </section>
  </div>`;
  return layout(ctx, { title: `${ctx.t('hr.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function sendOrderPage(ctx: Ctx, part: OrderPart, choices: CentreChoice[], kidney: KidneyResult[], error?: MessageKey): SafeHtml {
  const total = part.items.length;
  const tz = ctx.deps.cfg.TIME_ZONE;
  const comma = ctx.locale === 'ar' ? '، ' : ', ';
  const contrast = part.section === 'imaging' && mayNeedContrast(part.items);
  const centreWord: MessageKey = part.section === 'imaging' ? 'hr.scanCentre' : 'hr.lab';
  const body = html`<div class="container page narrow stack-lg">
    <a href="${href(ctx, '/health-record', { tab: part.section })}">← ${ctx.t('hr.title')}</a>
    <div><h1>${ctx.t('hr.sendTo', { centre: ctx.t(centreWord) })}</h1><p class="muted">${ctx.t('hr.sendLead')}</p></div>
    <ul class="hr-tests">${part.items.map((it) => html`<li dir="auto">${labItemName(ctx, it)}</li>`)}</ul>
    ${prepBlock(ctx, part.items)}
    ${error ? alert('error', ctx.t(error)) : ''}
    ${choices.length
      ? html`<form method="post" action="${href(ctx, `/health-record/orders/${part.labOrderId}/${part.section}/send`)}" class="stack">
          ${csrfField(ctx)}
          <fieldset class="stack-sm"><legend class="label">${ctx.t('hr.chooseCentre', { centre: ctx.t(centreWord) })}</legend>
            ${choices.map(
              (c, i) => html`<label class="hr-choice"><input type="radio" name="facility" value="${c.user_id}"${attrIf(i === 0, 'checked')} required>
                <span class="stack-sm"><span class="row-wrap"><strong><bdi>${c.name}</bdi></strong>
                    ${c.offered === total ? html`<span class="chip hr-status hr-ready">${ctx.t('hr.hasAll')}</span>` : ''}
                    ${c.total_egp !== null ? html`<span class="choice-price">${ctx.t(c.offered === total ? 'hr.totalAll' : 'hr.totalSome', { price: formatNumber(c.total_egp, ctx.locale) })}</span>` : ''}</span>
                  <span class="small muted">${[
                    ctx.locale === 'ar' ? c.district_ar : c.district_en,
                    c.offered < total ? ctx.t('hr.offers', { n: formatNumber(c.offered, ctx.locale), total: formatNumber(total, ctx.locale) }) : null,
                    c.home_service ? ctx.t('hr.homeService') : null,
                  ].filter(Boolean).join(sep(ctx))}</span>
                  ${c.offered > 0 && c.missing.length
                    ? html`<span class="small" dir="auto">${ctx.t('hr.notListed')}: ${c.missing.map((i) => labItemName(ctx, part.items[i]!)).join(comma)}</span>`
                    : ''}</span></label>`,
            )}
          </fieldset>
          ${contrast
            ? html`<fieldset class="panel stack-sm" data-testid="kidney-share"><legend class="label">${ctx.t('kidney.title')}</legend>
                <p class="small">${ctx.t('kidney.lead')}</p>
                ${kidney.length
                  ? html`<label class="check"><input type="radio" name="shareKidney" value="" checked> <span>${ctx.t('kidney.dontShare')}</span></label>
                      ${kidney.map((k) => html`<label class="check"><input type="radio" name="shareKidney" value="${k.requestId}"> <span>${ctx.t('kidney.share', { date: formatFullDate(k.readyAt, ctx.locale, tz), centre: k.facilityName })}</span></label>`)}
                      <p class="hint">${ctx.t('kidney.hint')}</p>`
                  : html`<p class="small muted">${ctx.t('kidney.none')}</p>`}
              </fieldset>`
            : ''}
          ${choices.some((c) => c.home_service)
            ? html`<label class="check"><input type="checkbox" name="homeVisit" value="yes"> <span>${ctx.t('hr.homeVisit')}</span></label>`
            : ''}
          <div class="field"><label for="send-note">${ctx.t('hr.sendNote')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <textarea id="send-note" name="note" rows="2" maxlength="300"></textarea>
            <p class="hint">${ctx.t('hr.sendNoteHint')}</p></div>
          <p class="hint">${ctx.t('hr.sendPrivacy')}</p>
          <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('hr.sendButton')}</button></div>
        </form>`
      : html`<div class="empty"><p>${ctx.t('hr.noCentres')}</p><a class="btn btn-outline" href="${href(ctx, `/lab-orders/${part.labOrderId}`)}">${ctx.t('hr.printOrder')}</a></div>`}
  </div>`;
  return layout(ctx, { title: `${ctx.t('hr.sendTo', { centre: ctx.t(centreWord) })} — ${ctx.t('brand')}`, body, noindex: true });
}

// ---------------------------------------------------------------- lab / scan centre side

const CENTRE_STATUS: Record<Exclude<RequestStatus, 'cancelled'>, MessageKey> = {
  sent: 'hr.centre.status.sent',
  received: 'hr.centre.status.received',
  ready: 'hr.centre.status.ready',
};

export function centreRequestsPage(ctx: Ctx, f: OwnFacility, list: CentreRequest[], notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const content = html`<div class="stack-sm"><h1>${ctx.t('hr.centre.title')}</h1><p class="muted">${ctx.t('hr.centre.lead')}</p></div>
    ${list.length
      ? html`<ul class="appt-list">${list.map(
          (r) => html`<li class="appt-row">
            <div class="stack-sm">
              <strong><bdi>${r.patient_name}</bdi></strong>
              <span class="small muted">${formatFullDateTime(r.created_at, ctx.locale, tz)}${sep(ctx)}${ctx.t('hr.centre.tests', { n: formatNumber(r.items.length, ctx.locale) })}</span>
              <span class="chip hr-status hr-${r.status}">${ctx.t(CENTRE_STATUS[r.status as Exclude<RequestStatus, 'cancelled'>])}</span>
            </div>
            <a class="btn ${r.status === 'ready' ? 'btn-ghost' : 'btn-primary'}" href="${href(ctx, `/facility/requests/${r.id}`)}">${ctx.t('mydocs.open')}</a>
          </li>`,
        )}</ul>`
      : html`<div class="empty"><p>${ctx.t('hr.centre.none')}</p></div>`}`;
  return facilityShell(ctx, f, 'requests', content, notice);
}

export function centreRequestPage(ctx: Ctx, f: OwnFacility, r: CentreRequest, notice?: { kind: 'success' | 'error'; key: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const content = html`<a href="${href(ctx, '/facility/requests')}">← ${ctx.t('hr.centre.title')}</a>
    <div class="stack-sm"><h1><bdi>${r.patient_name}</bdi></h1>
      <p class="muted"><a href="tel:${r.patient_phone}" dir="ltr">${r.patient_phone}</a>${sep(ctx)}${ctx.t('hr.orderedBy')} <bdi>${r.doctor_name}</bdi>${sep(ctx)}${formatFullDate(r.issued_at, ctx.locale, tz)}</p>
      <span class="chip hr-status hr-${r.status}">${ctx.t(CENTRE_STATUS[r.status as Exclude<RequestStatus, 'cancelled'>])}</span></div>
    ${r.order_voided ? alert('warning', ctx.t('hr.centre.voided')) : ''}
    <section class="panel stack"><h2>${ctx.t('hr.centre.requested')}</h2>
      <ul class="hr-tests">${r.items.map((it) => html`<li dir="auto">${labItemName(ctx, it)}</li>`)}</ul>
      ${r.notes ? html`<p class="small" dir="auto"><strong>${ctx.t('hr.doctorNotes')}:</strong> ${r.notes}</p>` : ''}
      ${r.home_visit ? html`<p><span class="pill small">${ctx.t('hr.wantsHomeVisit')}</span></p>` : ''}
      ${r.patient_note ? html`<p class="hr-note" dir="auto"><strong>${ctx.t('hr.patientNote')}:</strong> ${r.patient_note}</p>` : ''}
      ${r.facility_instructions ? html`<p class="small" dir="auto"><strong>${ctx.t('hr.centre.instructions')}:</strong> ${r.facility_instructions}</p>` : ''}
      ${prepBlock(ctx, r.items, false)}
      ${r.shared_kidney
        ? html`<div class="hr-note stack-sm" data-testid="shared-kidney"><strong>${ctx.t('kidney.centreTitle')}</strong>
            <span class="small">${ctx.t('kidney.centreFrom', { centre: r.shared_kidney.facility_name, date: formatFullDate(r.shared_kidney.ready_at, ctx.locale, tz) })}</span>
            ${resultLinks(ctx, r.shared_kidney.results)}</div>`
        : ''}
    </section>
    ${r.status === 'received' && !r.sample_taken_at
      ? html`<form method="post" action="${href(ctx, `/facility/requests/${r.id}/sample`)}" class="panel row-between">${csrfField(ctx)}
          <span class="small">${ctx.t(r.section === 'imaging' ? 'track.markScannedHint' : 'track.markSampledHint')}</span>
          <button class="btn btn-outline" type="submit">${ctx.t(r.section === 'imaging' ? 'track.markScanned' : 'track.markSampled')}</button></form>`
      : r.sample_taken_at && r.status === 'received'
        ? html`<p class="small muted">${ctx.t(r.section === 'imaging' ? 'track.scanned' : 'track.sampled')} · ${formatFullDateTime(r.sample_taken_at, ctx.locale, tz)}</p>`
        : ''}
    ${r.status === 'sent'
      ? html`<form method="post" action="${href(ctx, `/facility/requests/${r.id}/received`)}" class="panel stack">${csrfField(ctx)}
          <div class="field"><label for="instructions">${ctx.t('hr.centre.instructions')}</label>
            <textarea id="instructions" name="instructions" rows="2" maxlength="500"></textarea>
            <p class="hint">${ctx.t('hr.centre.instructionsHint')}</p></div>
          <div><button class="btn btn-primary btn-lg" type="submit">${ctx.t('hr.centre.markReceived')}</button></div>
          <p class="hint">${ctx.t('hr.centre.markReceivedHint')}</p></form>`
      : html`<section class="panel stack"><h2>${ctx.t('hr.centre.results')}</h2>
          ${r.results.length
            ? html`<ul class="result-files">${r.results.map(
                (file, i) => html`<li><a href="${href(ctx, `/results/${file.id}`)}" target="_blank" rel="noopener">${icon.upload}${fileLabel(ctx, file, i)}</a>
                  ${r.status === 'received'
                    ? html`<form method="post" action="${href(ctx, `/facility/results/${file.id}/remove`)}" class="inline-form">${csrfField(ctx)}
                        <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('hr.centre.removeFile')}</button></form>`
                    : ''}</li>`,
              )}</ul>`
            : html`<p class="muted">${ctx.t('hr.centre.noFiles')}</p>`}
          <form method="post" action="${href(ctx, `/facility/requests/${r.id}/results`)}" enctype="multipart/form-data" class="stack-sm">${csrfField(ctx)}
            <div class="field"><label for="result-file">${ctx.t('hr.centre.addFile')}</label>
              <input id="result-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required>
              <p class="hint">${ctx.t('hr.centre.fileHint')}</p></div>
            <div><button class="btn btn-outline" type="submit">${ctx.t('hr.centre.upload')}</button></div>
          </form>
        </section>
        ${r.status === 'received'
          ? html`<form method="post" action="${href(ctx, `/facility/requests/${r.id}/ready`)}" class="panel stack">${csrfField(ctx)}
              <div class="field"><label for="note">${ctx.t('hr.centre.note')} <span class="muted">(${ctx.t('common.optional')})</span></label>
                <textarea id="note" name="note" rows="3" maxlength="${MAX_FACILITY_NOTE}"></textarea>
                <p class="hint">${ctx.t('hr.centre.noteHint')}</p></div>
              <div><button class="btn btn-primary btn-lg" type="submit"${attrIf(!r.results.length, 'disabled')}>${ctx.t('hr.centre.markReady')}</button></div>
            </form>`
          : html`${r.facility_note ? html`<p class="hr-note" dir="auto">${r.facility_note}</p>` : ''}<p class="muted">${ctx.t('hr.centre.released')}</p>`}`}`;
  return facilityShell(ctx, f, 'requests', content, notice);
}

export const isHealthTab = (s: string): s is HealthTab => (HEALTH_TABS as readonly string[]).includes(s);
export type { Section };
