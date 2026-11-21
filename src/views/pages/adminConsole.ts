import { html, attrIf, trusted, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, input } from '../components.js';
import { formatDateTime, formatNumber, formatShortDate, type MessageKey } from '../../i18n/index.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import { zonedToUtc } from '../../domain/time.js';
import type { AccountRow, AdminStats, AuditFilters, AuditRow, DayRange, FailedMessage, OutboxCount, RangePreset } from '../../services/adminConsole.js';

export type AdminSection = 'dashboard' | 'doctors' | 'accounts' | 'reviews' | 'audit' | 'messages';

const svg = (paths: string) =>
  trusted(`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);

export const adminIcon = {
  dashboard: svg('<path d="M3 3v18h18"></path><path d="M8 17V11"></path><path d="M13 17V7"></path><path d="M18 17v-4"></path>'),
  doctors: svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="12" r="2"></circle><path d="M14 10h4M14 14h4"></path>'),
  accounts: svg('<circle cx="12" cy="12" r="9"></circle><path d="m5.7 5.7 12.6 12.6"></path>'),
  reviews: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path>'),
  audit: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path>'),
  messages: svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>'),
  people: svg('<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><path d="M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"></path>'),
  clock: svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>'),
  check: svg('<path d="m5 12 5 5 9-10"></path>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"></path>'),
  alert: svg('<path d="M12 3 2 20h20L12 3Z"></path><path d="M12 10v4M12 17h.01"></path>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>'),
  stethoscope: svg('<path d="M6 3v6a4 4 0 0 0 8 0V3"></path><path d="M10 13v3a5 5 0 0 0 10 0v-2"></path><circle cx="20" cy="12" r="2"></circle>'),
  userPlus: svg('<circle cx="9" cy="8" r="3"></circle><path d="M3 20a6 6 0 0 1 12 0"></path><path d="M19 8v6M16 11h6"></path>'),
};

const NAV: { key: AdminSection; path: string; label: MessageKey; icon: SafeHtml }[] = [
  { key: 'dashboard', path: '/admin', label: 'adm.nav.dashboard', icon: adminIcon.dashboard },
  { key: 'doctors', path: '/admin/doctors', label: 'adm.nav.doctors', icon: adminIcon.doctors },
  { key: 'accounts', path: '/admin/accounts', label: 'adm.nav.accounts', icon: adminIcon.accounts },
  { key: 'reviews', path: '/admin/reviews', label: 'adm.nav.reviews', icon: adminIcon.reviews },
  { key: 'audit', path: '/admin/audit', label: 'adm.nav.audit', icon: adminIcon.audit },
  { key: 'messages', path: '/admin/messages', label: 'adm.nav.messages', icon: adminIcon.messages },
];

/** The admin area: the same sidebar on every page, like the doctor dashboard. */
export function adminShell(ctx: Ctx, section: AdminSection, title: string, content: SafeHtml): SafeHtml {
  const body = html`<div class="dash admin">
    <nav class="dash-nav" aria-label="${ctx.t('adm.navLabel')}">
      <p class="dash-nav-title">${ctx.t('adm.areaTitle')}</p>
      <ul>${NAV.map(
        (i) => html`<li><a href="${href(ctx, i.path)}"${attrIf(i.key === section, 'aria-current="page"')}>${i.icon}<span>${ctx.t(i.label)}</span></a></li>`,
      )}</ul>
    </nav>
    <div class="dash-content stack-lg">${content}</div>
  </div>`;
  return layout(ctx, { title: `${title} — ${ctx.t('brand')}`, body, variant: 'app', noindex: true });
}

function kpi(ctx: Ctx, label: MessageKey, value: number, ic: SafeHtml, tone = '', link?: string): SafeHtml {
  const inner = html`<span class="kpi-icon ${tone}">${ic}</span><strong>${formatNumber(value, ctx.locale)}</strong><span>${ctx.t(label)}</span>`;
  return link ? html`<a class="kpi kpi-link" href="${link}">${inner}</a>` : html`<div class="kpi">${inner}</div>`;
}

function rangeLabel(ctx: Ctx, r: DayRange): string {
  const tz = ctx.deps.cfg.TIME_ZONE;
  if (r.preset !== 'custom' && r.preset !== 'all') return ctx.t(`adm.range.${r.preset}`);
  if (!r.from && !r.to) return ctx.t('adm.range.all');
  const d = (s?: string) => (s ? formatShortDate(zonedToUtc(s, '12:00', tz), ctx.locale, tz) : '…');
  return `${d(r.from)} – ${d(r.to)}`;
}

/** Preset chips plus a from/to form; keeps other query values (used by the dashboard and the audit log). */
function rangePicker(ctx: Ctx, path: string, r: DayRange, keep: Record<string, string> = {}): SafeHtml {
  const presets: RangePreset[] = ['all', 'today', '7d', '30d', 'month'];
  return html`<details class="range-picker panel"${attrIf(r.preset === 'custom', 'open')}>
    <summary>${adminIcon.calendar}<span>${ctx.t('adm.dateRange')}: <strong>${rangeLabel(ctx, r)}</strong></span></summary>
    <div class="stack-sm">
      <div class="row-wrap">${presets.map(
        (p) => html`<a class="chip-link${p === r.preset ? ' selected' : ''}"${attrIf(p === r.preset, 'aria-current="true"')} href="${href(ctx, path, { ...keep, range: p === 'all' ? undefined : p })}">${ctx.t(`adm.range.${p}`)}</a>`,
      )}</div>
      <form method="get" action="${href(ctx, path)}" class="row-wrap range-form">
        ${Object.entries(keep).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
        <label class="field-inline">${ctx.t('adm.from')} <input type="date" name="from" value="${r.from ?? ''}"></label>
        <label class="field-inline">${ctx.t('adm.to')} <input type="date" name="to" value="${r.to ?? ''}"></label>
        <button class="btn btn-primary btn-sm" type="submit">${ctx.t('adm.apply')}</button>
      </form>
    </div>
  </details>`;
}

export function adminDashboardPage(ctx: Ctx, s: AdminStats, range: DayRange): SafeHtml {
  const quick: { path: string; label: MessageKey; icon: SafeHtml; badge?: number }[] = [
    { path: '/admin/doctors', label: 'adm.nav.doctors', icon: adminIcon.doctors, badge: s.doctorsPending },
    { path: '/admin/accounts', label: 'adm.nav.accounts', icon: adminIcon.accounts },
    { path: '/admin/reviews', label: 'adm.nav.reviews', icon: adminIcon.reviews },
    { path: '/admin/audit', label: 'adm.nav.audit', icon: adminIcon.audit },
    { path: '/admin/messages', label: 'adm.nav.messages', icon: adminIcon.messages, badge: s.failedMessages },
  ];
  const content = html`
    <h1>${ctx.t('adm.nav.dashboard')}</h1>
    ${s.doctorsPending ? alert('info', html`${ctx.t('adm.pendingAlert', { n: formatNumber(s.doctorsPending, ctx.locale) })} <a href="${href(ctx, '/admin/doctors')}">${ctx.t('admin.review')}</a>`) : ''}
    ${s.failedMessages ? alert('warning', html`${ctx.t('adm.failedAlert', { n: formatNumber(s.failedMessages, ctx.locale) })} <a href="${href(ctx, '/admin/messages')}">${ctx.t('adm.nav.messages')}</a>`) : ''}
    ${rangePicker(ctx, '/admin', range)}
    <section class="stack-sm" aria-labelledby="k-people"><h2 id="k-people" class="h3">${ctx.t('adm.groupPeople')}</h2>
      <div class="kpis">
        ${kpi(ctx, 'adm.doctorsActive', s.doctorsActive, adminIcon.stethoscope, 'ok')}
        ${kpi(ctx, 'adm.doctorsPending', s.doctorsPending, adminIcon.clock, 'warn', href(ctx, '/admin/doctors'))}
        ${kpi(ctx, 'adm.doctorsSuspended', s.doctorsSuspended, adminIcon.accounts, 'danger')}
        ${kpi(ctx, 'adm.patients', s.patients, adminIcon.people)}
      </div>
    </section>
    <section class="stack-sm" aria-labelledby="k-activity"><h2 id="k-activity" class="h3">${ctx.t('adm.groupActivity')} <span class="muted small">(${rangeLabel(ctx, range)})</span></h2>
      <div class="kpis">
        ${kpi(ctx, 'adm.bookings', s.bookings, adminIcon.calendar, 'info')}
        ${kpi(ctx, 'adm.completed', s.completed, adminIcon.check, 'ok')}
        ${kpi(ctx, 'adm.waitlistJoins', s.waitlistJoins, adminIcon.list)}
        ${kpi(ctx, 'adm.cancellations', s.cancellations, adminIcon.x, 'danger')}
        ${kpi(ctx, 'adm.noShows', s.noShows, adminIcon.alert, 'warn')}
        ${kpi(ctx, 'adm.newPatients', s.newPatients, adminIcon.userPlus)}
        ${kpi(ctx, 'adm.reviews', s.reviews, adminIcon.reviews, '', href(ctx, '/admin/reviews'))}
      </div>
    </section>
    <section class="stack-sm" aria-labelledby="k-quick"><h2 id="k-quick" class="h3">${ctx.t('adm.quickActions')}</h2>
      <div class="quick-grid admin-quick">${quick.map(
        (q) => html`<a class="quick-tile" href="${href(ctx, q.path)}">${q.icon}<span>${ctx.t(q.label)}</span>${q.badge ? html`<span class="count-badge">${formatNumber(q.badge, ctx.locale)}</span>` : ''}</a>`,
      )}</div>
    </section>`;
  return adminShell(ctx, 'dashboard', ctx.t('adm.nav.dashboard'), content);
}

const roleLabel = (ctx: Ctx, role: string) => ctx.t(role === 'doctor' ? 'adm.roleDoctor' : role === 'admin' ? 'adm.roleAdmin' : 'adm.rolePatient');

export function adminAccountsPage(ctx: Ctx, o: { q: string; results: AccountRow[] | null; notice?: MessageKey; error?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const row = (a: AccountRow) => html`<li class="appt-row${a.status === 'suspended' ? ' muted-row' : ''}">
    <div class="stack-sm">
      <div class="row-wrap"><strong dir="auto">${a.full_name}</strong><span class="chip">${roleLabel(ctx, a.role)}</span>
        <span class="chip ${a.status === 'suspended' ? 'status-cancelled' : 'status-confirmed'}">${ctx.t(a.status === 'suspended' ? 'adm.statusSuspended' : 'adm.statusActive')}</span></div>
      <span class="muted small"><span dir="ltr">${formatEgyptMobile(a.phone_e164)}</span>${a.email ? html` · <span dir="ltr">${a.email}</span>` : ''} · ${ctx.t('adm.joined')} ${formatDateTime(a.created_at, ctx.locale, tz)}</span>
      ${a.upcoming ? html`<span class="small">${ctx.t('adm.upcomingCount', { n: formatNumber(a.upcoming, ctx.locale) })}</span>` : ''}
    </div>
    <div class="stack-sm account-actions">
      ${a.role === 'doctor' ? html`<a class="btn btn-ghost btn-sm" href="${href(ctx, `/admin/doctors/${a.id}`)}">${ctx.t('adm.openDoctor')}</a>` : ''}
      ${a.role === 'admin'
        ? html`<span class="muted small">${ctx.t('adm.adminProtected')}</span>`
        : a.status === 'active'
          ? html`<form method="post" action="${href(ctx, `/admin/accounts/${a.id}/suspend`)}" class="stack-sm">${csrfField(ctx)}
              <input type="hidden" name="q" value="${o.q}">
              <label class="sr-only" for="reason-${a.id}">${ctx.t('adm.suspendReason')}</label>
              <input id="reason-${a.id}" name="reason" maxlength="300" required placeholder="${ctx.t('adm.suspendReason')}">
              <button type="submit" class="btn btn-outline btn-sm danger">${ctx.t('adm.suspend')}</button></form>`
          : html`<form method="post" action="${href(ctx, `/admin/accounts/${a.id}/reactivate`)}">${csrfField(ctx)}
              <input type="hidden" name="q" value="${o.q}">
              <button type="submit" class="btn btn-primary btn-sm">${ctx.t('adm.reactivate')}</button></form>`}
    </div>
  </li>`;
  const content = html`
    <div><h1>${ctx.t('adm.nav.accounts')}</h1><p class="muted">${ctx.t('adm.accountsLead')}</p></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    ${o.error ? alert('error', ctx.t(o.error)) : ''}
    <form method="get" action="${href(ctx, '/admin/accounts')}" class="panel row-wrap search-row" role="search">
      <label class="sr-only" for="q">${ctx.t('adm.searchLabel')}</label>
      <input id="q" name="q" value="${o.q}" placeholder="${ctx.t('adm.searchPlaceholder')}" minlength="2" required>
      <button class="btn btn-primary" type="submit">${ctx.t('adm.search')}</button>
    </form>
    ${o.results === null ? '' : o.results.length ? html`<ul class="appt-list">${o.results.map(row)}</ul>` : html`<p class="muted">${ctx.t('adm.noMatches')}</p>`}`;
  return adminShell(ctx, 'accounts', ctx.t('adm.nav.accounts'), content);
}

/** Short, readable view of an audit entry's extra details. */
function metaText(m: Record<string, unknown>): string {
  return Object.entries(m)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 300);
}

export function adminAuditPage(ctx: Ctx, f: AuditFilters, rows: AuditRow[]): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const keep: Record<string, string> = {};
  for (const [k, v] of [['action', f.action], ['entityType', f.entityType], ['entityId', f.entityId], ['actor', f.actor]] as const) if (v) keep[k] = v;
  const content = html`
    <div><h1>${ctx.t('adm.nav.audit')}</h1><p class="muted">${ctx.t('adm.auditLead')}</p></div>
    ${rangePicker(ctx, '/admin/audit', f.range, keep)}
    <form method="get" action="${href(ctx, '/admin/audit')}" class="panel audit-filters">
      ${f.range.from ? html`<input type="hidden" name="from" value="${f.range.from}">` : ''}
      ${f.range.to ? html`<input type="hidden" name="to" value="${f.range.to}">` : ''}
      ${f.range.preset !== 'custom' && f.range.preset !== 'all' ? html`<input type="hidden" name="range" value="${f.range.preset}">` : ''}
      ${input(ctx, { name: 'action', label: ctx.t('adm.fAction'), value: f.action, placeholder: 'doctor. / account. / appointment.', maxlength: 60 })}
      ${input(ctx, { name: 'entityType', label: ctx.t('adm.fEntityType'), value: f.entityType, placeholder: 'user / doctor / appointment', maxlength: 60 })}
      ${input(ctx, { name: 'entityId', label: ctx.t('adm.fEntityId'), value: f.entityId, maxlength: 80 })}
      ${input(ctx, { name: 'actor', label: ctx.t('adm.fActor'), value: f.actor, placeholder: ctx.t('adm.fActorHint'), maxlength: 120 })}
      <div class="row-wrap"><button class="btn btn-primary" type="submit">${ctx.t('adm.search')}</button>
        <a class="btn btn-ghost" href="${href(ctx, '/admin/audit')}">${ctx.t('adm.reset')}</a></div>
    </form>
    ${rows.length
      ? html`<div class="table-scroll"><table class="table cards-on-phone">
          <thead><tr><th scope="col">${ctx.t('adm.when')}</th><th scope="col">${ctx.t('adm.who')}</th><th scope="col">${ctx.t('adm.fAction')}</th><th scope="col">${ctx.t('adm.what')}</th><th scope="col">${ctx.t('adm.details')}</th></tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr>
              <td class="nowrap" data-label="${ctx.t('adm.when')}">${formatDateTime(r.created_at, ctx.locale, tz)}</td>
              <td data-label="${ctx.t('adm.who')}">${r.actor_name ? html`<span dir="auto">${r.actor_name}</span> <span class="muted small">(${roleLabel(ctx, r.actor_role ?? '')})</span>` : html`<span class="muted">${ctx.t('adm.system')}</span>`}</td>
              <td data-label="${ctx.t('adm.fAction')}"><code>${r.action}</code></td>
              <td data-label="${ctx.t('adm.what')}"><span class="small">${r.entity_type}</span>${r.entity_id ? html` <a class="muted small" href="${href(ctx, '/admin/audit', { entityId: r.entity_id })}" dir="ltr">${r.entity_id.slice(0, 8)}…</a>` : ''}</td>
              <td class="muted small" data-label="${ctx.t('adm.details')}" dir="ltr">${metaText(r.metadata)}${r.ip ? html` · ip ${r.ip}` : ''}</td>
            </tr>`,
          )}</tbody></table></div>
          <p class="hint">${ctx.t('adm.auditLimit', { n: formatNumber(rows.length, ctx.locale) })}</p>`
      : html`<p class="muted">${ctx.t('adm.auditEmpty')}</p>`}`;
  return adminShell(ctx, 'audit', ctx.t('adm.nav.audit'), content);
}

export interface ServiceStatus {
  sms: boolean;
  email: boolean;
  ai: boolean;
  records: number;
  rules: { cancelHours: number; horizonDays: number; leadMinutes: number; maxActive: number };
}

export function adminMessagesPage(ctx: Ctx, svc: ServiceStatus, o: { counts: OutboxCount[]; failed: FailedMessage[]; notice?: MessageKey }): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const count = (channel: string, status: string) => o.counts.find((c) => c.channel === channel && c.status === status)?.n ?? 0;
  const service = (on: boolean, name: MessageKey, offHint: MessageKey) => html`<div class="service-card">
    <span class="chip ${on ? 'status-confirmed' : 'status-cancelled'}">${ctx.t(on ? 'adm.on' : 'adm.off')}</span>
    <strong>${ctx.t(name)}</strong>
    ${on ? '' : html`<span class="muted small">${ctx.t(offHint)}</span>`}
  </div>`;
  const content = html`
    <div><h1>${ctx.t('adm.nav.messages')}</h1><p class="muted">${ctx.t('adm.messagesLead')}</p></div>
    ${o.notice ? alert('success', ctx.t(o.notice)) : ''}
    <section class="panel stack"><h2 class="h3">${ctx.t('adm.services')}</h2>
      <div class="card-grid service-grid">
        ${service(svc.sms, 'adm.svcSms', 'adm.svcSmsOff')}
        ${service(svc.email, 'adm.svcEmail', 'adm.svcEmailOff')}
        ${service(svc.ai, 'adm.svcAi', 'adm.svcAiOff')}
      </div>
      <p class="hint">${ctx.t('adm.servicesHint')}</p>
    </section>
    <section class="panel stack"><h2 class="h3">${ctx.t('adm.week')}</h2>
      <div class="table-scroll"><table class="table table-fit">
        <thead><tr><th scope="col"></th><th scope="col">${ctx.t('adm.sent')}</th><th scope="col">${ctx.t('adm.waiting')}</th><th scope="col">${ctx.t('adm.failed')}</th><th scope="col">${ctx.t('adm.skipped')}</th></tr></thead>
        <tbody>${(['sms', 'email'] as const).map(
          (ch) => html`<tr><th scope="row">${ctx.t(ch === 'sms' ? 'adm.svcSms' : 'adm.svcEmail')}</th>
            <td>${formatNumber(count(ch, 'sent'), ctx.locale)}</td><td>${formatNumber(count(ch, 'pending'), ctx.locale)}</td>
            <td>${formatNumber(count(ch, 'failed'), ctx.locale)}</td><td>${formatNumber(count(ch, 'skipped'), ctx.locale)}</td></tr>`,
        )}</tbody></table></div>
      <p class="hint">${ctx.t('adm.skippedHint')}</p>
    </section>
    <section class="panel stack"><div class="row-between"><h2 class="h3">${ctx.t('adm.failedTitle')}</h2>
      ${o.failed.length
        ? html`<form method="post" action="${href(ctx, '/admin/messages/retry')}">${csrfField(ctx)}<button class="btn btn-primary btn-sm" type="submit">${ctx.t('adm.retry')}</button></form>`
        : ''}</div>
      ${o.failed.length
        ? html`<ul class="appt-list">${o.failed.map(
            (m) => html`<li class="appt-row"><div class="stack-sm">
              <strong>${ctx.t(m.channel === 'sms' ? 'adm.svcSms' : 'adm.svcEmail')} · <span dir="ltr">${m.recipient}</span></strong>
              <span class="muted small">${formatDateTime(m.created_at, ctx.locale, tz)} · ${ctx.t('adm.attempts', { n: m.attempts })}</span>
              ${m.last_error ? html`<code class="small" dir="ltr">${m.last_error.slice(0, 200)}</code>` : ''}
            </div></li>`,
          )}</ul>`
        : html`<p class="muted">${ctx.t('adm.noFailed')}</p>`}
    </section>
    <section class="panel stack"><h2 class="h3">${ctx.t('adm.settings')}</h2>
      <dl class="summary">
        <div><dt>${ctx.t('adm.setCancel')}</dt><dd>${ctx.t('adm.hours', { n: svc.rules.cancelHours })}</dd></div>
        <div><dt>${ctx.t('adm.setHorizon')}</dt><dd>${ctx.t('adm.days', { n: svc.rules.horizonDays })}</dd></div>
        <div><dt>${ctx.t('adm.setLead')}</dt><dd>${ctx.t('adm.minutes', { n: svc.rules.leadMinutes })}</dd></div>
        <div><dt>${ctx.t('adm.setMaxActive')}</dt><dd>${formatNumber(svc.rules.maxActive, ctx.locale)}</dd></div>
        <div><dt>${ctx.t('adm.setRecords')}</dt><dd>${ctx.t('adm.recordsCount', { n: formatNumber(svc.records, ctx.locale) })}</dd></div>
      </dl>
      <p class="hint">${ctx.t('adm.settingsHint')}</p>
    </section>`;
  return adminShell(ctx, 'messages', ctx.t('adm.nav.messages'), content);
}
