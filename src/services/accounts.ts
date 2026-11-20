import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { MessageKey, Locale } from '../i18n/index.js';
import { translator } from '../i18n/index.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { checkPasswordPolicy, hashPassword, verifyPassword, dummyPasswordHash, needsRehash } from '../auth/password.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { sha256 } from '../auth/tokens.js';
import { enqueueSms } from './outbox.js';
import { audit } from './audit.js';
import type { Role } from '../auth/sessions.js';
import { tooManyRequests } from '../http/errors.js';

export type FieldErrors = Partial<Record<string, MessageKey>>;

export function validateName(name: string): MessageKey | null {
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length >= 2 && n.length <= 120 ? null : 'name.invalid';
}

export interface PatientSignup {
  fullName: string;
  phone: string;
  password: string;
  consent: boolean;
  locale: Locale;
  ip: string;
}

export async function registerPatient(deps: Deps, input: PatientSignup): Promise<{ userId: string } | { errors: FieldErrors }> {
  const errors: FieldErrors = {};
  const phone = normalizeEgyptMobile(input.phone);
  const nameErr = validateName(input.fullName);
  if (nameErr) errors['fullName'] = nameErr;
  if (!phone) errors['phone'] = 'phone.invalid';
  const pwErr = checkPasswordPolicy(input.password, [input.fullName, phone?.slice(3) ?? '']);
  if (pwErr) errors['password'] = pwErr;
  if (!input.consent) errors['consent'] = 'auth.consentRequired';
  if (Object.keys(errors).length || !phone) return { errors };

  if (!(await hitRateLimit(deps.db, `signup:ip:${input.ip}`, LIMITS.signupPerIp.limit, LIMITS.signupPerIp.window))) throw tooManyRequests();

  const hash = await hashPassword(input.password);
  try {
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into users (role, full_name, phone_e164, password_hash, preferred_locale) values ('patient', $1, $2, $3, $4) returning id`,
      [input.fullName.trim().replace(/\s+/g, ' '), phone, hash, input.locale],
    );
    const userId = rows[0]!.id;
    await audit(deps.db, { actorId: userId, action: 'user.signup', entityType: 'user', entityId: userId, ip: input.ip });
    return { userId };
  } catch (e) {
    if (isUniqueViolation(e, 'users_phone_e164_key')) return { errors: { phone: 'auth.phoneTaken' } };
    throw e;
  }
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  phoneVerified: boolean;
}

/** Same response and similar timing for unknown phone and wrong password. */
export async function authenticate(deps: Deps, phoneRaw: string, password: string, ip: string): Promise<AuthenticatedUser | null> {
  if (!(await hitRateLimit(deps.db, `login:ip:${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window))) throw tooManyRequests();
  const phone = normalizeEgyptMobile(phoneRaw);
  if (phone && !(await hitRateLimit(deps.db, `login:phone:${phone}`, LIMITS.loginPerPhone.limit, LIMITS.loginPerPhone.window))) throw tooManyRequests();

  const { rows } = phone
    ? await deps.db.query<{ id: string; role: Role; password_hash: string; status: string; phone_verified_at: Date | null }>(
        'select id, role, password_hash, status, phone_verified_at from users where phone_e164 = $1',
        [phone],
      )
    : { rows: [] };
  const user = rows[0];
  const ok = await verifyPassword(password.slice(0, 256), user?.password_hash ?? (await dummyPasswordHash()));
  if (!user || !ok || user.status !== 'active') {
    await audit(deps.db, { actorId: user?.id ?? null, action: 'auth.login_failed', entityType: 'user', entityId: user?.id ?? null, ip });
    return null;
  }
  if (needsRehash(user.password_hash)) {
    await deps.db.query('update users set password_hash = $2, updated_at = now() where id = $1', [user.id, await hashPassword(password)]);
  }
  await audit(deps.db, { actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip });
  return { id: user.id, role: user.role, phoneVerified: user.phone_verified_at !== null };
}

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const hashOtp = (userId: string, code: string) => sha256(`${userId}:${code}`);

/** Creates a new code (invalidating older ones) and queues the SMS. */
export async function issuePhoneOtp(deps: Deps, user: { id: string; phone: string; locale: Locale }): Promise<void> {
  const db = deps.db;
  const allowed =
    (await hitRateLimit(db, `otp:${user.id}`, LIMITS.otpSendPerUser.limit, LIMITS.otpSendPerUser.window)) &&
    (await hitRateLimit(db, `otp-day:${user.id}`, LIMITS.otpSendPerUserDaily.limit, LIMITS.otpSendPerUserDaily.window));
  if (!allowed) throw tooManyRequests();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx.query(`update otp_codes set consumed_at = now() where user_id = $1 and purpose = 'verify_phone' and consumed_at is null`, [user.id]);
    await tx.query(
      `insert into otp_codes (user_id, purpose, code_hash, expires_at) values ($1, 'verify_phone', $2, now() + make_interval(mins => $3::int))`,
      [user.id, hashOtp(user.id, code), OTP_TTL_MINUTES],
    );
    await enqueueSms(tx, user.phone, translator(user.locale)('sms.otp', { code }));
  });
}

export async function verifyPhoneOtp(deps: Deps, userId: string, codeRaw: string): Promise<MessageKey | null> {
  const code = codeRaw.replace(/\D/g, '');
  return deps.db.transaction(async (tx: Queryable) => {
    const { rows } = await tx.query<{ id: string; code_hash: Buffer | string; attempts: number; expired: boolean }>(
      `select id, code_hash, attempts, expires_at < now() as expired from otp_codes
        where user_id = $1 and purpose = 'verify_phone' and consumed_at is null
        order by created_at desc limit 1 for update`,
      [userId],
    );
    const otp = rows[0];
    if (!otp) return 'verify.expired';
    if (otp.expired) return 'verify.expired';
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return 'verify.tooManyAttempts';
    // bytea arrives as '\x…' hex text from the driver.
    const stored = typeof otp.code_hash === 'string' ? Buffer.from(otp.code_hash.replace(/^\\x/, ''), 'hex') : otp.code_hash;
    const given = hashOtp(userId, code);
    if (code.length !== 6 || !crypto.timingSafeEqual(stored, given)) {
      await tx.query('update otp_codes set attempts = attempts + 1 where id = $1', [otp.id]);
      return otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'verify.tooManyAttempts' : 'verify.invalid';
    }
    await tx.query('update otp_codes set consumed_at = now() where id = $1', [otp.id]);
    await tx.query('update users set phone_verified_at = now(), updated_at = now() where id = $1', [userId]);
    await audit(tx, { actorId: userId, action: 'user.phone_verified', entityType: 'user', entityId: userId });
    return null;
  });
}

export async function setPreferredLocale(deps: Deps, userId: string, locale: Locale): Promise<void> {
  await deps.db.query('update users set preferred_locale = $2 where id = $1 and preferred_locale <> $2', [userId, locale]);
}

