import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import { emailEnabled, smsEnabled } from '../config.js';
import { isUniqueViolation } from '../db/db.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { hashPassword, checkPasswordPolicy } from '../auth/password.js';
import type { Role } from '../auth/sessions.js';
import { translator, formatDateTime, type Locale, type MessageKey } from '../i18n/index.js';
import { bookableService } from './clinicServices.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';
import { resolveSlot, checkPayChoice, type BookingTarget } from './booking.js';
import { validateName, type FieldErrors } from './accounts.js';
import { createEmailCode, consumeEmailCode, newCode, normalizeEmail, EMAIL_CODE_TTL_MINUTES } from './emailCodes.js';
import { enqueueEmail, enqueueSms } from './outbox.js';
import { audit } from './audit.js';

export interface GuestBookingInput {
  clinicId: string;
  startsAt: Date;
  fullName: string;
  phone: string;
  email: string;
  reason: string;
  /** Chosen clinic service (checked against the clinic again when the booking is made). */
  serviceId?: string;
  payChoice?: string;
  /** Where to send the code: 'email' (default) or 'sms' (only when SMS is connected). */
  codeBy?: string;
  consent: boolean;
  locale: Locale;
  ip: string;
}

/** What a guest asked for, kept with the emailed code until they confirm it. */
export interface GuestRequest {
  fullName: string;
  phone: string;
  clinicId: string;
  startsAt: string;
  reason: string;
  locale: Locale;
  serviceId?: string;
  payChoice?: string;
  /** Where the code was sent: the mobile (verifies it) or the email (verifies that). */
  channel?: 'sms' | 'email';
}

/**
 * Step 1: check the details and the slot, then email a code. Nothing is created yet.
 * A mobile or email that already belongs to an account must sign in instead: an emailed code
 * must never give access to someone else's account.
 */
export async function startGuestBooking(deps: Deps, input: GuestBookingInput): Promise<{ codeId: string; target: BookingTarget } | { errors: FieldErrors }> {
  if (!emailEnabled(deps.cfg)) throw new DomainError('guest.unavailable');
  const errors: FieldErrors = {};
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const nameErr = validateName(fullName);
  if (nameErr) errors['fullName'] = nameErr;
  const phone = normalizeEgyptMobile(input.phone);
  if (!phone) errors['phone'] = 'phone.invalid';
  const email = normalizeEmail(input.email);
  if (!email) errors['email'] = 'guest.emailInvalid';
  if (!input.consent) errors['consent'] = 'auth.consentRequired';
  const reason = input.reason.trim().slice(0, 200);
  // A chosen service must be one of this clinic's current services.
  if (input.serviceId && !(await bookableService(deps.db, input.clinicId, input.serviceId))) throw new DomainError('svc.err.unavailable');

  // The slot must still be real and free (throws a booking error the route turns into a redirect).
  const target = await resolveSlot(deps, deps.db, input.clinicId, input.startsAt);
  const payChoice = checkPayChoice(input.payChoice, target);
  if (Object.keys(errors).length || !phone || !email) return { errors };

  if (!(await hitRateLimit(deps.db, `guest:ip:${input.ip}`, LIMITS.guestStartPerIp.limit, LIMITS.guestStartPerIp.window))) throw tooManyRequests();
  if (!(await hitRateLimit(deps.db, `guest:email:${email}`, LIMITS.emailCodePerAddress.limit, LIMITS.emailCodePerAddress.window))) throw tooManyRequests();

  const existing = await deps.db.query<{ phone_taken: boolean; email_taken: boolean }>(
    `select exists (select 1 from users where phone_e164 = $1) as phone_taken, exists (select 1 from users where email = $2) as email_taken`,
    [phone, email],
  );
  if (existing.rows[0]?.phone_taken) return { errors: { phone: 'guest.phoneHasAccount' } };
  if (existing.rows[0]?.email_taken) return { errors: { email: 'guest.emailHasAccount' } };

  const code = newCode();
  // The guest chooses: email (default), or SMS when an SMS service is connected (that also
  // verifies the mobile, so no second code is needed).
  const channel: 'sms' | 'email' = input.codeBy === 'sms' && smsEnabled(deps.cfg) ? 'sms' : 'email';
  const request: GuestRequest = { fullName, phone, clinicId: target.clinicId, startsAt: target.startsAt.toISOString(), reason, locale: input.locale, serviceId: input.serviceId, payChoice, channel };
  const t = translator(input.locale);
  const codeId = await deps.db.transaction(async (tx) => {
    const id = await createEmailCode(tx, email, 'guest_booking', code, { ...request });
    if (channel === 'sms') {
      await enqueueSms(tx, phone, t('sms.guestCode', { code, doctor: target.doctorName, minutes: EMAIL_CODE_TTL_MINUTES }));
    } else {
      await enqueueEmail(
        tx,
        email,
        t('email.codeSubject', { code }),
        t('email.guestCodeBody', {
          name: fullName,
          code,
          minutes: EMAIL_CODE_TTL_MINUTES,
          doctor: target.doctorName,
          when: formatDateTime(target.startsAt, input.locale, deps.cfg.TIME_ZONE),
        }),
      );
    }
    return id;
  });
  return { codeId, target };
}

/**
 * Step 2: a correct code creates the patient's account (email verified, no password yet).
 * The booking itself is made by the caller with the normal booking service, so every rule
 * (real slot, no double booking, limits, waitlist) applies exactly as for signed-in patients.
 */
export async function confirmGuestCode(deps: Deps, codeId: string, code: string, ip: string): Promise<{ error: MessageKey } | { userId: string; email: string; request: GuestRequest }> {
  // A password nobody knows: the account can only be entered by emailed code until the patient sets one.
  const unusableHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
  try {
    return await deps.db.transaction(async (tx) => {
      const checked = await consumeEmailCode(tx, codeId, 'guest_booking', code);
      if (!checked.ok) return { error: checked.error };
      const request = checked.row.payload as unknown as GuestRequest;
      const email = checked.row.email;
      const bySms = request.channel === 'sms';
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, email, email_verified_at, phone_verified_at, password_hash, has_password, preferred_locale)
         values ('patient', $1, $2, $3, $4, $5, $6, false, $7) returning id`,
        [request.fullName, request.phone, email, bySms ? null : new Date(), bySms ? new Date() : null, unusableHash, request.locale],
      );
      const userId = rows[0]!.id;
      await audit(tx, { actorId: userId, action: 'user.signup_guest_booking', entityType: 'user', entityId: userId, ip });
      return { userId, email, request };
    });
  } catch (e) {
    // Someone registered the same mobile or email between the two steps.
    if (isUniqueViolation(e)) return { error: 'guest.alreadyRegistered' };
    throw e;
  }
}

/** Email sign-in, step 1. Always answers the same way so nobody can test which emails have accounts. */
export async function requestLoginCode(deps: Deps, emailRaw: string, locale: Locale, ip: string): Promise<{ codeId: string } | { error: MessageKey }> {
  if (!emailEnabled(deps.cfg)) throw new DomainError('guest.unavailable');
  const email = normalizeEmail(emailRaw);
  if (!email) return { error: 'guest.emailInvalid' };
  if (!(await hitRateLimit(deps.db, `login-code:ip:${ip}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window))) throw tooManyRequests();
  if (!(await hitRateLimit(deps.db, `guest:email:${email}`, LIMITS.emailCodePerAddress.limit, LIMITS.emailCodePerAddress.window))) throw tooManyRequests();
  // Only patients with a verified email can sign in this way; staff always use a password.
  const { rows } = await deps.db.query<{ id: string; preferred_locale: Locale }>(
    `select id, preferred_locale from users where email = $1 and role = 'patient' and status = 'active' and email_verified_at is not null`,
    [email],
  );
  const user = rows[0];
  const code = newCode();
  const codeId = await deps.db.transaction(async (tx) => {
    const id = await createEmailCode(tx, email, 'login', code, { userId: user?.id ?? null });
    if (user) {
      const t = translator(locale);
      await enqueueEmail(tx, email, t('email.codeSubject', { code }), t('email.loginCodeBody', { code, minutes: EMAIL_CODE_TTL_MINUTES }));
    }
    return id;
  });
  return { codeId };
}

export async function confirmLoginCode(deps: Deps, codeId: string, code: string, ip: string): Promise<{ error: MessageKey } | { userId: string; role: Role }> {
  return deps.db.transaction(async (tx) => {
    const checked = await consumeEmailCode(tx, codeId, 'login', code);
    if (!checked.ok) return { error: checked.error };
    const userId = (checked.row.payload as { userId?: string | null }).userId;
    if (!userId) return { error: 'emailCode.invalid' };
    const { rows } = await tx.query<{ id: string; role: Role }>(`select id, role from users where id = $1 and role = 'patient' and status = 'active'`, [userId]);
    const user = rows[0];
    if (!user) return { error: 'emailCode.invalid' };
    await audit(tx, { actorId: user.id, action: 'auth.login_email_code', entityType: 'user', entityId: user.id, ip });
    return { userId: user.id, role: user.role };
  });
}

export async function hasPassword(deps: Deps, userId: string): Promise<boolean> {
  const { rows } = await deps.db.query<{ has_password: boolean }>('select has_password from users where id = $1', [userId]);
  return rows[0]?.has_password ?? true;
}

/** Patients who joined by email code set their first password here (no current password to ask for). */
export async function setFirstPassword(deps: Deps, userId: string, password: string, ip: string): Promise<MessageKey | null> {
  const { rows } = await deps.db.query<{ full_name: string; phone_e164: string; has_password: boolean; role: string }>(
    'select full_name, phone_e164, has_password, role from users where id = $1',
    [userId],
  );
  const u = rows[0];
  if (!u || u.role !== 'patient') throw notFound();
  if (u.has_password) return 'password.alreadySet';
  const problem = checkPasswordPolicy(password, [u.full_name, u.phone_e164.slice(3)]);
  if (problem) return problem;
  const hash = await hashPassword(password);
  await deps.db.transaction(async (tx) => {
    await tx.query('update users set password_hash = $2, has_password = true, updated_at = now() where id = $1 and has_password = false', [userId, hash]);
    await audit(tx, { actorId: userId, action: 'user.password_set', entityType: 'user', entityId: userId, ip });
  });
  return null;
}
