import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { emailEnabled, smsEnabled } from '../config.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { hitRateLimit } from '../auth/rateLimit.js';
import { hashPassword, checkPasswordPolicy } from '../auth/password.js';
import { destroyUserSessions, type Role } from '../auth/sessions.js';
import { sha256, randomToken } from '../auth/tokens.js';
import { translator, type Locale, type MessageKey } from '../i18n/index.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';
import { newCode, normalizeEmail } from './emailCodes.js';
import { enqueueEmail, enqueueSms } from './outbox.js';
import { audit } from './audit.js';

export const RESET_CODE_MINUTES = 15;
export const RESET_LINK_HOURS = 24;
const MAX_ATTEMPTS = 5;

const hashSecret = (id: string, secret: string) => sha256(`pwreset:${id}:${secret}`);

/** Whether codes can be sent at all on this server (otherwise people are told to contact us). */
export const resetByCodeAvailable = (cfg: Deps['cfg']): boolean => smsEnabled(cfg) || emailEnabled(cfg);

/**
 * Starts a reset from a mobile number or an email. The answer is the same whether or not an
 * account exists (so nobody can check who has an account). The code goes by SMS when SMS is
 * connected, otherwise to the account's email. Admin accounts are never reset this way.
 */
export async function requestPasswordReset(deps: Deps, identifierRaw: string, locale: Locale, ip: string): Promise<{ resetId: string } | { error: MessageKey }> {
  if (!resetByCodeAvailable(deps.cfg)) throw new DomainError('reset.unavailable');
  const raw = identifierRaw.trim();
  const phone = raw.includes('@') ? null : normalizeEgyptMobile(raw);
  const email = phone ? null : normalizeEmail(raw);
  if (!phone && !email) return { error: 'reset.identifierInvalid' };
  if (!(await hitRateLimit(deps.db, `pwreset:ip:${ip}`, 10, 60 * 60))) throw tooManyRequests();
  if (!(await hitRateLimit(deps.db, `pwreset:to:${phone ?? email}`, 3, 60 * 60))) throw tooManyRequests();

  const { rows } = await deps.db.query<{ id: string; phone_e164: string; email: string | null; preferred_locale: Locale | null }>(
    `select id, phone_e164, email, preferred_locale from users
      where ${phone ? 'phone_e164 = $1' : 'email = $1'} and role <> 'admin' and status = 'active'`,
    [phone ?? email],
  );
  const user = rows[0];
  const channel: 'sms' | 'email' | null = !user
    ? null
    : smsEnabled(deps.cfg) && (phone || !emailEnabled(deps.cfg))
      ? 'sms'
      : emailEnabled(deps.cfg) && user.email
        ? 'email'
        : smsEnabled(deps.cfg) ? 'sms' : null;
  const code = newCode();
  const id = crypto.randomUUID();
  await deps.db.transaction(async (tx) => {
    await tx.query(
      `insert into password_resets (id, user_id, channel, secret_hash, expires_at) values ($1, $2, $3, $4, now() + make_interval(mins => $5::int))`,
      [id, channel ? user!.id : null, channel ?? (phone ? 'sms' : 'email'), hashSecret(id, code), RESET_CODE_MINUTES],
    );
    if (!user || !channel) return;
    // Older unused codes for this account stop working.
    await tx.query("update password_resets set consumed_at = now() where user_id = $1 and id <> $2 and consumed_at is null and channel <> 'admin_link'", [user.id, id]);
    const t = translator(user.preferred_locale ?? locale);
    if (channel === 'sms') await enqueueSms(tx, user.phone_e164, t('reset.sms', { code, minutes: RESET_CODE_MINUTES }));
    else await enqueueEmail(tx, user.email!, t('reset.emailSubject'), t('reset.emailBody', { code, minutes: RESET_CODE_MINUTES }));
    await audit(tx, { actorId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, metadata: { channel }, ip });
  });
  return { resetId: id };
}

/** Whether a reset (code or link) can still be used — for showing its page. */
export async function pendingReset(db: Queryable, id: string): Promise<{ channel: 'sms' | 'email' | 'admin_link' } | null> {
  const { rows } = await db.query<{ channel: 'sms' | 'email' | 'admin_link' }>(
    'select channel from password_resets where id = $1 and consumed_at is null and expires_at > now() and attempts < $2',
    [id, MAX_ATTEMPTS],
  );
  return rows[0] ?? null;
}

/**
 * Checks the code (or link secret) and sets the new password. A wrong code counts an attempt.
 * On success every session of that account is signed out (in case someone else was signed in),
 * and the person is told by SMS/email that the password changed.
 */
export async function completePasswordReset(
  deps: Deps,
  id: string,
  given: { kind: 'code' | 'link'; secret: string },
  password: string,
  ip: string,
): Promise<{ error: MessageKey; field?: 'code' | 'password' } | { userId: string; role: Role }> {
  const isLink = given.kind === 'link';
  const secret = isLink ? given.secret.trim().slice(0, 100) : given.secret.replace(/\D/g, '').slice(0, 6);
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ user_id: string | null; channel: string; secret_hash: Buffer | string; attempts: number; usable: boolean }>(
      `select user_id, channel, secret_hash, attempts, (consumed_at is null and expires_at > now()) as usable from password_resets where id = $1 for update`,
      [id],
    );
    const r = rows[0];
    if (!r || !r.usable) return { error: 'reset.expired' as MessageKey, field: 'code' as const };
    if (r.attempts >= MAX_ATTEMPTS) return { error: 'reset.tooManyAttempts' as MessageKey, field: 'code' as const };
    const stored = typeof r.secret_hash === 'string' ? Buffer.from(r.secret_hash.replace(/^\\x/, ''), 'hex') : r.secret_hash;
    const right = secret.length > 0 && crypto.timingSafeEqual(stored, hashSecret(id, secret)) && (r.channel === 'admin_link') === isLink;
    if (!right || !r.user_id) {
      await tx.query('update password_resets set attempts = attempts + 1 where id = $1', [id]);
      return { error: (r.attempts + 1 >= MAX_ATTEMPTS ? 'reset.tooManyAttempts' : 'reset.codeWrong') as MessageKey, field: 'code' as const };
    }
    const { rows: users } = await tx.query<{ id: string; role: Role; full_name: string; phone_e164: string; email: string | null; preferred_locale: Locale | null }>(
      "select id, role, full_name, phone_e164, email, preferred_locale from users where id = $1 and status = 'active' and role <> 'admin'",
      [r.user_id],
    );
    const u = users[0];
    if (!u) return { error: 'reset.expired' as MessageKey, field: 'code' as const };
    const problem = checkPasswordPolicy(password, [u.full_name, u.phone_e164.slice(3)]);
    // The code is kept (not used up) so the person can just pick a better password.
    if (problem) return { error: problem, field: 'password' as const };
    await tx.query('update users set password_hash = $2, has_password = true, updated_at = now() where id = $1', [u.id, await hashPassword(password)]);
    await tx.query('update password_resets set consumed_at = now() where user_id = $1 and consumed_at is null', [u.id]);
    await destroyUserSessions(tx, u.id);
    const t = translator(u.preferred_locale ?? 'ar');
    if (smsEnabled(deps.cfg)) await enqueueSms(tx, u.phone_e164, t('reset.changedSms'));
    else if (emailEnabled(deps.cfg) && u.email) await enqueueEmail(tx, u.email, t('reset.changedSubject'), t('reset.changedSms'));
    await audit(tx, { actorId: u.id, action: 'auth.password_reset', entityType: 'user', entityId: u.id, metadata: { channel: r.channel }, ip });
    return { userId: u.id, role: u.role };
  });
}

/**
 * Admin: a one-time link to set a new password, valid for 24 hours, to send the person on
 * WhatsApp when no SMS/email service is connected. Returns the path; the secret is shown once.
 */
export async function createResetLink(deps: Deps, adminId: string, userId: string, ip: string): Promise<{ path: string; name: string }> {
  const { rows } = await deps.db.query<{ full_name: string; role: Role }>("select full_name, role from users where id = $1 and status = 'active'", [userId]);
  const u = rows[0];
  if (!u) throw notFound();
  if (u.role === 'admin') throw new DomainError('reset.notForAdmins');
  const id = crypto.randomUUID();
  const secret = randomToken(24);
  await deps.db.transaction(async (tx) => {
    await tx.query("update password_resets set consumed_at = now() where user_id = $1 and channel = 'admin_link' and consumed_at is null", [userId]);
    await tx.query(
      `insert into password_resets (id, user_id, channel, secret_hash, expires_at, created_by) values ($1, $2, 'admin_link', $3, now() + make_interval(hours => $4::int), $5)`,
      [id, userId, hashSecret(id, secret), RESET_LINK_HOURS, adminId],
    );
    await audit(tx, { actorId: adminId, action: 'admin.password_reset_link', entityType: 'user', entityId: userId, ip });
  });
  return { path: `/reset-password/${id}/${secret}`, name: u.full_name };
}

export async function purgePasswordResets(db: Queryable): Promise<void> {
  await db.query("delete from password_resets where created_at < now() - interval '7 days'");
}
