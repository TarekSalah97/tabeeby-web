import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { formatNumber, formatTime, type MessageKey } from '../../i18n/index.js';
import { money } from './public.js';
import { PERIODS, pct } from '../../services/insights.js';
import type { FacilityInsights } from '../../services/facilityInsights.js';
import type { OwnFacility } from '../../services/facilities.js';
import { PERIOD_LABEL, bar, stat } from './insights.js';
import { facilityShell } from './facilities.js';

export function facilityInsightsPage(ctx: Ctx, f: OwnFacility, d: FacilityInsights): SafeHtml {
  const pharmacy = f.kind === 'pharmacy';
  const order = [6, 0, 1, 2, 3, 4, 5];
  const maxWd = Math.max(1, ...d.weekdays);
  const maxDoc = Math.max(1, ...d.topDoctors.map((x) => x.requests));
  const top = d.topDoctors[0];
  const name = (en: string, ar: string) => (ctx.locale === 'ar' ? ar || en : en || ar);
  const content = html`
    <div class="row-between align-start">
      <div><h1>${ctx.t('fins.title')}</h1><p class="muted">${ctx.t('fins.lead')}</p></div>
      <nav class="row-wrap" aria-label="${ctx.t('ins.period')}">${PERIODS.map(
        (p) => html`<a class="chip-link" href="${href(ctx, '/facility/insights', { period: p })}"${attrIf(p === d.period, 'aria-current="true"')}>${ctx.t(PERIOD_LABEL[p])}</a>`,
      )}</nav>
    </div>

    <div class="ins-stats">
      ${stat(ctx, d.requests, 'fins.requests')}
      ${stat(ctx, d.patients, 'fins.patients')}
      ${stat(ctx, d.completed, pharmacy ? 'fins.completedPharmacy' : 'fins.completed')}
      ${stat(ctx, d.avgHours === null ? '—' : ctx.t('fins.hours', { n: formatNumber(d.avgHours, ctx.locale) }), pharmacy ? 'fins.avgHoursPharmacy' : 'fins.avgHours')}
      ${stat(ctx, d.repeatPatients, 'fins.repeat')}
      ${pharmacy
        ? stat(ctx, d.avgOrder == null ? '—' : money(ctx, d.avgOrder), 'fins.avgOrder')
        : stat(ctx, d.overdue ?? 0, 'fins.overdue')}
    </div>
    ${kindSpecific(ctx, f, d)}

    <section class="panel stack">
      <div class="stack-sm"><h2>${ctx.t('fins.topDoctors')}</h2><p class="muted small">${ctx.t('fins.topDoctorsLead')}</p></div>
      ${top
        ? html`<p class="ins-headline">${ctx.t('fins.topDoctor', { name: top.name })}</p>
          <ol class="ref-list">${d.topDoctors.map(
            (x, i) => html`<li class="ref-row">
              <span class="ref-rank" aria-hidden="true">${formatNumber(i + 1, ctx.locale)}</span>
              <div class="stack-sm ref-body">
                <div class="row-between"><a href="${href(ctx, `/doctors/${x.slug}`)}"><strong><bdi>${x.name}</bdi></strong></a>
                  <span class="muted small">${ctx.t('fins.doctorRow', { requests: formatNumber(x.requests, ctx.locale), patients: formatNumber(x.patients, ctx.locale) })}</span></div>
                ${x.specialty_en ? html`<span class="muted small">${name(x.specialty_en, x.specialty_ar ?? '')}</span>` : ''}
                <div class="ins-track" role="presentation"><div class="ins-fill w-${pct(x.requests, maxDoc)}"></div></div>
              </div>
            </li>`,
          )}</ol>`
        : html`<p class="muted">${ctx.t('fins.noDoctors')}</p>`}
    </section>

    <div class="card-grid two">
      <section class="panel stack">
        <h2>${ctx.t(pharmacy ? 'fins.topMedicines' : f.kind === 'radiology' ? 'fins.topScans' : 'fins.topTests')}</h2>
        ${d.topItems.length
          ? d.topItems.map((x) => bar(ctx, name(x.label_en, x.label_ar), x.count, d.topItems.reduce((s, y) => s + y.count, 0)))
          : html`<p class="muted">${ctx.t('fins.noItems')}</p>`}
      </section>
      <section class="panel stack">
        <h2>${ctx.t('fins.status')}</h2>
        ${bar(ctx, ctx.t(pharmacy ? 'fins.completedPharmacy' : 'fins.completed'), d.completed, d.requests + (pharmacy ? 0 : d.cancelled))}
        ${bar(ctx, ctx.t('fins.open'), d.open, d.requests + (pharmacy ? 0 : d.cancelled))}
        ${bar(ctx, ctx.t(pharmacy ? 'fins.unavailable' : 'fins.cancelled'), d.cancelled, d.requests + (pharmacy ? 0 : d.cancelled))}
        ${bar(ctx, ctx.t(pharmacy ? 'fins.delivery' : 'fins.home'), d.homeOrDelivery, d.requests)}
        <p class="small"><strong>${ctx.t('fins.revenue')}:</strong> ${money(ctx, d.revenue)}</p>
      </section>
      <section class="panel stack">
        <h2>${ctx.t('fins.specialties')}</h2><p class="muted small">${ctx.t('fins.specialtiesLead')}</p>
        ${d.specialties.length
          ? d.specialties.map((x) => bar(ctx, name(x.label_en, x.label_ar), x.count, d.specialties.reduce((a, y) => a + y.count, 0)))
          : html`<p class="muted">${ctx.t('fins.noDoctors')}</p>`}
      </section>
      <section class="panel stack">
        <h2>${ctx.t('fins.hoursTitle')}</h2><p class="muted small">${ctx.t('fins.hoursLead')}</p>
        ${hoursChart(ctx, d.hours)}
      </section>
      <section class="panel stack">
        <h2>${ctx.t('fins.weekdays')}</h2>
        ${order.map((wd) => bar(ctx, ctx.t(`weekday.${wd}` as MessageKey), d.weekdays[wd] ?? 0, d.weekdays.reduce((a, b) => a + b, 0) || maxWd))}
      </section>
    </div>`;
  return facilityShell(ctx, f, 'insights', content);
}

const clock = (h: number, ctx: Ctx) => formatTime(new Date(Date.UTC(2026, 0, 1, h)), ctx.locale, 'UTC');

/** Requests per hour as a small column chart, with the busiest two-hour window spelled out. */
function hoursChart(ctx: Ctx, hours: number[]): SafeHtml {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return html`<p class="muted">${ctx.t('fins.noItems')}</p>`;
  let best = 0;
  for (let h = 0; h < 24; h++) if ((hours[h]! + (hours[(h + 1) % 24] ?? 0)) > (hours[best]! + (hours[(best + 1) % 24] ?? 0))) best = h;
  const max = Math.max(...hours);
  // Show the working part of the day (first to last hour with requests).
  const first = hours.findIndex((n) => n > 0);
  const last = 23 - [...hours].reverse().findIndex((n) => n > 0);
  const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return html`<p class="ins-headline">${ctx.t('fins.peak', { from: clock(best, ctx), to: clock((best + 2) % 24, ctx) })}</p>
    <div class="hour-chart" role="img" aria-label="${ctx.t('fins.hoursTitle')}">${range.map(
      (h) => html`<div class="hour-col" title="${clock(h, ctx)}: ${formatNumber(hours[h]!, ctx.locale)}"><span class="hour-bar h-${pct(hours[h]!, max)}"></span><span class="hour-label">${formatNumber(h % 12 || 12, ctx.locale)}</span></div>`,
    )}</div>`;
}

/** The part of the page that differs for labs, scan centres and pharmacies. */
function kindSpecific(ctx: Ctx, f: OwnFacility, d: FacilityInsights): SafeHtml {
  const name = (en: string, ar: string) => (ctx.locale === 'ar' ? ar || en : en || ar);
  if (f.kind === 'pharmacy') {
    const a = d.answers ?? { ready: 0, partly: 0, unavailable: 0 };
    const answered = a.ready + a.partly + a.unavailable;
    return html`<div class="card-grid two">
      <section class="panel stack">
        <h2>${ctx.t('fins.stockGaps')}</h2><p class="muted small">${ctx.t('fins.stockGapsLead')}</p>
        ${d.stockGaps?.length
          ? html`<ul class="price-summary">${d.stockGaps.map((x) => html`<li><span><bdi>${x.label_en}</bdi></span><strong>${formatNumber(x.count, ctx.locale)}×</strong></li>`)}</ul>`
          : html`<p class="muted">${ctx.t('fins.stockGapsNone')}</p>`}
      </section>
      <section class="panel stack">
        <h2>${ctx.t('fins.answers')}</h2>
        ${answered ? html`<p class="ins-headline">${ctx.t('fins.fillRate', { p: formatNumber(pct(a.ready, answered), ctx.locale) })}</p>` : ''}
        ${bar(ctx, ctx.t('fins.answerAll'), a.ready, answered)}
        ${bar(ctx, ctx.t('fins.answerPartly'), a.partly, answered)}
        ${bar(ctx, ctx.t('fins.answerNone'), a.unavailable, answered)}
      </section>
    </div>`;
  }
  const missing = d.notOffered ?? [];
  return html`<div class="card-grid two">
    ${f.kind === 'radiology'
      ? html`<section class="panel stack">
          <h2>${ctx.t('fins.modalities')}</h2><p class="muted small">${ctx.t('fins.modalitiesLead')}</p>
          ${d.modalities?.length
            ? d.modalities.map((m) => html`${bar(ctx, ctx.t(`fins.modality.${m.key}` as MessageKey), m.count, d.requests)}
                ${m.avgHours !== null ? html`<p class="small muted ins-sub">${ctx.t('fins.reportTime', { n: formatNumber(m.avgHours, ctx.locale) })}</p>` : ''}`)
            : html`<p class="muted">${ctx.t('fins.noItems')}</p>`}
        </section>`
      : ''}
    <section class="panel stack">
      <h2>${ctx.t('fins.notOffered')}</h2><p class="muted small">${ctx.t('fins.notOfferedLead')}</p>
      ${missing.length
        ? html`<ul class="price-summary">${missing.map((x) => html`<li><span>${name(x.label_en, x.label_ar)}</span><strong>${formatNumber(x.count, ctx.locale)}×</strong></li>`)}</ul>
          <div><a class="btn btn-outline btn-sm" href="${href(ctx, '/facility/prices')}">${ctx.t('fins.addPrices')}</a></div>`
        : html`<p class="muted">${ctx.t('fins.notOfferedNone')}</p>`}
    </section>
    <section class="panel stack">
      <h2>${ctx.t('fins.overdue')}</h2>
      ${d.overdue
        ? html`<p class="ins-headline warn-text">${formatNumber(d.overdue, ctx.locale)}</p>
            <div><a class="btn btn-primary btn-sm" href="${href(ctx, '/facility/requests')}">${ctx.t('fins.openRequests')}</a></div>`
        : html`<p class="muted">${ctx.t('fins.overdueOk')}</p>`}
    </section>
  </div>`;
}
