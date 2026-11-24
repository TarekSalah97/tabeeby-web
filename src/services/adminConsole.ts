import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { addDays, isValidDate, todayIn, zonedToUtc } from '../domain/time.js';
import { audit } from './audit.js';
import { DomainError, notFound } from '../http/errors.js';

// ---------------------------------------------------------------------------
// Date range (Cairo days, inclusive) used by the dashboard and the audit log
// ---------------------------------------------------------------------------

export type RangePreset = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom';

export interface DayRange {
  preset: RangePreset;
  /** Inclusive Cairo dates, YYYY-MM-DD; absent means open-ended. */
  from?: string;
  to?: string;
}

export function parseRange(q: URLSearchParams, tz: string, now: Date): DayRange {
  const today = todayIn(tz, now);
  const preset = q.get('range') as RangePreset | null;
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case '7d':
      return { preset, from: addDays(today, -6), to: today };
    case '30d':
      return { preset, from: addDays(today, -29), to: today };
    case 'month':
      return { preset, from: `${today.slice(0, 8)}01`, to: today };
    default: {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      const r: DayRange = { preset: 'all' };
      if (isValidDate(from)) r.from = from;
      if (isValidDate(to)) r.to = to;
      if (r.from && r.to && r.from > r.to) [r.from, r.to] = [r.to, r.from];
      if (r.from || r.to) r.preset = 'custom';
      return r;
    }
  }
}

/** [start, end) in UTC for SQL; nulls mean open-ended. */
function bounds(range: DayRange, tz: string): [Date | null, Date | null] {
  return [range.from ? zonedToUtc(range.from, '00:00', tz) : null, range.to ? zonedToUtc(addDays(range.to, 1), '00:00', tz) : null];
}

const inRange = (col: string, a: number, b: number) => `(${col} >= coalesce($${a}::timestamptz, '-infinity') and ${col} < coalesce($${b}::timestamptz, 'infinity'))`;

// ---------------------------------------------------------------------------
// Dashboard numbers
// ---------------------------------------------------------------------------

export interface AdminStats {
  doctorsActive: number;
  doctorsPending: number;
  doctorsSuspended: number;
  patients: number;
  facilitiesActive: number;
  facilitiesPending: number;
  openIssues: number;
  /** Activity in the chosen range. */
  bookings: number;
  completed: number;
  cancellations: number;
  noShows: number;
  waitlistJoins: number;
  reviews: number;
  newPatients: number;
  /** Things waiting for an admin, regardless of range. */
  failedMessages: number;
}

export async function adminStats(db: Queryable, range: DayRange, tz: string): Promise<AdminStats> {
  const [a, b] = bounds(range, tz);
  const { rows } = await db.query<AdminStats>(
    `select
       (select count(*)::int from doctors d join users u on u.id = d.user_id where d.verification_status = 'approved' and u.status = 'active') as "doctorsActive",
       (select count(*)::int from doctors where verification_status = 'pending') as "doctorsPending",
       (select count(*)::int from doctors d join users u on u.id = d.user_id where d.verification_status = 'suspended' or (u.status = 'suspended')) as "doctorsSuspended",
       (select count(*)::int from users where role = 'patient') as patients,
       (select count(*)::int from facilities f join users u on u.id = f.user_id where f.verification_status = 'approved' and u.status = 'active') as "facilitiesActive",
       (select count(*)::int from facilities where verification_status = 'pending') as "facilitiesPending",
       (select count(*)::int from visit_issues where status = 'open') as "openIssues",
       (select count(*)::int from appointments where ${inRange('created_at', 1, 2)}) as bookings,
       (select count(*)::int from appointments where status = 'completed' and ${inRange('starts_at', 1, 2)}) as completed,
       (select count(*)::int from appointments where status = 'cancelled' and ${inRange('cancelled_at', 1, 2)}) as cancellations,
       (select count(*)::int from appointments where status = 'no_show' and ${inRange('starts_at', 1, 2)}) as "noShows",
       (select count(*)::int from waitlist_entries where ${inRange('created_at', 1, 2)}) as "waitlistJoins",
       (select count(*)::int from reviews where ${inRange('created_at', 1, 2)}) as reviews,
       (select count(*)::int from users where role = 'patient' and ${inRange('created_at', 1, 2)}) as "newPatients",
       (select count(*)::int from notification_outbox where status = 'failed') as "failedMessages"`,
    [a, b],
  );
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Accounts: find, suspend, reactivate
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  role: 'patient' | 'doctor' | 'admin' | 'facility';
  full_name: string;
  phone_e164: string;
  email: string | null;
  status: 'active' | 'suspended';
  created_at: Date;
  verification_status: string | null;
  upcoming: number;
  /** No-shows that count towards pausing online booking. */
  no_shows: number;
}

/** Search by name (part of it), mobile number, or email. At most 30 results. */
export async function searchAccounts(db: Queryable, rawQuery: string, noShowWindowDays: number): Promise<AccountRow[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const phone = normalizeEgyptMobile(q);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return (
    await db.query<AccountRow>(
      `select u.id, u.role, u.full_name, u.phone_e164, u.email, u.status, u.created_at, d.verification_status,
              (select count(*)::int from appointments a where (a.patient_id = u.id or a.doctor_id = u.id)
                  and a.status in ('confirmed', 'arrived') and a.starts_at > now()) as upcoming,
              (select count(*)::int from appointments a where a.patient_id = u.id and a.status = 'no_show' and not a.no_show_waived
                  and a.starts_at > now() - make_interval(days => $4)
                  and (u.no_show_cleared_at is null or a.starts_at > u.no_show_cleared_at)) as no_shows
         from users u left join doctors d on d.user_id = u.id
        where u.status <> 'removed' and (u.full_name ilike $1 or u.email = $2 or u.phone_e164 = $3)
        order by u.created_at desc limit 30`,
      [like, q.toLowerCase(), phone ?? '', noShowWindowDays],
    )
  ).rows;
}

/** The newest accounts (all kinds), so the admin can find test accounts without searching. */
export async function recentAccounts(db: Queryable, noShowWindowDays: number, limit = 60): Promise<AccountRow[]> {
  return (
    await db.query<AccountRow>(
      `select u.id, u.role, u.full_name, u.phone_e164, u.email, u.status, u.created_at, d.verification_status,
              (select count(*)::int from appointments a where (a.patient_id = u.id or a.doctor_id = u.id)
                  and a.status in ('confirmed', 'arrived') and a.starts_at > now()) as upcoming,
              (select count(*)::int from appointments a where a.patient_id = u.id and a.status = 'no_show' and not a.no_show_waived
                  and a.starts_at > now() - make_interval(days => $1)
                  and (u.no_show_cleared_at is null or a.starts_at > u.no_show_cleared_at)) as no_shows
         from users u left join doctors d on d.user_id = u.id
        where u.status <> 'removed' and u.role <> 'admin'
        order by u.created_at desc limit $2`,
      [noShowWindowDays, limit],
    )
  ).rows;
}

/**
 * Removes an account for good (e.g. a test account on the live site). Personal details are
 * wiped and sign-in stops; its upcoming visits are cancelled; a doctor or pharmacy/lab disappears
 * from search. Visit, medical and payment history stays (anonymous) because those records are
 * never deleted. The mobile number and email become free to register again.
 */
export async function removeAccount(deps: Deps, admin: SessionUser, userId: string, confirmWord: string, ip: string): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  if (!/^(remove|حذف)$/i.test(confirmWord.trim())) throw new DomainError('adm.removeConfirmWord');
  if (userId === admin.id) throw new DomainError('adm.cannotSuspendAdmin');
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ role: string; status: string }>('select role, status from users where id = $1 for update', [userId]);
    const u = rows[0];
    if (!u || u.status === 'removed') throw notFound();
    if (u.role === 'admin') throw new DomainError('adm.cannotSuspendAdmin');
    await tx.query(
      `update appointments set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), updated_at = now()
        where (patient_id = $1 or doctor_id = $1) and status in ('confirmed', 'arrived') and starts_at > now()`,
      [userId],
    );
    if (u.role === 'doctor') await tx.query(`update doctors set verification_status = 'suspended', updated_at = now() where user_id = $1`, [userId]);
    if (u.role === 'facility') await tx.query(`update facilities set verification_status = 'suspended', updated_at = now() where user_id = $1`, [userId]);
    // Doctors' own files about this person stay with the doctors, unlinked from the closed account.
    await tx.query('update patient_records set patient_user_id = null where patient_user_id = $1', [userId]);
    await tx.query(
      `update users set status = 'removed', full_name = 'Removed account', phone_e164 = 'removed:' || id::text, email = null,
              email_verified_at = null, phone_verified_at = null, password_hash = 'removed', updated_at = now()
        where id = $1`,
      [userId],
    );
    await destroyUserSessions(tx, userId);
    await audit(tx, { actorId: admin.id, action: 'account.remove', entityType: 'user', entityId: userId, metadata: { role: u.role }, ip });
  });
}

/** Lets a patient book online again after no-shows paused it. Older no-shows stop counting. */
export async function clearNoShows(deps: Deps, admin: SessionUser, userId: string, ip: string): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  await deps.db.transaction(async (tx) => {
    const r = await tx.query("update users set no_show_cleared_at = now(), updated_at = now() where id = $1 and role = 'patient'", [userId]);
    if (r.rowCount === 0) throw notFound();
    await audit(tx, { actorId: admin.id, action: 'account.clear_no_shows', entityType: 'user', entityId: userId, ip });
  });
}

/**
 * Suspending blocks sign-in at once (sessions are deleted; every sign-in route checks status) and
 * hides a doctor from search. Upcoming bookings are kept so nobody is cancelled by accident.
 * Admin accounts cannot be suspended here (protects against locking everyone out).
 */
export async function setAccountStatus(deps: Deps, admin: SessionUser, userId: string, suspend: boolean, rawReason: string, ip: string): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  const reason = rawReason.trim();
  if (suspend && reason.length < 3) throw new DomainError('admin.noteRequired');
  if (reason.length > 300) throw new DomainError('review.tooLong');
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ role: string; status: string }>('select role, status from users where id = $1 for update', [userId]);
    const u = rows[0];
    if (!u) throw notFound();
    if (u.role === 'admin') throw new DomainError('adm.cannotSuspendAdmin');
    const to = suspend ? 'suspended' : 'active';
    if (u.status === to) return;
    await tx.query('update users set status = $2, updated_at = now() where id = $1', [userId, to]);
    if (suspend) await destroyUserSessions(tx, userId);
    await audit(tx, { actorId: admin.id, action: suspend ? 'account.suspend' : 'account.reactivate', entityType: 'user', entityId: userId, metadata: { role: u.role, reason: reason || null }, ip });
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditFilters {
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  range: DayRange;
}

export interface AuditRow {
  id: string;
  created_at: Date;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
}

export async function listAudit(db: Queryable, f: AuditFilters, tz: string, limit = 100): Promise<AuditRow[]> {
  const [a, b] = bounds(f.range, tz);
  const where: string[] = [inRange('l.created_at', 1, 2)];
  const params: unknown[] = [a, b];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.action.trim()) add(`l.action ilike ?`, `${f.action.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.entityType.trim()) add(`l.entity_type = ?`, f.entityType.trim());
  if (f.entityId.trim()) add(`l.entity_id = ?`, f.entityId.trim());
  if (f.actor.trim()) {
    // Who did it: their account id, email or mobile number.
    const actor = f.actor.trim();
    params.push(actor, normalizeEgyptMobile(actor) ?? '');
    const n = params.length - 1;
    where.push(`l.actor_user_id in (select id from users where id::text = $${n} or email = lower($${n}) or phone_e164 = $${n + 1})`);
  }
  params.push(Math.min(Math.max(limit, 1), 500));
  return (
    await db.query<AuditRow>(
      `select l.id::text, l.created_at, l.action, l.entity_type, l.entity_id, l.metadata, l.ip,
              u.id as actor_id, u.full_name as actor_name, u.role as actor_role
         from audit_log l left join users u on u.id = l.actor_user_id
        where ${where.join(' and ')}
        order by l.created_at desc, l.id desc limit $${params.length}`,
      params,
    )
  ).rows;
}

// ---------------------------------------------------------------------------
// Messages (SMS / email outbox) and services
// ---------------------------------------------------------------------------

export interface OutboxCount {
  channel: 'sms' | 'email';
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  n: number;
}

export interface FailedMessage {
  id: string;
  channel: 'sms' | 'email';
  recipient: string;
  attempts: number;
  last_error: string | null;
  created_at: Date;
}

/** Hides most of a phone number or email address. */
export function maskRecipient(v: string): string {
  if (v.includes('@')) {
    const [u = '', d = ''] = v.split('@');
    return `${u.slice(0, 1)}•••@${d}`;
  }
  return v.length > 6 ? `${v.slice(0, 5)}•••${v.slice(-2)}` : '•••';
}

export async function outboxOverview(db: Queryable): Promise<{ counts: OutboxCount[]; failed: FailedMessage[] }> {
  const [counts, failed] = await Promise.all([
    db.query<OutboxCount>(
      `select channel, status, count(*)::int as n from notification_outbox where created_at > now() - interval '7 days' group by channel, status order by channel, status`,
    ),
    db.query<Omit<FailedMessage, 'recipient'> & { to_phone: string | null; to_email: string | null }>(
      `select id::text, channel, to_phone, to_email, attempts, last_error, created_at from notification_outbox
        where status = 'failed' order by created_at desc limit 20`,
    ),
  ]);
  return {
    counts: counts.rows,
    failed: failed.rows.map(({ to_phone, to_email, ...m }) => ({ ...m, recipient: maskRecipient(to_email ?? to_phone ?? '') })),
  };
}

/** Puts failed messages (last 7 days) back in the queue for another round of attempts. */
export async function retryFailedMessages(deps: Deps, admin: SessionUser, ip: string): Promise<number> {
  if (admin.role !== 'admin') throw notFound();
  return deps.db.transaction(async (tx) => {
    const { rowCount } = await tx.query(
      `update notification_outbox set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
        where status = 'failed' and created_at > now() - interval '7 days'`,
    );
    await audit(tx, { actorId: admin.id, action: 'outbox.retry_failed', entityType: 'notification_outbox', metadata: { count: rowCount ?? 0 }, ip });
    return rowCount ?? 0;
  });
}
