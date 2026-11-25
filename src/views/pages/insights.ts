import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { formatNumber, type MessageKey } from '../../i18n/index.js';
import type { OwnDoctor } from '../../services/doctors.js';
import { shell } from './dashboard.js';
import { WEEKDAY_SHORT } from '../components.js';
import { AGE_BANDS, PERIODS, pct, type Insights, type Period } from '../../services/insights.js';

export const PERIOD_LABEL: Record<Period, MessageKey> = { '30d': 'ins.p30', '90d': 'ins.p90', '12m': 'ins.p12m', all: 'ins.pAll' };

/** One labelled bar: count and percentage (text, so it reads without colour). */
export function bar(ctx: Ctx, label: string, n: number, whole: number, tone = ''): SafeHtml {
  const p = pct(n, whole);
  return html`<div class="ins-bar">
    <div class="ins-bar-label"><span>${label}</span><span class="muted">${formatNumber(n, ctx.locale)} · ${formatNumber(p, ctx.locale)}%</span></div>
    <div class="ins-track" role="presentation"><div class="ins-fill ${tone} w-${p}"></div></div>
  </div>`;
}

export function stat(ctx: Ctx, n: number | string, label: MessageKey): SafeHtml {
  return html`<div class="ins-stat"><strong>${typeof n === 'number' ? formatNumber(n, ctx.locale) : n}</strong><span class="muted small">${ctx.t(label)}</span></div>`;
}

export function insightsPage(ctx: Ctx, doctor: OwnDoctor, d: Insights): SafeHtml {
  const sexTotal = d.sex.female + d.sex.male;
  const known = sexTotal > 0;
  const leading = !known ? null : d.sex.female === d.sex.male ? 'ins.even' : d.sex.female > d.sex.male ? 'ins.mostlyFemale' : 'ins.mostlyMale';
  const dueVisits = d.attendance.completed + d.attendance.noShow;
  const maxWd = Math.max(1, ...d.weekdays);
  const order = [6, 0, 1, 2, 3, 4, 5];
  const content = html`
    <div class="row-between align-start">
      <div><h1>${ctx.t('ins.title')}</h1><p class="muted">${ctx.t('ins.lead')}</p></div>
      <nav class="row-wrap" aria-label="${ctx.t('ins.period')}">${PERIODS.map(
        (p) => html`<a class="chip-link" href="${href(ctx, '/dashboard/insights', { period: p })}"${attrIf(p === d.period, 'aria-current="true"')}>${ctx.t(PERIOD_LABEL[p])}</a>`,
      )}</nav>
    </div>

    <div class="ins-stats">
      ${stat(ctx, d.patientsSeen, 'ins.patientsSeen')}
      ${stat(ctx, d.newFiles, 'ins.newFiles')}
      ${stat(ctx, d.visits.total, 'ins.visits')}
      ${stat(ctx, dueVisits ? `${formatNumber(pct(d.attendance.noShow, dueVisits), ctx.locale)}%` : '—', 'ins.noShowRate')}
    </div>

    <div class="card-grid two">
      <section class="panel stack">
        <h2>${ctx.t('ins.sexTitle')}</h2>
        ${!doctor.records_enabled
          ? html`<p class="muted">${ctx.t('ins.needFiles')}</p>`
          : d.patientsSeen === 0
            ? html`<p class="muted">${ctx.t('ins.noPatients')}</p>`
            : html`
              ${leading ? html`<p class="ins-headline">${ctx.t(leading as MessageKey, { p: formatNumber(pct(Math.max(d.sex.female, d.sex.male), sexTotal), ctx.locale) })}</p>` : ''}
              <div class="ins-split" role="img" aria-label="${ctx.t('ins.sexTitle')}">
                <span class="ins-split-f w-${pct(d.sex.female, sexTotal)}"></span><span class="ins-split-m w-${100 - pct(d.sex.female, sexTotal)}"></span>
              </div>
              ${bar(ctx, ctx.t('ins.female'), d.sex.female, sexTotal, 'tone-f')}
              ${bar(ctx, ctx.t('ins.male'), d.sex.male, sexTotal, 'tone-m')}
              ${d.sex.unknown ? html`<p class="small muted">${ctx.t('ins.sexUnknown', { n: formatNumber(d.sex.unknown, ctx.locale) })}</p>` : ''}`}
      </section>

      <section class="panel stack">
        <h2>${ctx.t('ins.ageTitle')}</h2>
        ${!doctor.records_enabled || d.patientsSeen === 0
          ? html`<p class="muted">${ctx.t(doctor.records_enabled ? 'ins.noPatients' : 'ins.needFiles')}</p>`
          : html`${AGE_BANDS.filter((b) => b !== 'unknown').map((b) => bar(ctx, ctx.t('ins.years', { band: b }), d.ages[b], d.patientsSeen - d.ages.unknown))}
            ${d.ages.unknown ? html`<p class="small muted">${ctx.t('ins.ageUnknown', { n: formatNumber(d.ages.unknown, ctx.locale) })}</p>` : ''}`}
      </section>

      <section class="panel stack">
        <h2>${ctx.t('ins.typesTitle')}</h2>
        ${d.visits.total
          ? html`${bar(ctx, ctx.t('book.new'), d.visits.new, d.visits.total)}
              ${bar(ctx, ctx.t('book.followUp'), d.visits.followUp, d.visits.total)}
              ${bar(ctx, ctx.t('svc.title'), d.visits.service, d.visits.total)}
              ${d.topServices.length
                ? html`<p class="small"><strong>${ctx.t('ins.topServices')}:</strong> ${d.topServices.map((s) => `${ctx.locale === 'ar' ? s.name_ar ?? s.name : s.name} (${formatNumber(s.count, ctx.locale)})`).join('، ')}</p>`
                : ''}`
          : html`<p class="muted">${ctx.t('ins.noVisits')}</p>`}
      </section>

      <section class="panel stack">
        <h2>${ctx.t('ins.daysTitle')}</h2>
        ${d.weekdays.some((n) => n > 0)
          ? html`<div class="ins-days">${order.map(
              (wd) => html`<div class="ins-day"><div class="ins-day-col"><div class="ins-day-fill h-${Math.round((d.weekdays[wd]! / maxWd) * 100)}"></div></div>
                <span class="small" title="${ctx.t(`weekday.${wd}` as MessageKey)}">${WEEKDAY_SHORT[ctx.locale][wd]}</span><span class="small muted">${formatNumber(d.weekdays[wd]!, ctx.locale)}</span></div>`,
            )}</div>`
          : html`<p class="muted">${ctx.t('ins.noVisits')}</p>`}
      </section>
    </div>
    <p class="small muted">${ctx.t('ins.privacy')}</p>`;
  return shell(ctx, doctor, 'insights', content);
}
