import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { formatNumber, type MessageKey } from '../../i18n/index.js';
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
    </div>

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
        <h2>${ctx.t('fins.weekdays')}</h2>
        ${order.map((wd) => bar(ctx, ctx.t(`weekday.${wd}` as MessageKey), d.weekdays[wd] ?? 0, d.weekdays.reduce((a, b) => a + b, 0) || maxWd))}
      </section>
    </div>`;
  return facilityShell(ctx, f, 'insights', content);
}
