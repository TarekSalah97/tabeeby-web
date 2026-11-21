import { html, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { icon } from '../components.js';
import { formatDate, formatTime, type MessageKey } from '../../i18n/index.js';
import type { LiveVisit } from '../../services/queue.js';
import type { QueueStage } from '../../domain/queueEstimate.js';

/** Seconds between automatic refreshes of the live tracker. */
export const QUEUE_REFRESH_SECONDS = 60;

const STEPS: { stage: QueueStage; key: MessageKey }[] = [
  { stage: 'booked', key: 'queue.step.booked' },
  { stage: 'arrived', key: 'queue.step.arrived' },
  { stage: 'next', key: 'queue.step.next' },
  { stage: 'with_doctor', key: 'queue.step.withDoctor' },
];
const ORDER: QueueStage[] = ['booked', 'arrived', 'next', 'with_doctor', 'done'];

/** LTR-isolated text so numbers and times read correctly inside Arabic sentences. */
const iso = (s: string) => `⁦${s}⁩`;
/** First-strong isolate for formatted times: Arabic times stay right-to-left, English ones left-to-right. */
const fsi = (s: string) => `\u2068${s}\u2069`;

function headline(ctx: Ctx, v: LiveVisit): SafeHtml {
  const e = v.estimate;
  if (!v.isToday) return html`<p class="queue-big">${ctx.t('queue.notToday')}</p>`;
  if (!e || e.stage === 'closed') return html`<p class="queue-big">${ctx.t('queue.closed')}</p>`;
  if (e.stage === 'done') return html`<p class="queue-big">${ctx.t('queue.done')}</p>`;
  if (e.stage === 'with_doctor') return html`<p class="queue-big">${ctx.t('queue.withDoctorNow')}</p>`;
  if (e.waitMin === 0) return html`<p class="queue-big">${ctx.t('queue.anyMinute')}</p>`;
  return html`<p class="queue-big"><span class="queue-mins">${iso(`${e.waitMin}–${e.waitMax}`)}</span> ${ctx.t('queue.min')}</p>`;
}

function steps(ctx: Ctx, stage: QueueStage): SafeHtml {
  const at = ORDER.indexOf(stage);
  return html`<ol class="queue-steps">${STEPS.map((s) => {
    const i = ORDER.indexOf(s.stage);
    const cls = i < at ? 'done' : i === at ? 'current' : '';
    return html`<li class="${cls}"${i === at ? html` aria-current="step"` : ''}><span class="queue-dot" aria-hidden="true"></span>${ctx.t(s.key)}</li>`;
  })}</ol>`;
}

/** The Talabat-style card: big minutes, expected time, steps, people ahead. */
export function queueCard(ctx: Ctx, v: LiveVisit, o: { full?: boolean } = {}): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const e = v.estimate;
  const waiting = v.isToday && e && (e.stage === 'booked' || e.stage === 'arrived' || e.stage === 'next');
  return html`<section class="queue-card" aria-live="polite" data-testid="queue-card">
    <div class="queue-head">
      <span class="queue-kicker">${icon.clock}${ctx.t('queue.kicker')}</span>
      <span class="muted small" dir="auto"><strong>${v.doctorName}</strong> · ${v.clinicName}</span>
    </div>
    ${headline(ctx, v)}
    ${waiting && e?.expectedAt
      ? html`<p class="queue-sub">${ctx.t('queue.expectedAround', { time: fsi(formatTime(e.expectedAt, ctx.locale, tz)) })} · ${ctx.t('queue.bookedFor', { time: fsi(formatTime(v.startsAt, ctx.locale, tz)) })}</p>`
      : !v.isToday
        ? html`<p class="queue-sub">${formatDate(v.startsAt, ctx.locale, tz)} · ${fsi(formatTime(v.startsAt, ctx.locale, tz))}</p>`
        : ''}
    ${v.isToday && e && e.stage !== 'closed' && e.stage !== 'done' ? steps(ctx, e.stage) : ''}
    ${waiting && e
      ? html`<ul class="queue-facts">
          <li><strong>${iso(String(e.ahead))}</strong> ${ctx.t(e.ahead === 1 ? 'queue.aheadOne' : 'queue.ahead')}</li>
          ${e.delayMinutes >= 10 ? html`<li class="queue-late">${ctx.t('queue.runningLate', { n: iso(String(e.delayMinutes)) })}</li>` : html`<li>${ctx.t('queue.onTime')}</li>`}
          <li class="muted">${ctx.t(e.paceFromToday ? 'queue.basisToday' : 'queue.basisSlot', { n: iso(String(e.visitMinutes)) })}</li>
        </ul>`
      : ''}
    ${o.full
      ? html`<p class="small muted">${ctx.t('queue.disclaimer')}</p>
          <div class="appt-actions">
            ${v.clinicPhone ? html`<a class="btn btn-outline" href="tel:${v.clinicPhone}">${icon.phone}${ctx.t('doctor.call')}</a>` : ''}
            <a class="btn btn-ghost" href="${href(ctx, '/appointments')}">${ctx.t('queue.back')}</a>
          </div>`
      : html`<a class="btn btn-primary btn-sm" href="${href(ctx, `/appointments/${v.id}/wait`)}">${ctx.t('queue.trackLive')}</a>`}
  </section>`;
}

export function queuePage(ctx: Ctx, v: LiveVisit): SafeHtml {
  const live = v.isToday && v.estimate && v.estimate.stage !== 'done' && v.estimate.stage !== 'closed';
  return layout(ctx, {
    title: `${ctx.t('queue.title')} · ${ctx.t('brand')}`,
    noindex: true,
    body: html`<div class="container page narrow stack-lg"${live ? html` data-autorefresh="${QUEUE_REFRESH_SECONDS}"` : ''}>
      <h1>${ctx.t('queue.title')}</h1>
      ${queueCard(ctx, v, { full: true })}
      ${live ? html`<p class="small muted">${ctx.t('queue.autoRefresh')}</p>` : ''}
    </div>`,
  });
}
