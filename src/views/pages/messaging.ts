import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, icon, input } from '../components.js';
import { formatDateTime, type MessageKey } from '../../i18n/index.js';
import { formatEgyptMobile } from '../../domain/phone.js';
import type { FieldErrors } from '../../services/accounts.js';
import type { OwnDoctor } from '../../services/doctors.js';
import { MAX_MESSAGE_LENGTH, type ConversationSummary, type DoctorMessaging, type DoctorThread, type Message, type PatientThread } from '../../services/messaging.js';
import { shell } from './dashboard.js';

const WEEKDAYS: MessageKey[] = ['weekday.0', 'weekday.1', 'weekday.2', 'weekday.3', 'weekday.4', 'weekday.5', 'weekday.6'];

/** "Sun–Thu, 10:00–20:00" style summary of when patients can write. */
export function hoursSummary(ctx: Ctx, h: DoctorMessaging): string {
  const days = h.days.map((d) => ctx.t(WEEKDAYS[d]!)).join(ctx.locale === 'ar' ? '، ' : ', ');
  // Times are wrapped left-to-right so "10:00–20:00" does not flip in Arabic.
  return ctx.t('msg.hoursSummary', { days, start: `\u2066${h.start}`, end: `${h.end}\u2069` });
}

function bubbles(ctx: Ctx, messages: Message[], mine: 'patient' | 'doctor'): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  if (!messages.length) return html`<p class="empty">${ctx.t('msg.noMessagesYet')}</p>`;
  return html`<ol class="thread" aria-label="${ctx.t('msg.conversation')}">${messages.map(
    (m) => html`<li class="bubble ${m.sender === mine ? 'mine' : 'theirs'}">
      <span class="sr-only">${ctx.t(m.sender === mine ? 'msg.you' : m.sender === 'doctor' ? 'msg.doctorSaid' : 'msg.patientSaid')}</span>
      <p dir="auto">${m.body}</p>
      <time datetime="${m.created_at.toISOString()}">${formatDateTime(m.created_at, ctx.locale, tz)}</time>
    </li>`,
  )}</ol>`;
}

function composer(ctx: Ctx, action: string, o: { disabled?: boolean; value?: string; error?: MessageKey; hint?: string }): SafeHtml {
  return html`<form method="post" action="${action}" class="composer stack-sm">
    ${csrfField(ctx)}
    ${o.error ? html`<p class="field-error" id="body-error" role="alert">${ctx.t(o.error)}</p>` : ''}
    <label class="sr-only" for="body">${ctx.t('msg.write')}</label>
    <textarea id="body" name="body" rows="3" maxlength="${MAX_MESSAGE_LENGTH}" required placeholder="${ctx.t('msg.write')}"${attrIf(!!o.disabled, 'disabled')}${attrIf(!!o.error, 'aria-describedby="body-error" aria-invalid="true"')}>${o.value ?? ''}</textarea>
    <div class="row-between"><span class="hint">${o.hint ?? ctx.t('msg.privacyHint')}</span>
      <button class="btn btn-primary" type="submit"${attrIf(!!o.disabled, 'disabled')}>${ctx.t('msg.send')}</button></div>
  </form>`;
}

function inboxList(ctx: Ctx, list: ConversationSummary[], linkOf: (c: ConversationSummary) => string, emptyKey: MessageKey): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  if (!list.length) return html`<p class="empty">${ctx.t(emptyKey)}</p>`;
  return html`<ul class="inbox">${list.map(
    (c) => html`<li><a class="inbox-row${c.unread ? ' unread' : ''}" href="${linkOf(c)}">
      <span class="stack-sm"><strong dir="auto">${c.other_name}</strong><span class="muted small preview" dir="auto">${c.last_sender ? html`${c.preview}` : ''}</span></span>
      <span class="inbox-meta"><span class="muted small">${formatDateTime(c.last_message_at, ctx.locale, tz)}</span>
        ${c.unread ? html`<span class="chip status-confirmed">${ctx.t('msg.new')}</span>` : ''}${c.blocked ? html`<span class="chip status-cancelled">${ctx.t('msg.blockedChip')}</span>` : ''}</span>
    </a></li>`,
  )}</ul>`;
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

export function patientInboxPage(ctx: Ctx, list: ConversationSummary[]): SafeHtml {
  const body = html`<div class="container page narrow stack-lg">
    <div><h1>${ctx.t('msg.title')}</h1><p class="muted">${ctx.t('msg.patientLead')}</p></div>
    <section class="panel flush">${inboxList(ctx, list, (c) => href(ctx, `/messages/${c.other_slug}`), 'msg.patientEmpty')}</section>
  </div>`;
  return layout(ctx, { title: `${ctx.t('msg.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

export function patientThreadPage(ctx: Ctx, t: PatientThread, o: { value?: string; error?: MessageKey; sent?: boolean } = {}): SafeHtml {
  const reason: MessageKey | null = t.blocked ? 'msg.blocked' : !t.doctor.enabled ? 'msg.notEnabled' : !t.eligible ? 'msg.notEligible' : !t.openNow ? 'msg.closedNow' : null;
  const body = html`<div class="container page narrow stack-lg">
    <div class="stack-sm">
      <a class="back-link" href="${href(ctx, '/messages')}">${icon.chevronStart}${ctx.t('msg.title')}</a>
      <h1>${ctx.t('msg.withDoctor', { name: t.doctor.name })}</h1>
      <p class="muted">${t.doctor.enabled ? hoursSummary(ctx, t.doctor) : ''}</p>
    </div>
    ${o.sent ? alert('success', ctx.t('msg.sentDone')) : ''}
    ${alert('info', ctx.t('msg.notForEmergencies'))}
    <section class="panel stack">
      ${bubbles(ctx, t.messages, 'patient')}
      ${reason && !o.error
        ? alert(reason === 'msg.closedNow' ? 'info' : 'warning', reason === 'msg.closedNow' ? ctx.t('msg.closedNowWhen', { hours: hoursSummary(ctx, t.doctor) }) : ctx.t(reason))
        : ''}
      ${composer(ctx, href(ctx, `/messages/${t.doctor.slug}`), { disabled: !!reason && !o.error, value: o.value, error: o.error })}
      <p class="hint"><a href="${href(ctx, `/doctors/${t.doctor.slug}`)}">${ctx.t('msg.bookInstead')}</a></p>
    </section>
  </div>`;
  return layout(ctx, { title: `${ctx.t('msg.title')} — ${ctx.t('brand')}`, body, noindex: true });
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export function doctorInboxPage(
  ctx: Ctx,
  doctor: OwnDoctor,
  list: ConversationSummary[],
  settings: DoctorMessaging,
  o: { errors?: FieldErrors; values?: { enabled: boolean; days: number[]; start: string; end: string }; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const v = o.values ?? settings;
  const content = html`
    <div><h1>${ctx.t('msg.title')}</h1><p class="muted">${ctx.t('msg.doctorLead')}</p></div>
    <form method="post" action="${href(ctx, '/dashboard/messages/toggle')}" class="msg-switch ${settings.enabled ? 'is-on' : 'is-off'}">
      ${csrfField(ctx)}
      <input type="hidden" name="enabled" value="${settings.enabled ? 'no' : 'yes'}">
      <div class="stack-sm">
        <strong class="msg-switch-state">${ctx.t(settings.enabled ? 'msgset.switchOn' : 'msgset.switchOff')}</strong>
        <span class="small muted">${ctx.t(settings.enabled ? 'msgset.switchOnHint' : 'msgset.switchOffHint')}</span>
      </div>
      <button class="switch" type="submit" role="switch" aria-checked="${settings.enabled ? 'true' : 'false'}" aria-label="${ctx.t('msgset.switchLabel')}">
        <span class="switch-knob" aria-hidden="true"></span>
        <span class="switch-text">${ctx.t(settings.enabled ? 'msgset.on' : 'msgset.off')}</span>
      </button>
    </form>
    <section class="panel flush">${inboxList(ctx, list, (c) => href(ctx, `/dashboard/messages/${c.id}`), settings.enabled ? 'msg.doctorEmpty' : 'msg.doctorEmptyOff')}</section>
    <details class="panel"${attrIf(!!o.errors, 'open')}>
      <summary class="h3">${ctx.t('msgset.hoursTitle')}</summary>
      <form method="post" action="${href(ctx, '/dashboard/messages/settings')}" class="stack" novalidate>
        ${csrfField(ctx)}
        <p class="muted">${ctx.t('msgset.lead')}</p>
        <input type="hidden" name="enabled" value="${v.enabled ? 'yes' : 'no'}">
        <fieldset class="stack-sm"><legend class="label">${ctx.t('msgset.days')}</legend>
          ${o.errors?.['days'] ? html`<p class="field-error">${ctx.t(o.errors['days'])}</p>` : ''}
          <div class="row-wrap">${[0, 1, 2, 3, 4, 5, 6].map(
            (d) => html`<label class="check day-check"><input type="checkbox" name="days" value="${d}"${attrIf(v.days.includes(d), 'checked')}><span>${ctx.t(WEEKDAYS[d]!)}</span></label>`,
          )}</div>
        </fieldset>
        <div class="form-grid">
          ${input(ctx, { name: 'start', label: ctx.t('msgset.from'), type: 'time', value: v.start, errors: o.errors, required: true })}
          ${input(ctx, { name: 'end', label: ctx.t('msgset.to'), type: 'time', value: v.end, errors: o.errors, required: true })}
        </div>
        <p class="hint">${ctx.t('msgset.hint')}</p>
        <div><button class="btn btn-primary" type="submit">${ctx.t('common.save')}</button></div>
      </form>
    </details>`;
  return shell(ctx, doctor, 'messages', content, o.notice);
}

export function doctorThreadPage(ctx: Ctx, doctor: OwnDoctor, t: DoctorThread, o: { value?: string; error?: MessageKey; notice?: { kind: 'success' | 'error'; key: MessageKey } } = {}): SafeHtml {
  const content = html`
    <div class="stack-sm">
      <a class="back-link" href="${href(ctx, '/dashboard/messages')}">${icon.chevronStart}${ctx.t('msg.title')}</a>
      <div class="row-between">
        <div><h1 dir="auto">${t.patientName}</h1><a class="muted" dir="ltr" href="tel:${t.patientPhone}">${formatEgyptMobile(t.patientPhone)}</a></div>
        <form method="post" action="${href(ctx, `/dashboard/messages/${t.id}/${t.blocked ? 'unblock' : 'block'}`)}">${csrfField(ctx)}
          <button class="btn btn-outline btn-sm${t.blocked ? '' : ' danger'}" type="submit">${ctx.t(t.blocked ? 'msg.unblock' : 'msg.block')}</button></form>
      </div>
    </div>
    ${t.blocked ? alert('warning', ctx.t('msg.blockedDoctorSide')) : ''}
    <section class="panel stack">
      ${bubbles(ctx, t.messages, 'doctor')}
      ${composer(ctx, href(ctx, `/dashboard/messages/${t.id}`), { value: o.value, error: o.error, hint: ctx.t('msg.doctorHint') })}
    </section>`;
  return shell(ctx, doctor, 'messages', content, o.notice);
}
