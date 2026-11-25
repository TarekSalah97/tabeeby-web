import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { alert, csrfField, icon } from '../components.js';
import { formatFullDateTime, formatNumber, pick, type MessageKey } from '../../i18n/index.js';
import type { OwnDoctor } from '../../services/doctors.js';
import { MAX_DOCTOR_COMMENT, type ResultToReview } from '../../services/orderResults.js';
import type { DoctorLabSet } from '../../services/labSets.js';
import { BUILT_IN_LAB_SETS } from '../../domain/labPrep.js';
import { labTest } from '../../domain/clinical.js';
import { shell } from './dashboard.js';
import { labItemName, labTestPicker } from './records.js';

type Notice = { kind: 'success' | 'error'; key: MessageKey };

function files(ctx: Ctx, r: ResultToReview): SafeHtml {
  return html`<ul class="result-files">${r.results.map(
    (f, n) => html`<li><a href="${href(ctx, `/results/${f.id}`)}" target="_blank" rel="noopener">${icon.upload}${ctx.t('hr.resultFile', { n: formatNumber(n + 1, ctx.locale) })} (${f.mime === 'application/pdf' ? 'PDF' : ctx.t('hr.image')})</a></li>`,
  )}</ul>`;
}

function resultCard(ctx: Ctx, r: ResultToReview): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  return html`<li class="hr-card stack-sm" id="res-${r.id}" data-testid="result-to-review">
    <div class="row-between">
      <div class="stack-sm">
        <strong><bdi>${r.patientName}</bdi></strong>
        <span class="small muted">${ctx.t(r.section === 'imaging' ? 'hr.tab.imaging' : 'hr.tab.lab')} · <bdi>${r.facilityName}</bdi> · ${formatFullDateTime(r.readyAt, ctx.locale, tz)}</span>
      </div>
      <a class="btn btn-ghost btn-sm" href="${href(ctx, `/dashboard/visits/${r.encounterId}`)}">${ctx.t('res.openVisit')}</a>
    </div>
    <ul class="hr-tests">${r.items.map((it) => html`<li dir="auto">${labItemName(ctx, it)}</li>`)}</ul>
    ${r.facilityNote ? html`<p class="hr-note" dir="auto"><strong>${ctx.t('res.centreNote')}:</strong> ${r.facilityNote}</p>` : ''}
    ${files(ctx, r)}
    ${r.reviewedAt
      ? html`<p class="small"><span class="chip hr-status hr-ready">${ctx.t('res.reviewed')}</span> ${formatFullDateTime(r.reviewedAt, ctx.locale, tz)}${r.followUp ? html` · <strong>${ctx.t('res.followUpAsked')}</strong>` : ''}</p>
          ${r.doctorComment ? html`<p class="hr-note" dir="auto">${r.doctorComment}</p>` : ''}`
      : html`<form method="post" action="${href(ctx, `/dashboard/results/${r.id}/review`)}" class="stack-sm">${csrfField(ctx)}
          <div class="field"><label for="c-${r.id}">${ctx.t('res.comment')} <span class="muted">(${ctx.t('common.optional')})</span></label>
            <textarea id="c-${r.id}" name="comment" rows="2" maxlength="${MAX_DOCTOR_COMMENT}" aria-describedby="c-${r.id}-hint"></textarea>
            <p class="hint" id="c-${r.id}-hint">${ctx.t('res.commentHint')}</p></div>
          <label class="check"><input type="checkbox" name="followUp" value="yes"> <span>${ctx.t('res.followUp')}</span></label>
          <div><button class="btn btn-primary" type="submit">${ctx.t('res.markReviewed')}</button></div>
        </form>`}
  </li>`;
}

export function resultsPage(ctx: Ctx, doctor: OwnDoctor, which: 'pending' | 'reviewed', list: ResultToReview[], pendingCount: number, notice?: Notice): SafeHtml {
  const tabs: { key: 'pending' | 'reviewed'; label: MessageKey }[] = [
    { key: 'pending', label: 'res.tab.pending' },
    { key: 'reviewed', label: 'res.tab.reviewed' },
  ];
  const content = html`<div class="stack-sm"><h1>${ctx.t('res.title')}</h1><p class="muted">${ctx.t('res.lead')}</p></div>
    <nav class="hr-tabs" aria-label="${ctx.t('res.title')}">${tabs.map(
      (t) => html`<a href="${href(ctx, '/dashboard/results', t.key === 'pending' ? {} : { tab: t.key })}"${attrIf(t.key === which, 'aria-current="page"')}>${ctx.t(t.label)}${
        t.key === 'pending' ? html` <span class="hr-count">${formatNumber(pendingCount, ctx.locale)}</span>` : ''
      }</a>`,
    )}</nav>
    ${list.length
      ? html`<ul class="appt-list">${list.map((r) => resultCard(ctx, r))}</ul>`
      : html`<div class="empty"><p>${ctx.t(which === 'pending' ? 'res.none' : 'res.noneReviewed')}</p></div>`}`;
  return shell(ctx, doctor, 'results', content, notice);
}

export function labSetsPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  sets: DoctorLabSet[],
  o: { notice?: Notice; error?: MessageKey; values?: { name: string; codes: string[]; other: string } } = {},
): SafeHtml {
  const comma = ctx.locale === 'ar' ? '، ' : ', ';
  const names = (codes: readonly string[]) =>
    codes.map((c) => { const t = labTest(c); return t ? pick(ctx.locale, { name_en: t.en, name_ar: t.ar }) : c; }).join(comma);
  const content = html`<a href="${href(ctx, '/dashboard/patients')}">← ${ctx.t('dash.nav.patients')}</a>
    <div class="stack-sm"><h1>${ctx.t('labset.title')}</h1><p class="muted">${ctx.t('labset.lead')}</p></div>
    <section class="panel stack"><h2>${ctx.t('labset.mine')}</h2>
      ${sets.length
        ? html`<ul class="appt-list">${sets.map(
            (s) => html`<li class="appt-row"><div class="stack-sm"><strong><bdi>${s.name}</bdi></strong>
                <span class="small muted" dir="auto">${[names(s.codes), ...s.other_names].filter(Boolean).join(comma)}</span></div>
              <form method="post" action="${href(ctx, `/dashboard/lab-sets/${s.id}/delete`)}" class="inline-form">${csrfField(ctx)}
                <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('labset.delete')}</button></form></li>`,
          )}</ul>`
        : html`<p class="muted">${ctx.t('labset.noneMine')}</p>`}
    </section>
    <section class="panel stack"><h2>${ctx.t('labset.add')}</h2>
      ${o.error ? alert('error', ctx.t(o.error)) : ''}
      <form method="post" action="${href(ctx, '/dashboard/lab-sets')}" class="stack" novalidate>${csrfField(ctx)}
        <div class="field"><label for="set-name">${ctx.t('labset.name')}</label>
          <input id="set-name" name="name" maxlength="60" required value="${o.values?.name ?? ''}"></div>
        ${labTestPicker(ctx, o.values?.codes ?? [], o.values?.other, 'set-')}
        <div><button class="btn btn-primary" type="submit">${ctx.t('labset.create')}</button></div>
      </form>
    </section>
    <section class="panel stack"><h2>${ctx.t('labset.builtIn')}</h2>
      <ul class="stack-sm">${BUILT_IN_LAB_SETS.map((b) => html`<li><strong>${ctx.t(b.label)}</strong> <span class="small muted">${names(b.codes)}</span></li>`)}</ul>
    </section>`;
  return shell(ctx, doctor, 'patients', content, o.notice);
}
