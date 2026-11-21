import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { adminShell } from './adminConsole.js';
import { alert, csrfField, starRow } from '../components.js';
import type { AdminReview } from '../../services/reviews.js';
import { pick, formatDateTime, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { ReviewDetail, ReviewListItem } from '../../services/admin.js';
import { experienceYears } from '../../domain/experience.js';
import { formatEgyptMobile } from '../../domain/phone.js';

const vstatus = (ctx: Ctx, s: string) => html`<span class="chip vstatus-${s}">${ctx.t.dynamic(`vstatus.${s}`)}</span>`;

export function adminListPage(ctx: Ctx, ref: ReferenceData, data: { pending: ReviewListItem[]; recent: ReviewListItem[] }, notice?: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const table = (rows: ReviewListItem[]) => html`<div class="table-scroll"><table class="table">
    <thead><tr><th scope="col">${ctx.t('auth.fullName')}</th><th scope="col">${ctx.t('join.specialty')}</th><th scope="col">${ctx.t('admin.submitted')}</th><th scope="col">${ctx.t('dash.status')}</th><th scope="col"></th></tr></thead>
    <tbody>${rows.map((r) => {
      const s = ref.specialtyById.get(r.specialty_id);
      return html`<tr><td><strong>${r.full_name}</strong></td><td>${s ? pick(ctx.locale, s) : ''}</td><td>${formatDateTime(r.created_at, ctx.locale, tz)}</td>
        <td>${vstatus(ctx, r.verification_status)}</td><td><a class="btn btn-outline btn-sm" href="${href(ctx, `/admin/doctors/${r.user_id}`)}">${ctx.t('admin.review')}</a></td></tr>`;
    })}</tbody></table></div>`;
  const content = html`
    <h1>${ctx.t('admin.title')}</h1>
    ${notice ? alert('success', ctx.t(notice)) : ''}
    <section class="panel stack"><h2>${ctx.t('admin.pending')}</h2>${data.pending.length ? table(data.pending) : html`<p class="muted">${ctx.t('admin.none')}</p>`}</section>
    ${data.recent.length ? html`<section class="panel stack"><h2>${ctx.t('admin.recent')}</h2>${table(data.recent)}</section>` : ''}`;
  return adminShell(ctx, 'doctors', ctx.t('admin.title'), content);
}

export function adminDoctorPage(ctx: Ctx, ref: ReferenceData, d: ReviewDetail, error?: MessageKey, notice?: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const spec = ref.specialtyById.get(d.specialty_id);
  const years = experienceYears(d.positions, ctx.deps.now());
  const action = (decision: string, label: MessageKey, withNote: boolean, primary = false) => html`<form method="post" action="${href(ctx, `/admin/doctors/${d.user_id}/${decision}`)}" class="stack-sm">
    ${csrfField(ctx)}
    ${withNote ? html`<div class="field"><label for="note-${decision}">${ctx.t('admin.rejectNote')}</label><textarea id="note-${decision}" name="note" rows="2" maxlength="500" required></textarea></div>` : ''}
    <div><button type="submit" class="btn ${primary ? 'btn-primary' : 'btn-outline'}">${ctx.t(label)}</button></div></form>`;
  const st = d.verification_status;
  const content = html`
    <a href="${href(ctx, '/admin/doctors')}">← ${ctx.t('common.back')}</a>
    <div class="row-wrap"><h1>${d.full_name}</h1>${vstatus(ctx, st)}</div>
    ${error ? alert('error', ctx.t(error)) : ''}
    ${notice ? alert('success', ctx.t(notice)) : ''}
    <section class="panel">
      <dl class="summary">
        <div><dt>${ctx.t('join.kind')}</dt><dd>${ctx.t(d.kind === 'dental' ? 'join.kindDental' : 'join.kindMedical')}</dd></div>
        <div><dt>${ctx.t('join.specialty')}</dt><dd>${spec ? pick(ctx.locale, spec) : ''} — ${d.subspecialtyIds.map((id) => { const s = ref.subspecialtyById.get(id); return s ? pick(ctx.locale, s) : ''; }).join(', ')}</dd></div>
        <div><dt>${ctx.t('join.gradYear')}</dt><dd>${d.graduation_year}</dd></div>
        <div><dt>${ctx.t('auth.phone')}</dt><dd dir="ltr">${formatEgyptMobile(d.phone_e164)} ${d.phone_verified_at ? '✓' : ''}</dd></div>
        <div><dt>${ctx.t('join.email')}</dt><dd>${d.email ?? '—'}</dd></div>
        <div><dt>${ctx.t('admin.submitted')}</dt><dd>${formatDateTime(d.created_at, ctx.locale, tz)}</dd></div>
        <div><dt>${ctx.t('doctor.experience')}</dt><dd>${ctx.t('common.years', { n: years })}</dd></div>
      </dl>
    </section>
    <section class="panel stack">
      <h2>${ctx.t('admin.documents')}</h2>
      <p class="hint">${ctx.t('admin.accessNote')}</p>
      ${d.documents.map((doc) => html`<p><a class="btn btn-outline" href="${href(ctx, `/admin/documents/${doc.id}`)}" target="_blank" rel="noopener">${ctx.t('admin.viewDocument')}</a>
        <span class="muted"> ${doc.mime_type} · ${Math.round(doc.size_bytes / 1024)} KB</span></p>`)}
    </section>
    ${d.positions.length ? html`<section class="panel stack"><h2>${ctx.t('doctor.experienceSection')}</h2>
      <ol class="timeline">${d.positions.map((p) => html`<li><span class="muted" dir="ltr">${p.start} – ${p.end ?? ctx.t('common.present')}</span><span><strong>${p.title}</strong> <span class="muted">${p.workplace}</span></span></li>`)}</ol></section>` : ''}
    <section class="panel stack">
      <h2>${ctx.t('admin.recordsTitle')}</h2>
      <p class="muted">${ctx.t(d.records_enabled ? 'admin.recordsOn' : 'admin.recordsOff')}</p>
      <p class="hint">${ctx.t('admin.recordsHint')}</p>
      <form method="post" action="${href(ctx, `/admin/doctors/${d.user_id}/records`)}">${csrfField(ctx)}
        <input type="hidden" name="on" value="${d.records_enabled ? 'no' : 'yes'}">
        <button type="submit" class="btn ${d.records_enabled ? 'btn-outline' : 'btn-primary'}">${ctx.t(d.records_enabled ? 'admin.recordsDisable' : 'admin.recordsEnable')}</button></form>
    </section>
    <section class="panel row-wrap align-start">
      ${st === 'pending' || st === 'rejected' ? action('approve', 'admin.approve', false, true) : ''}
      ${st === 'pending' ? action('reject', 'admin.reject', true) : ''}
      ${st === 'approved' || st === 'pending' ? action('suspend', 'admin.suspend', true) : ''}
      ${st === 'suspended' ? action('reinstate', 'admin.reinstate', false, true) : ''}
    </section>`;
  return adminShell(ctx, 'doctors', `${d.full_name} — ${ctx.t('admin.title')}`, content);
}

export function adminReviewsPage(ctx: Ctx, reviews: AdminReview[], o: { notice?: MessageKey; error?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const content = html`
    <a href="${href(ctx, '/admin/doctors')}">← ${ctx.t('common.back')}</a>
    <div><h1>${ctx.t('admin.reviewsTitle')}</h1><p class="muted">${ctx.t('admin.reviewsLead')}</p></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${reviews.length
      ? html`<ul class="appt-list">${reviews.map(
          (r) => html`<li class="appt-row${r.status === 'hidden' ? ' muted-row' : ''}">
            <div class="stack-sm">
              <div class="row-wrap">${starRow(ctx, r.rating)}<span class="chip ${r.status === 'hidden' ? 'status-cancelled' : 'status-confirmed'}">${ctx.t(r.status === 'hidden' ? 'admin.reviewHidden' : 'admin.reviewVisible')}</span></div>
              ${r.comment ? html`<p class="prose" dir="auto">${r.comment}</p>` : ''}
              <span class="muted small" dir="auto"><a href="${href(ctx, `/doctors/${r.doctor_slug}`)}">${r.doctor_name}</a> · ${r.patient_name} · ${formatDateTime(r.created_at, ctx.locale, tz)}</span>
              ${r.hidden_reason ? html`<span class="muted small">${ctx.t('admin.hideReason')}: ${r.hidden_reason}</span>` : ''}
            </div>
            <form method="post" action="${href(ctx, `/admin/reviews/${r.id}/${r.status === 'hidden' ? 'show' : 'hide'}`)}" class="stack-sm">
              ${csrfField(ctx)}
              ${r.status === 'visible'
                ? html`<label class="sr-only" for="reason-${r.id}">${ctx.t('admin.hideReason')}</label>
                   <input id="reason-${r.id}" name="reason" maxlength="200" required placeholder="${ctx.t('admin.hideReason')}">`
                : ''}
              <button type="submit" class="btn btn-outline btn-sm">${ctx.t(r.status === 'hidden' ? 'admin.reviewShow' : 'admin.reviewHide')}</button>
            </form>
          </li>`,
        )}</ul>`
      : html`<p class="muted">${ctx.t('admin.reviewsNone')}</p>`}`;
  return adminShell(ctx, 'reviews', ctx.t('admin.reviewsTitle'), content);
}
