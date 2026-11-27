import { html, attrIf, type SafeHtml } from '../html.js';
import { rxLineText } from './records.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon } from '../components.js';
import { formatFullDate, formatNumber, formatTime, type MessageKey } from '../../i18n/index.js';
import { MAX_DAYS, MAX_TIMES, suggestedTimes } from '../../domain/medReminders.js';
import { todayIn } from '../../domain/time.js';
import type { Dose, MedicineReminder, RxForSetup, SetupItem } from '../../services/medReminders.js';

type Notice = { kind: 'success' | 'error'; key: MessageKey };

const timeLabel = (ctx: Ctx, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return formatTime(new Date(Date.UTC(2026, 0, 1, h, m)), ctx.locale, 'UTC');
};

function phonePanel(ctx: Ctx, o: { phones: number; vapidKey: string; showNames: boolean }): SafeHtml {
  return html`<section class="panel stack" id="phone" data-testid="push-panel">
    <h2>${icon.bell}${ctx.t('med.phone.title')}</h2>
    <p class="small">${ctx.t(o.phones ? 'med.phone.on' : 'med.phone.off', { n: formatNumber(o.phones, ctx.locale) })}</p>
    <div class="push-controls" data-push data-key="${o.vapidKey}"
         data-subscribe="${href(ctx, '/medicines/push/subscribe')}" data-unsubscribe="${href(ctx, '/medicines/push/unsubscribe')}">
      <p class="small muted" data-push-status hidden></p>
      <div class="row-wrap">
        <button class="btn btn-primary" type="button" data-push-on hidden>${icon.bell}${ctx.t('med.phone.turnOn')}</button>
        <button class="btn btn-ghost" type="button" data-push-off hidden>${ctx.t('med.phone.turnOff')}</button>
      </div>
      <p class="small muted" data-push-unsupported hidden>${ctx.t('med.phone.unsupported')}</p>
      <noscript><p class="small">${ctx.t('med.phone.noscript')}</p></noscript>
    </div>
    ${o.phones
      ? html`<form method="post" action="${href(ctx, '/medicines/push/test')}" class="inline-form">${csrfField(ctx)}
          <button class="btn btn-outline btn-sm" type="submit">${ctx.t('med.phone.test')}</button></form>`
      : ''}
    <details class="small"><summary>${ctx.t('med.phone.iphoneTitle')}</summary><p>${ctx.t('med.phone.iphone')}</p></details>
    <form method="post" action="${href(ctx, '/medicines/settings')}" class="stack-sm">${csrfField(ctx)}
      <label class="check"><input type="checkbox" name="showNames" value="yes"${attrIf(o.showNames, 'checked')}> <span>${ctx.t('med.showNames')}</span></label>
      <p class="hint">${ctx.t('med.showNamesHint')}</p>
      <div><button class="btn btn-ghost btn-sm" type="submit">${ctx.t('common.save')}</button></div>
    </form>
  </section>`;
}

function doseRow(ctx: Ctx, d: Dose, now: Date): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const late = !d.takenAt && d.dueAt.getTime() < now.getTime() - 30 * 60_000;
  const canTick = d.dueAt.getTime() <= now.getTime() + 2 * 3600_000;
  return html`<li class="dose-row${d.takenAt ? ' taken' : late ? ' late' : ''}" data-testid="dose">
    <span class="dose-time">${formatTime(d.dueAt, ctx.locale, tz)}</span>
    <span class="stack-sm dose-what"><strong dir="auto">${d.medicine}</strong>
      <span class="small muted" dir="auto">${d.dose ?? ''}${d.dose && d.timing ? ' · ' : ''}${d.timing ? ctx.t(`rx.timing.${d.timing}` as MessageKey) : ''}</span></span>
    ${d.takenAt
      ? html`<form method="post" action="${href(ctx, '/medicines/doses')}" class="inline-form">${csrfField(ctx)}
          <input type="hidden" name="reminder" value="${d.reminderId}"><input type="hidden" name="due" value="${d.dueAt.toISOString()}"><input type="hidden" name="taken" value="no">
          <span class="chip hr-status hr-ready">${icon.check}${ctx.t('med.taken')}</span>
          <button class="btn btn-ghost btn-sm" type="submit" aria-label="${ctx.t('med.undoLabel', { medicine: d.medicine })}">${ctx.t('med.undo')}</button></form>`
      : canTick
        ? html`<form method="post" action="${href(ctx, '/medicines/doses')}" class="inline-form">${csrfField(ctx)}
            <input type="hidden" name="reminder" value="${d.reminderId}"><input type="hidden" name="due" value="${d.dueAt.toISOString()}"><input type="hidden" name="taken" value="yes">
            <button class="btn ${late ? 'btn-primary' : 'btn-outline'} btn-sm" type="submit" aria-label="${ctx.t('med.takenLabel', { medicine: d.medicine })}">${ctx.t('med.markTaken')}</button></form>`
        : html`<span class="small muted">${ctx.t('med.later')}</span>`}
  </li>`;
}

export function medicinesPage(
  ctx: Ctx,
  o: { doses: Dose[]; reminders: MedicineReminder[]; phones: number; vapidKey: string; showNames: boolean; now: Date; notice?: Notice },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const today = todayIn(tz, o.now);
  const taken = o.doses.filter((d) => d.takenAt).length;
  const body = html`<div class="container page narrow stack-lg">
    <div class="stack-sm"><h1>${ctx.t('med.title')}</h1><p class="muted">${ctx.t('med.lead')}</p></div>
    ${o.notice ? alert(o.notice.kind, ctx.t(o.notice.key)) : ''}
    ${o.reminders.length
      ? html`<section class="panel stack" data-testid="today">
          <div class="row-between"><h2>${ctx.t('med.today')}</h2>
            ${o.doses.length ? html`<span class="small muted">${ctx.t('med.progress', { done: formatNumber(taken, ctx.locale), total: formatNumber(o.doses.length, ctx.locale) })}</span>` : ''}</div>
          ${o.doses.length ? html`<ul class="dose-list">${o.doses.map((d) => doseRow(ctx, d, o.now))}</ul>` : html`<p class="muted">${ctx.t('med.noneToday')}</p>`}
        </section>
        ${phonePanel(ctx, o)}
        <section class="panel stack">
          <div class="row-between"><h2>${ctx.t('med.mine')}</h2>
            <a class="btn btn-outline btn-sm" href="${href(ctx, '/medicines/calendar.ics')}" download>${icon.calendar}${ctx.t('med.addCalendar')}</a></div>
          <p class="hint">${ctx.t('med.calendarHint')}</p>
          <ul class="appt-list">${o.reminders.map(
            (r) => html`<li class="hr-card stack-sm" data-testid="reminder">
              <div class="row-between"><strong dir="auto">${r.item.medicine}</strong>
                ${r.item.dose ? html`<span class="small muted" dir="auto">${r.item.dose}</span>` : ''}</div>
              <span class="small">${icon.clock}${r.times.map((t) => timeLabel(ctx, t)).join(' · ')}${r.weekday !== null ? html` · ${ctx.t(`weekday.${r.weekday}` as MessageKey)}` : ''}</span>
              <span class="small muted">${r.endDate
                ? r.endDate < today ? ctx.t('med.ended') : ctx.t('med.until', { date: formatFullDate(new Date(`${r.endDate}T12:00:00Z`), ctx.locale, 'UTC') })
                : ctx.t('med.ongoing')} · ${ctx.t('hr.prescribedBy')} <bdi>${r.doctorName}</bdi></span>
              <div class="row-wrap">
                <a class="btn btn-ghost btn-sm" href="${href(ctx, `/medicines/setup/${r.prescriptionId}`)}">${ctx.t('med.change')}</a>
                <form method="post" action="${href(ctx, `/medicines/reminders/${r.id}/stop`)}" class="inline-form">${csrfField(ctx)}
                  <button class="btn btn-ghost btn-sm" type="submit">${ctx.t('med.stop')}</button></form>
              </div>
            </li>`,
          )}</ul>
        </section>`
      : html`<div class="empty stack-sm" data-testid="no-reminders"><p>${ctx.t('med.none')}</p>
          <div><a class="btn btn-primary" href="${href(ctx, '/health-record')}">${ctx.t('med.openPrescriptions')}</a></div></div>
        ${phonePanel(ctx, o)}`}
    <p class="small muted">${ctx.t('med.disclaimer')}</p>
  </div>`;
  return layout(ctx, { title: ctx.t('med.title'), body, noindex: true });
}

function itemFields(ctx: Ctx, it: SetupItem, first: boolean): SafeHtml {
  const p = it.position;
  const schedulable = suggestedTimes(it.frequency, it.timing) !== null;
  const head = html`<div class="stack-sm"><strong dir="auto">${it.medicine}</strong>
    <span class="small muted" dir="auto">${rxLineText(ctx, it)}</span>
    ${it.instructions ? html`<span class="small" dir="auto">${it.instructions}</span>` : ''}</div>`;
  if (!schedulable) {
    return html`<fieldset class="hr-card stack-sm"><legend class="sr-only">${it.medicine}</legend>${head}
      <p class="small muted">${ctx.t(it.frequency === 'as_needed' ? 'med.asNeeded' : it.frequency === null ? 'med.noFrequency' : 'med.singleDose')}</p></fieldset>`;
  }
  const times = it.times ?? ['09:00'];
  const slots = Math.min(MAX_TIMES, times.length + 1);
  const on = it.reminder !== null || first;
  return html`<fieldset class="hr-card stack" data-testid="setup-item"><legend class="sr-only">${it.medicine}</legend>
    <label class="check"><input type="checkbox" name="on_${p}" value="yes"${attrIf(on, 'checked')}> <span>${head}</span></label>
    <div class="stack-sm">
      <span class="label" id="t-${p}">${ctx.t('med.times')}</span>
      <div class="time-row" role="group" aria-labelledby="t-${p}">
        ${Array.from({ length: slots }, (_, i) => html`<input type="time" name="times_${p}" value="${times[i] ?? ''}" aria-label="${ctx.t('med.timeN', { n: formatNumber(i + 1, ctx.locale) })}">`)}
      </div>
      <p class="hint">${ctx.t(it.reminder ? 'med.timesOwn' : 'med.timesSuggested')}</p>
    </div>
    ${it.frequency === 'weekly'
      ? html`<div class="field"><label for="wd-${p}">${ctx.t('med.weekday')}</label>
          <select id="wd-${p}" name="weekday_${p}">${[0, 1, 2, 3, 4, 5, 6].map((d) => html`<option value="${d}"${attrIf(it.weekday === d, 'selected')}>${ctx.t(`weekday.${d}` as MessageKey)}</option>`)}</select></div>`
      : ''}
    <div class="row-wrap">
      <div class="field days-field"><label for="d-${p}">${ctx.t('med.days')}</label>
        <input id="d-${p}" type="number" name="days_${p}" min="1" max="${MAX_DAYS}" inputmode="numeric" value="${it.days ?? ''}"></div>
      <label class="check"><input type="checkbox" name="ongoing_${p}" value="yes"${attrIf(it.days === null, 'checked')}> <span>${ctx.t('med.untilStop')}</span></label>
    </div>
  </fieldset>`;
}

export function setupPage(ctx: Ctx, rx: RxForSetup, error?: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const firstTime = rx.items.every((i) => !i.reminder);
  const body = html`<div class="container page narrow stack-lg">
    <a href="${href(ctx, '/medicines')}">← ${ctx.t('med.title')}</a>
    <div class="stack-sm"><h1>${ctx.t('med.setupTitle')}</h1>
      <p class="muted">${ctx.t('med.setupLead', { doctor: rx.doctorName, date: formatFullDate(rx.issuedAt, ctx.locale, tz) })}</p></div>
    ${error ? alert('error', ctx.t(error)) : ''}
    <form method="post" action="${href(ctx, `/medicines/setup/${rx.id}`)}" class="stack" novalidate>${csrfField(ctx)}
      ${rx.items.map((it) => itemFields(ctx, it, firstTime))}
      <p class="small muted">${ctx.t('med.setupNote')}</p>
      <div><button class="btn btn-primary btn-lg" type="submit">${icon.bell}${ctx.t('med.save')}</button></div>
    </form>
  </div>`;
  return layout(ctx, { title: ctx.t('med.setupTitle'), body, noindex: true });
}
