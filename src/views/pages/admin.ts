import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { adminShell } from './adminConsole.js';
import { alert, csrfField, starRow } from '../components.js';
import type { AdminReview } from '../../services/reviews.js';
import { pick, formatDateTime, type MessageKey } from '../../i18n/index.js';
import type { ReferenceData } from '../../services/reference.js';
import type { ReviewDetail, ReviewListItem } from '../../services/admin.js';
import type { FacilityReviewDetail, FacilityReviewItem } from '../../services/facilities.js';
import type { AdminIssue, StrikeRow } from '../../services/reliability.js';
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

// ---------------------------------------------------------------------------
// Pharmacies, labs and scan centres
// ---------------------------------------------------------------------------

export function adminFacilitiesPage(ctx: Ctx, data: { pending: FacilityReviewItem[]; recent: FacilityReviewItem[] }, notice?: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const list = (rows: FacilityReviewItem[]) =>
    rows.length
      ? html`<ul class="appt-list">${rows.map(
          (f) => html`<li class="appt-row"><div class="stack-sm">
              <a href="${href(ctx, `/admin/facilities/${f.user_id}`)}"><strong>${f.name}</strong></a>
              <span class="muted small">${ctx.t(`fac.kind.${f.kind}` as MessageKey)} · ${f.contact_name} · ${formatDateTime(f.created_at, ctx.locale, tz)}</span>
            </div>${vstatus(ctx, f.verification_status)}</li>`,
        )}</ul>`
      : html`<p class="muted">${ctx.t('adm.facNone')}</p>`;
  const content = html`
    <div><h1>${ctx.t('adm.nav.facilities')}</h1><p class="muted">${ctx.t('adm.facLead')}</p></div>
    ${notice ? alert('success', ctx.t(notice)) : ''}
    <section class="panel stack"><h2 class="h3">${ctx.t('admin.pending')} (${data.pending.length})</h2>${list(data.pending)}</section>
    <section class="panel stack"><h2 class="h3">${ctx.t('admin.recent')}</h2>${list(data.recent)}</section>`;
  return adminShell(ctx, 'facilities', `${ctx.t('adm.nav.facilities')} — ${ctx.t('admin.title')}`, content);
}

export function adminFacilityPage(ctx: Ctx, ref: ReferenceData, f: FacilityReviewDetail, error?: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const action = (decision: string, label: MessageKey, withNote: boolean, primary = false) => html`<form method="post" action="${href(ctx, `/admin/facilities/${f.user_id}/${decision}`)}" class="stack-sm">
    ${csrfField(ctx)}
    ${withNote ? html`<div class="field"><label for="note-${decision}">${ctx.t('admin.rejectNote')}</label><textarea id="note-${decision}" name="note" rows="2" maxlength="500" required></textarea></div>` : ''}
    <div><button type="submit" class="btn ${primary ? 'btn-primary' : 'btn-outline'}">${ctx.t(label)}</button></div></form>`;
  const st = f.verification_status;
  const content = html`
    <a href="${href(ctx, '/admin/facilities')}">← ${ctx.t('common.back')}</a>
    <div class="row-wrap"><h1>${f.name}</h1>${vstatus(ctx, st)}</div>
    ${error ? alert('error', ctx.t(error)) : ''}
    <section class="panel">
      <dl class="summary">
        <div><dt>${ctx.t('facjoin.kind')}</dt><dd>${ctx.t(`fac.kind.${f.kind}` as MessageKey)}</dd></div>
        <div><dt>${ctx.t('facjoin.licenceNumber')}</dt><dd dir="ltr">${f.licence_number}</dd></div>
        <div><dt>${ctx.t('facjoin.contactName')}</dt><dd>${f.contact_name}</dd></div>
        <div><dt>${ctx.t('auth.phone')}</dt><dd dir="ltr">${formatEgyptMobile(f.phone_e164)}</dd></div>
        <div><dt>${ctx.t('join.email')}</dt><dd>${f.email ?? '—'}</dd></div>
        <div><dt>${ctx.t('admin.submitted')}</dt><dd>${formatDateTime(f.created_at, ctx.locale, tz)}</dd></div>
        <div><dt>${ctx.t('fac.branches')}</dt><dd>${f.branches.length
          ? f.branches.map((b) => { const d = ref.districtById.get(b.district_id); return html`<span class="block">${b.name} — ${d ? pick(ctx.locale, d) : ''}, ${b.address}</span>`; })
          : '—'}</dd></div>
      </dl>
    </section>
    <section class="panel stack">
      <h2>${ctx.t('admin.documents')}</h2>
      <p class="hint">${ctx.t('adm.facDocHint')}</p>
      ${f.documents.map((doc) => html`<p><a class="btn btn-outline" href="${href(ctx, `/admin/facility-documents/${doc.id}`)}" target="_blank" rel="noopener">${ctx.t('admin.viewDocument')}</a>
        <span class="muted"> ${doc.mime_type} · ${Math.round(doc.size_bytes / 1024)} KB</span></p>`)}
    </section>
    <section class="panel row-wrap align-start">
      ${st === 'pending' || st === 'rejected' ? action('approve', 'admin.approve', false, true) : ''}
      ${st === 'pending' ? action('reject', 'admin.reject', true) : ''}
      ${st === 'approved' || st === 'pending' ? action('suspend', 'admin.suspend', true) : ''}
      ${st === 'suspended' ? action('reinstate', 'admin.reinstate', false, true) : ''}
    </section>`;
  return adminShell(ctx, 'facilities', `${f.name} — ${ctx.t('admin.title')}`, content);
}

// ---------------------------------------------------------------------------
// Patient issues and doctor strikes
// ---------------------------------------------------------------------------

export function adminIssuesPage(ctx: Ctx, data: { open: AdminIssue[]; recent: AdminIssue[] }, o: { notice?: MessageKey; error?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const item = (i: AdminIssue, open: boolean) => html`<li class="panel stack-sm">
    <div class="row-between"><strong>${ctx.t(`issue.cat.${i.category}` as MessageKey)}</strong><span class="muted small">${formatDateTime(i.created_at, ctx.locale, tz)}</span></div>
    <p class="prose" dir="auto">${i.description}</p>
    <p class="muted small"><bdi>${i.patient_name}</bdi> (<span dir="ltr">${formatEgyptMobile(i.patient_phone)}</span>) · ${ctx.t('issue.withDoctor')} <a href="${href(ctx, `/admin/doctors/${i.doctor_id}`)}"><bdi>${i.doctor_name}</bdi></a>
      · ${ctx.t('pay.visit')} ${formatDateTime(i.visit_at, ctx.locale, tz)} · ${ctx.t.dynamic(`status.${i.visit_status}`)}${i.no_show_waived ? html` · ${ctx.t('issue.noShowWaived')}` : ''}</p>
    ${open
      ? html`<form method="post" action="${href(ctx, `/admin/issues/${i.id}/resolve`)}" class="stack-sm">${csrfField(ctx)}
          <div class="field"><label for="note-${i.id}">${ctx.t('issue.resolutionNote')}</label><textarea id="note-${i.id}" name="note" rows="2" maxlength="500" required></textarea>
            <p class="hint">${ctx.t('issue.resolutionHint')}</p></div>
          ${i.visit_status === 'no_show' && !i.no_show_waived ? html`<label class="check"><input type="checkbox" name="waiveNoShow" value="yes"><span>${ctx.t('issue.waiveNoShow')}</span></label>` : ''}
          <label class="check"><input type="checkbox" name="strikeDoctor" value="yes"><span>${ctx.t('issue.strikeDoctor')}</span></label>
          <div><button type="submit" class="btn btn-primary">${ctx.t('issue.resolve')}</button></div>
        </form>`
      : html`<p class="small"><span class="chip status-confirmed">${ctx.t('issue.resolvedChip')}</span> <bdi>${i.resolution_note ?? ''}</bdi></p>`}
  </li>`;
  const content = html`
    <div><h1>${ctx.t('adm.nav.issues')}</h1><p class="muted">${ctx.t('issue.adminLead')}</p></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    <section class="stack"><h2 class="h3">${ctx.t('issue.openTitle')} (${data.open.length})</h2>
      ${data.open.length ? html`<ul class="stack plain-list">${data.open.map((i) => item(i, true))}</ul>` : html`<p class="muted">${ctx.t('adm.facNone')}</p>`}</section>
    ${data.recent.length ? html`<section class="stack"><h2 class="h3">${ctx.t('admin.recent')}</h2><ul class="stack plain-list">${data.recent.map((i) => item(i, false))}</ul></section>` : ''}`;
  return adminShell(ctx, 'issues', `${ctx.t('adm.nav.issues')} — ${ctx.t('admin.title')}`, content);
}

export function adminStrikesPage(ctx: Ctx, rows: StrikeRow[], limit: number, o: { notice?: MessageKey; error?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const paused = [...new Map(rows.filter((r) => r.active_count >= limit).map((r) => [r.doctor_id, r])).values()];
  const content = html`
    <div><h1>${ctx.t('adm.nav.strikes')}</h1><p class="muted">${ctx.t('strike.adminLead', { limit })}</p></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    ${paused.length ? alert('warning', html`${ctx.t('strike.pausedDoctors')} ${paused.map((p) => html`<a href="${href(ctx, `/admin/doctors/${p.doctor_id}`)}"><bdi>${p.doctor_name}</bdi></a> `)}`) : ''}
    ${rows.length
      ? html`<ul class="appt-list panel">${rows.map(
          (s) => html`<li class="appt-row${s.status === 'waived' ? ' muted-row' : ''}"><div class="stack-sm">
              <strong><a href="${href(ctx, `/admin/doctors/${s.doctor_id}`)}"><bdi>${s.doctor_name}</bdi></a> · ${ctx.t(`strike.source.${s.source}` as MessageKey)}${s.day ? html` (${s.day})` : ''}</strong>
              <span class="muted small">${formatDateTime(s.created_at, ctx.locale, tz)} · ${ctx.t('strike.activeOf', { n: s.active_count, limit })}${s.reason ? html` · <bdi>${s.reason}</bdi>` : ''}</span>
              ${s.status === 'waived' ? html`<span class="small"><span class="chip">${ctx.t('strike.waived')}</span> <bdi>${s.review_note ?? ''}</bdi></span>` : ''}
            </div>
            ${s.status === 'active'
              ? html`<details class="refund"><summary class="btn btn-outline btn-sm">${ctx.t('strike.waive')}</summary>
                  <form method="post" action="${href(ctx, `/admin/strikes/${s.id}/waive`)}" class="stack-sm">${csrfField(ctx)}
                    <label for="w-${s.id}">${ctx.t('strike.waiveNote')}</label><input id="w-${s.id}" name="note" maxlength="300" required>
                    <button type="submit" class="btn btn-primary btn-sm">${ctx.t('strike.waive')}</button></form></details>`
              : ''}</li>`,
        )}</ul>`
      : html`<p class="muted">${ctx.t('strike.none')}</p>`}`;
  return adminShell(ctx, 'strikes', `${ctx.t('adm.nav.strikes')} — ${ctx.t('admin.title')}`, content);
}
