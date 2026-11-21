import { html, attrIf, type SafeHtml } from '../html.js';
import type { Ctx } from '../../http/context.js';
import { href } from '../../http/context.js';
import { layout } from '../layout.js';
import { alert, csrfField, visitLabel } from '../components.js';
import { formatDateTime, formatFullDateTime, formatNumber, type MessageKey } from '../../i18n/index.js';
import { addDays } from '../../domain/time.js';
import type { OwnDoctor } from '../../services/doctors.js';
import { PAYMENT_METHODS, type IncomeReport, type PaymentMethod, type Receipt } from '../../services/payments.js';
import { shell } from './dashboard.js';
import { money } from './public.js';

export const methodLabel = (ctx: Ctx, m: PaymentMethod) => ctx.t(`pay.method.${m}` as MessageKey);

/** "Paid · 400 EGP · Cash" with a receipt link. */
export function paidChip(ctx: Ctx, p: { amount: number; method: PaymentMethod }, receiptHref: string): SafeHtml {
  return html`<span class="row-wrap tight"><span class="chip status-confirmed">${ctx.t('pay.paid')} · ${money(ctx, p.amount)} · ${methodLabel(ctx, p.method)}</span>
    <a class="small" href="${receiptHref}">${ctx.t('pay.receipt')}</a></span>`;
}

/** Compact "Mark paid" form: method (cash first) and an optional amount (empty = the visit price). */
export function markPaidForm(ctx: Ctx, appointmentId: string, fee: number, back: Record<string, string>, opts: { big?: boolean } = {}): SafeHtml {
  return html`<form method="post" action="${href(ctx, `/dashboard/appointments/${appointmentId}/pay`)}" class="pay-form">
    ${csrfField(ctx)}
    ${Object.entries(back).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <label class="sr-only" for="m-${appointmentId}">${ctx.t('pay.method')}</label>
    <select id="m-${appointmentId}" name="method">${PAYMENT_METHODS.map((m) => html`<option value="${m}">${methodLabel(ctx, m)}</option>`)}</select>
    <label class="sr-only" for="a-${appointmentId}">${ctx.t('pay.amount')}</label>
    <input id="a-${appointmentId}" name="amount" inputmode="numeric" placeholder="${String(fee)}" class="pay-amount">
    <button type="submit" class="btn ${opts.big ? 'btn-primary' : 'btn-outline btn-sm'}">${ctx.t('pay.markPaid')}</button>
  </form>`;
}

export function incomePage(
  ctx: Ctx,
  doctor: OwnDoctor,
  r: IncomeReport,
  o: { today: string; notice?: { kind: 'success' | 'error'; key: MessageKey } },
): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const monthStart = `${o.today.slice(0, 7)}-01`;
  const presets: { label: MessageKey; from: string; to: string }[] = [
    { label: 'common.today', from: o.today, to: o.today },
    { label: 'adm.range.7d', from: addDays(o.today, -6), to: o.today },
    { label: 'adm.range.month', from: monthStart, to: o.today },
  ];
  const back = { from: r.from, to: r.to, back: 'income' };
  const content = html`
    <div class="row-between">
      <div><h1>${ctx.t('pay.incomeTitle')}</h1><p class="muted">${ctx.t('pay.incomeLead')}</p></div>
      <a class="btn btn-outline" href="${href(ctx, '/dashboard/income.csv', { from: r.from, to: r.to })}" download>${ctx.t('pay.downloadCsv')}</a>
    </div>
    <section class="panel stack-sm">
      <div class="row-wrap">${presets.map(
        (p) => html`<a class="chip-link" href="${href(ctx, '/dashboard/income', { from: p.from, to: p.to })}"${attrIf(p.from === r.from && p.to === r.to, 'aria-current="true"')}>${ctx.t(p.label)}</a>`,
      )}</div>
      <form method="get" action="${href(ctx, '/dashboard/income')}" class="cbook-day">
        <div class="field"><label for="from">${ctx.t('adm.from')}</label><input id="from" type="date" name="from" value="${r.from}" required></div>
        <div class="field"><label for="to">${ctx.t('adm.to')}</label><input id="to" type="date" name="to" value="${r.to}" required></div>
        <div class="field"><button class="btn btn-outline" type="submit">${ctx.t('adm.apply')}</button></div>
      </form>
    </section>
    <div class="kpis">
      <div class="kpi"><span>${ctx.t('pay.total')}</span><strong>${money(ctx, r.total)}</strong></div>
      ${r.byMethod.map((m) => html`<div class="kpi"><span>${methodLabel(ctx, m.method)} (${formatNumber(m.count, ctx.locale)})</span><strong>${money(ctx, m.amount)}</strong></div>`)}
      ${r.refunded ? html`<div class="kpi"><span>${ctx.t('pay.refundedTotal')}</span><strong>${money(ctx, r.refunded)}</strong></div>` : ''}
    </div>
    ${r.unpaid.length
      ? html`<section class="panel stack"><h2 class="h3">${ctx.t('pay.unpaidTitle', { n: formatNumber(r.unpaid.length, ctx.locale) })}</h2>
          <p class="muted small">${ctx.t('pay.unpaidLead')}</p>
          <ul class="appt-list">${r.unpaid.map(
            (u) => html`<li class="appt-row"><div class="stack-sm"><strong dir="auto">${u.patient_name}</strong>
                <span class="muted small">${formatDateTime(u.starts_at, ctx.locale, tz)} · ${u.clinic_name} · ${money(ctx, u.fee_egp)}</span></div>
              ${markPaidForm(ctx, u.id, u.fee_egp, back)}</li>`,
          )}</ul></section>`
      : ''}
    <section class="panel flush">
      <div class="panel-head"><h2 class="h3">${ctx.t('pay.listTitle')}</h2></div>
      ${r.rows.length
        ? html`<ul class="appt-list padded">${r.rows.map(
            (p) => html`<li class="appt-row${p.status === 'refunded' ? ' muted-row' : ''}"><div class="stack-sm">
                <strong>${money(ctx, p.amount_egp)} · ${methodLabel(ctx, p.method)}${p.status === 'refunded' ? html` <span class="chip status-cancelled">${ctx.t('pay.refunded')}</span>` : ''}</strong>
                <span class="muted small"><bdi>${p.patient_name}</bdi> · ${ctx.t('pay.visit')} ${formatDateTime(p.visit_at, ctx.locale, tz)} · ${ctx.t('pay.paidAt')} ${formatDateTime(p.paid_at, ctx.locale, tz)}</span>
                ${p.refund_reason ? html`<span class="muted small">${ctx.t('pay.refundReason')}: <bdi>${p.refund_reason}</bdi></span>` : ''}
              </div>
              <div class="stack-sm align-end">
                <a class="btn btn-ghost btn-sm" href="${href(ctx, `/dashboard/appointments/${p.appointment_id}/receipt`)}">${ctx.t('pay.receipt')}</a>
                ${p.status === 'paid'
                  ? html`<details class="refund"><summary class="btn btn-ghost btn-sm danger">${ctx.t('pay.refund')}</summary>
                      <form method="post" action="${href(ctx, `/dashboard/payments/${p.id}/refund`)}" class="stack-sm">${csrfField(ctx)}
                        <input type="hidden" name="from" value="${r.from}"><input type="hidden" name="to" value="${r.to}">
                        <label for="reason-${p.id}">${ctx.t('pay.refundReason')}</label>
                        <input id="reason-${p.id}" name="reason" maxlength="300" required>
                        <button type="submit" class="btn btn-outline btn-sm danger">${ctx.t('pay.confirmRefund')}</button></form></details>`
                  : ''}
              </div></li>`,
          )}</ul>`
        : html`<p class="empty">${ctx.t('pay.none')}</p>`}
    </section>
    <p class="hint">${ctx.t('pay.onlineLater')}</p>`;
  return shell(ctx, doctor, 'income', content, o.notice);
}

export function receiptPage(ctx: Ctx, r: Receipt, back: string): SafeHtml {
  const tz = ctx.deps.cfg.TIME_ZONE;
  const body = html`<div class="container page narrow stack">
    <div class="row-between no-print">
      <a class="back-link" href="${back}">${ctx.t('common.back')}</a>
      <button type="button" class="btn btn-primary" data-print hidden>${ctx.t('rx.print')}</button>
    </div>
    <article class="panel receipt stack">
      <div class="row-between"><h1>${ctx.t('pay.receiptTitle')}</h1><span class="muted small" dir="ltr">#${r.id.slice(0, 8).toUpperCase()}</span></div>
      ${r.status === 'refunded' ? alert('warning', ctx.t('pay.receiptRefunded', { when: formatDateTime(r.refunded_at!, ctx.locale, tz) })) : ''}
      <dl class="summary">
        <div><dt>${ctx.t('pay.receiptPatient')}</dt><dd><bdi>${r.patient_name}</bdi></dd></div>
        <div><dt>${ctx.t('book.with')}</dt><dd><bdi>${r.doctor_name}</bdi></dd></div>
        <div><dt>${ctx.t('book.where')}</dt><dd>${r.clinic_name}<br><span class="muted">${r.clinic_address}</span></dd></div>
        <div><dt>${ctx.t('pay.visit')}</dt><dd>${formatFullDateTime(r.visit_at, ctx.locale, tz)} · <bdi>${visitLabel(ctx, r)}</bdi></dd></div>
        <div><dt>${ctx.t('pay.method')}</dt><dd>${methodLabel(ctx, r.method)}</dd></div>
        <div><dt>${ctx.t('pay.paidAt')}</dt><dd>${formatFullDateTime(r.paid_at, ctx.locale, tz)}</dd></div>
        <div class="receipt-total"><dt>${ctx.t('pay.amount')}</dt><dd><strong>${money(ctx, r.amount_egp)}</strong></dd></div>
      </dl>
      <p class="hint">${ctx.t('pay.receiptNote')}</p>
    </article>
  </div>`;
  return layout(ctx, { title: `${ctx.t('pay.receiptTitle')} — ${ctx.t('brand')}`, body, variant: 'app', noindex: true });
}
