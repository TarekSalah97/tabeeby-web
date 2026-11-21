import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { normalizeDigits } from '../domain/phone.js';
import { addDays, zonedToUtc } from '../domain/time.js';
import { audit } from './audit.js';
import { DomainError, notFound } from '../http/errors.js';

export const PAYMENT_METHODS = ['cash', 'card', 'instapay', 'wallet', 'insurance', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const isPaymentMethod = (m: string): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m);

/** Visits whose payment can be recorded: not cancelled and not a no-show. */
const PAYABLE = ['confirmed', 'arrived', 'in_consultation', 'completed'];

export interface PaymentInput {
  method: string;
  /** '' = the visit's price. */
  amount: string;
  note: string;
}

/** The clinic records that a visit was paid (at the clinic). One live payment per visit. */
export async function recordPayment(deps: Deps, doctor: SessionUser, appointmentId: string, input: PaymentInput, ip: string): Promise<string> {
  if (doctor.role !== 'doctor') throw notFound();
  if (!isPaymentMethod(input.method)) throw new DomainError('pay.methodInvalid');
  const note = input.note.trim().slice(0, 200);
  try {
    return await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string; fee_egp: number }>(
        'select id, status, fee_egp from appointments where id = $1 and doctor_id = $2 for update',
        [appointmentId, doctor.id],
      );
      const a = rows[0];
      if (!a) throw notFound(); // also hides other doctors' visits
      if (!PAYABLE.includes(a.status)) throw new DomainError('pay.notPayable');
      const digits = normalizeDigits(input.amount).replace(/[,\s]/g, '');
      const amount = digits === '' ? a.fee_egp : /^\d{1,6}$/.test(digits) ? Number(digits) : NaN;
      if (!Number.isInteger(amount) || amount < 0 || amount > 100000) throw new DomainError('pay.amountInvalid');
      const ins = await tx.query<{ id: string }>(
        `insert into payments (appointment_id, doctor_id, amount_egp, method, note, recorded_by) values ($1, $2, $3, $4, $5, $2) returning id`,
        [a.id, doctor.id, amount, input.method, note || null],
      );
      const id = ins.rows[0]!.id;
      await audit(tx, { actorId: doctor.id, action: 'payment.record', entityType: 'payment', entityId: id, metadata: { appointmentId: a.id, amount, method: input.method }, ip });
      return id;
    });
  } catch (e) {
    if (isUniqueViolation(e, 'payments_one_paid_idx')) throw new DomainError('pay.alreadyPaid');
    throw e;
  }
}

/** Refunds are marked, never deleted, and need a reason. */
export async function refundPayment(deps: Deps, doctor: SessionUser, paymentId: string, rawReason: string, ip: string): Promise<void> {
  const reason = rawReason.trim();
  if (reason.length < 3) throw new DomainError('pay.reasonRequired');
  await deps.db.transaction(async (tx) => {
    const r = await tx.query<{ id: string; amount_egp: number }>(
      `update payments set status = 'refunded', refunded_at = now(), refund_reason = $3
        where id = $1 and doctor_id = $2 and status = 'paid' returning id, amount_egp`,
      [paymentId, doctor.id, reason.slice(0, 300)],
    );
    if (!r.rows[0]) throw notFound();
    await audit(tx, { actorId: doctor.id, action: 'payment.refund', entityType: 'payment', entityId: paymentId, metadata: { amount: r.rows[0].amount_egp, reason }, ip });
  });
}

/** Live payments for a set of visits (to show "Paid" next to each one). */
export async function paymentsFor(db: Queryable, appointmentIds: string[]): Promise<Map<string, { id: string; amount: number; method: PaymentMethod }>> {
  if (!appointmentIds.length) return new Map();
  const { rows } = await db.query<{ id: string; appointment_id: string; amount_egp: number; method: PaymentMethod }>(
    `select id, appointment_id, amount_egp, method from payments where appointment_id = any($1::uuid[]) and status = 'paid'`,
    [appointmentIds],
  );
  return new Map(rows.map((r) => [r.appointment_id, { id: r.id, amount: r.amount_egp, method: r.method }]));
}

// ---------------------------------------------------------------------------
// Income report
// ---------------------------------------------------------------------------

export interface IncomeRow {
  id: string;
  appointment_id: string;
  paid_at: Date;
  amount_egp: number;
  method: PaymentMethod;
  status: 'paid' | 'refunded';
  refund_reason: string | null;
  note: string | null;
  patient_name: string;
  visit_at: Date;
  clinic_name: string;
}

export interface UnpaidVisit {
  id: string;
  starts_at: Date;
  patient_name: string;
  fee_egp: number;
  clinic_name: string;
}

export interface IncomeReport {
  from: string;
  to: string;
  total: number;
  refunded: number;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  rows: IncomeRow[];
  unpaid: UnpaidVisit[];
}

/** Payments received between two local dates (inclusive), plus finished visits in the range not paid yet. */
export async function incomeReport(db: Queryable, doctorId: string, from: string, to: string, tz: string): Promise<IncomeReport> {
  const start = zonedToUtc(from, '00:00', tz);
  const end = zonedToUtc(addDays(to, 1), '00:00', tz);
  const [rows, unpaid] = await Promise.all([
    db.query<IncomeRow>(
      `select p.id, p.appointment_id, p.paid_at, p.amount_egp, p.method, p.status, p.refund_reason, p.note,
              coalesce(u.full_name, a.walk_in_name) as patient_name, a.starts_at as visit_at, c.name as clinic_name
         from payments p join appointments a on a.id = p.appointment_id left join users u on u.id = a.patient_id
         join clinics c on c.id = a.clinic_id
        where p.doctor_id = $1 and p.paid_at >= $2 and p.paid_at < $3
        order by p.paid_at desc limit 2000`,
      [doctorId, start, end],
    ),
    db.query<UnpaidVisit>(
      `select a.id, a.starts_at, coalesce(u.full_name, a.walk_in_name) as patient_name, a.fee_egp, c.name as clinic_name
         from appointments a left join users u on u.id = a.patient_id join clinics c on c.id = a.clinic_id
        where a.doctor_id = $1 and a.status = 'completed' and a.starts_at >= $2 and a.starts_at < $3
          and not exists (select 1 from payments p where p.appointment_id = a.id and p.status = 'paid')
        order by a.starts_at desc limit 200`,
      [doctorId, start, end],
    ),
  ]);
  const paid = rows.rows.filter((r) => r.status === 'paid');
  const byMethod = PAYMENT_METHODS.map((method) => {
    const own = paid.filter((r) => r.method === method);
    return { method, amount: own.reduce((s, r) => s + r.amount_egp, 0), count: own.length };
  }).filter((m) => m.count > 0);
  return {
    from,
    to,
    total: paid.reduce((s, r) => s + r.amount_egp, 0),
    refunded: rows.rows.filter((r) => r.status === 'refunded').reduce((s, r) => s + r.amount_egp, 0),
    byMethod,
    rows: rows.rows,
    unpaid: unpaid.rows,
  };
}

/**
 * Spreadsheet-safe CSV: every cell is quoted, and cells that a spreadsheet would run as a formula
 * (starting with = + - @ or a tab) are prefixed with an apostrophe (CSV injection).
 */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  // BOM so Excel opens Arabic text correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface Receipt {
  id: string;
  amount_egp: number;
  method: PaymentMethod;
  status: 'paid' | 'refunded';
  paid_at: Date;
  refunded_at: Date | null;
  patient_name: string;
  visit_at: Date;
  visit_type: 'new' | 'follow_up';
  doctor_name: string;
  clinic_name: string;
  clinic_address: string;
}

/** A receipt for the patient on the visit or for the doctor who was paid; anyone else gets "not found". */
export async function getReceipt(db: Queryable, viewer: SessionUser, appointmentId: string): Promise<Receipt> {
  const scope = viewer.role === 'patient' ? 'a.patient_id' : viewer.role === 'doctor' ? 'a.doctor_id' : null;
  if (!scope) throw notFound();
  const { rows } = await db.query<Receipt>(
    `select p.id, p.amount_egp, p.method, p.status, p.paid_at, p.refunded_at, coalesce(pu.full_name, a.walk_in_name) as patient_name,
            a.starts_at as visit_at, a.visit_type, du.full_name as doctor_name, c.name as clinic_name, c.address as clinic_address
       from payments p join appointments a on a.id = p.appointment_id left join users pu on pu.id = a.patient_id
       join users du on du.id = a.doctor_id join clinics c on c.id = a.clinic_id
      where a.id = $1 and ${scope} = $2
      order by (p.status = 'paid') desc, p.paid_at desc limit 1`,
    [appointmentId, viewer.id],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}
