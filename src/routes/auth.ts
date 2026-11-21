import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser, safeNext, setCookie } from '../http/context.js';
import { smsEnabled, emailEnabled } from '../config.js';
import { sendHtml, redirect } from '../http/respond.js';
import { field, fieldAll } from '../http/body.js';
import { authenticate, registerPatient, issuePhoneOtp, verifyPhoneOtp, setPreferredLocale } from '../services/accounts.js';
import { registerDoctor, type PositionInput } from '../services/doctors.js';
import { getReference } from '../services/reference.js';
import { destroySession, SESSION_COOKIE, type Role } from '../auth/sessions.js';
import { loginPage, signupPage, verifyPage, loginEmailPage, emailCodePage, setPasswordPage } from '../views/pages/auth.js';
import { requestLoginCode, confirmLoginCode, setFirstPassword, hasPassword } from '../services/guestBooking.js';
import { pendingEmailCode, maskEmail } from '../services/emailCodes.js';
import { notFound } from '../http/errors.js';
import { uuidParam } from './helpers.js';
import type { MessageKey } from '../i18n/index.js';
import { joinPage } from '../views/pages/forDoctors.js';
import { HttpError } from '../http/errors.js';
import { startSession, homeFor, localized, formValue } from './helpers.js';

const nextParam = (ctx: Ctx) => safeNext(ctx.method === 'GET' ? ctx.query.get('next') : field(ctx.form, 'next'));

/** Where to go after a successful sign-in or verification. */
function afterAuth(ctx: Ctx, role: Role, next: string | null): string {
  if (next) return localized(ctx, next);
  return homeFor(ctx, role);
}

async function sendOtpQuietly(ctx: Ctx, user: { id: string; phone: string }): Promise<void> {
  try {
    await issuePhoneOtp(ctx.deps, { ...user, locale: ctx.locale });
  } catch (e) {
    // Rate-limited resend after sign-up: the earlier code is still valid.
    if (!(e instanceof HttpError && e.status === 429)) throw e;
  }
}

/** Demo mode only: read the newest code from the outbox so testers without SMS can continue. */
async function demoCode(ctx: Ctx): Promise<string | null> {
  if (!ctx.deps.cfg.DEMO_MODE || !ctx.user) return null;
  const { rows } = await ctx.deps.db.query<{ body: string }>(
    `select body from notification_outbox where to_phone = $1 and created_at > now() - interval '15 minutes' order by id desc limit 5`,
    [ctx.user.phone],
  );
  for (const r of rows) {
    const m = /\b(\d{6})\b/.exec(r.body);
    if (m) return m[1]!;
  }
  return null;
}

export function authRoutes(r: Router): void {
  r.get('/login', async (ctx) => {
    if (ctx.user) return redirect(ctx, homeFor(ctx, ctx.user.role));
    sendHtml(ctx, 200, loginPage(ctx, { next: nextParam(ctx) }));
  });

  r.post('/login', async (ctx) => {
    const next = nextParam(ctx);
    const phone = formValue(ctx, 'phone');
    const user = await authenticate(ctx.deps, phone, ctx.form['password']?.[0] ?? '', ctx.ip);
    if (!user) return sendHtml(ctx, 401, loginPage(ctx, { phone, error: 'auth.invalidCredentials', next }));
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, user.id, user.role);
    await setPreferredLocale(ctx.deps, user.id, ctx.locale);
    if (smsEnabled(ctx.deps.cfg) && !user.phoneVerified && user.role !== 'admin') {
      return redirect(ctx, href(ctx, '/verify-phone', { next: next ?? undefined }));
    }
    redirect(ctx, afterAuth(ctx, user.role, next));
  });

  // Sign in with a code sent to the patient's email (patients who booked without a password, or anyone who prefers it).
  r.get('/login/email', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw notFound();
    if (ctx.user) return redirect(ctx, homeFor(ctx, ctx.user.role));
    sendHtml(ctx, 200, loginEmailPage(ctx, { next: nextParam(ctx) }));
  });

  r.post('/login/email', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw notFound();
    const next = nextParam(ctx);
    const email = formValue(ctx, 'email');
    const result = await requestLoginCode(ctx.deps, email, ctx.locale, ctx.ip);
    if ('error' in result) return sendHtml(ctx, 422, loginEmailPage(ctx, { email, error: result.error, next }));
    redirect(ctx, href(ctx, `/login/email/${result.codeId}`, { next: next ?? undefined }));
  });

  const loginCodePage = async (ctx: Ctx, id: string, status: number, error?: MessageKey) => {
    const pending = await pendingEmailCode(ctx.deps.db, id, 'login');
    const next = nextParam(ctx);
    sendHtml(
      ctx,
      pending ? status : 410,
      emailCodePage(ctx, {
        action: href(ctx, `/login/email/${id}`),
        maskedEmail: pending ? maskEmail(pending.email) : '',
        title: 'loginEmail.codeTitle',
        lead: 'loginEmail.codeLead',
        error: pending ? error : (error ?? 'emailCode.expired'),
        next,
        startOver: href(ctx, '/login/email', { next: next ?? undefined }),
      }),
    );
  };

  r.get('/login/email/:id', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw notFound();
    await loginCodePage(ctx, uuidParam(ctx, 'id'), 200);
  });

  r.post('/login/email/:id', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw notFound();
    const id = uuidParam(ctx, 'id');
    const result = await confirmLoginCode(ctx.deps, id, formValue(ctx, 'code'), ctx.ip);
    if ('error' in result) return loginCodePage(ctx, id, 422, result.error);
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, result.userId, result.role);
    await setPreferredLocale(ctx.deps, result.userId, ctx.locale);
    redirect(ctx, afterAuth(ctx, result.role, nextParam(ctx)));
  });

  // First password for patients who joined with an emailed code.
  r.get('/account/password', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    if (await hasPassword(ctx.deps, user.id)) return redirect(ctx, href(ctx, '/appointments'));
    sendHtml(ctx, 200, setPasswordPage(ctx, {}));
  });

  r.post('/account/password', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const problem = await setFirstPassword(ctx.deps, user.id, ctx.form['password']?.[0] ?? '', ctx.ip);
    if (problem === 'password.alreadySet') return redirect(ctx, href(ctx, '/appointments'));
    if (problem) return sendHtml(ctx, 422, setPasswordPage(ctx, { error: problem }));
    redirect(ctx, href(ctx, '/appointments', { ok: 'passwordSet' }));
  });

  r.post('/logout', async (ctx) => {
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    setCookie(ctx, SESSION_COOKIE, '', { httpOnly: true, sameSite: 'Lax', maxAgeSeconds: 0 });
    redirect(ctx, href(ctx, '/'));
  });

  r.get('/signup', async (ctx) => {
    if (ctx.user) return redirect(ctx, homeFor(ctx, ctx.user.role));
    sendHtml(ctx, 200, signupPage(ctx, { next: nextParam(ctx) }));
  });

  r.post('/signup', async (ctx) => {
    const next = nextParam(ctx);
    const values = { fullName: formValue(ctx, 'fullName'), phone: formValue(ctx, 'phone') };
    const result = await registerPatient(ctx.deps, {
      ...values,
      password: ctx.form['password']?.[0] ?? '',
      consent: formValue(ctx, 'consent') === 'yes',
      locale: ctx.locale,
      ip: ctx.ip,
    });
    if ('errors' in result) return sendHtml(ctx, 422, signupPage(ctx, { values, errors: result.errors, next }));
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, result.userId, 'patient');
    const { rows } = await ctx.deps.db.query<{ phone_e164: string }>('select phone_e164 from users where id = $1', [result.userId]);
    if (!smsEnabled(ctx.deps.cfg)) return redirect(ctx, afterAuth(ctx, 'patient', next));
    await sendOtpQuietly(ctx, { id: result.userId, phone: rows[0]!.phone_e164 });
    redirect(ctx, href(ctx, '/verify-phone', { next: next ?? undefined }));
  });

  r.get('/verify-phone', async (ctx) => {
    const user = requireUser(ctx);
    if (user.phoneVerified || !smsEnabled(ctx.deps.cfg)) return redirect(ctx, afterAuth(ctx, user.role, nextParam(ctx)));
    sendHtml(ctx, 200, verifyPage(ctx, { next: nextParam(ctx), demoCode: await demoCode(ctx) }));
  });

  r.post('/verify-phone', async (ctx) => {
    const user = requireUser(ctx);
    const next = nextParam(ctx);
    if (user.phoneVerified || !smsEnabled(ctx.deps.cfg)) return redirect(ctx, afterAuth(ctx, user.role, next));
    const problem = await verifyPhoneOtp(ctx.deps, user.id, formValue(ctx, 'code'));
    if (problem) return sendHtml(ctx, 422, verifyPage(ctx, { error: problem, next, demoCode: await demoCode(ctx) }));
    redirect(ctx, afterAuth(ctx, user.role, next));
  });

  r.post('/verify-phone/resend', async (ctx) => {
    const user = requireUser(ctx);
    const next = nextParam(ctx);
    if (user.phoneVerified || !smsEnabled(ctx.deps.cfg)) return redirect(ctx, afterAuth(ctx, user.role, next));
    await issuePhoneOtp(ctx.deps, { id: user.id, phone: user.phone, locale: ctx.locale });
    sendHtml(ctx, 200, verifyPage(ctx, { notice: 'verify.resent', next, demoCode: await demoCode(ctx) }));
  });

  r.get('/for-doctors/join', async (ctx) => {
    if (ctx.user?.role === 'doctor') return redirect(ctx, href(ctx, '/dashboard'));
    sendHtml(ctx, 200, joinPage(ctx, await getReference(ctx.deps.db), {}));
  });

  r.post('/for-doctors/join', async (ctx) => {
    const f = ctx.form;
    const titles = f['posTitle'] ?? [];
    const positions: PositionInput[] = titles.slice(0, 10).map((_, i) => ({
      title: (f['posTitle']?.[i] ?? '').trim(),
      workplace: (f['posWorkplace']?.[i] ?? '').trim(),
      start: (f['posStart']?.[i] ?? '').trim(),
      end: (f['posEnd']?.[i] ?? '').trim(),
    }));
    const values = {
      fullName: field(f, 'fullName'),
      email: field(f, 'email'),
      phone: field(f, 'phone'),
      kind: field(f, 'kind'),
      specialty: field(f, 'specialty'),
      graduationYear: field(f, 'graduationYear'),
      subspecialties: fieldAll(f, 'subspecialties'),
    };
    const result = await registerDoctor(ctx.deps, {
      fullName: values.fullName,
      email: values.email,
      phone: values.phone,
      password: f['password']?.[0] ?? '',
      kind: values.kind,
      specialtyId: Number(values.specialty),
      subspecialtyIds: values.subspecialties.map(Number).filter(Number.isInteger),
      graduationYear: Number(values.graduationYear),
      positions,
      card: ctx.files.find((x) => x.field === 'card'),
      consent: field(f, 'consent') === 'yes',
      locale: ctx.locale,
      ip: ctx.ip,
    });
    if ('errors' in result) {
      return sendHtml(ctx, 422, joinPage(ctx, await getReference(ctx.deps.db), { values, positions, errors: result.errors }));
    }
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, result.userId, 'doctor');
    const { rows } = await ctx.deps.db.query<{ phone_e164: string }>('select phone_e164 from users where id = $1', [result.userId]);
    if (!smsEnabled(ctx.deps.cfg)) return redirect(ctx, href(ctx, '/dashboard'));
    await sendOtpQuietly(ctx, { id: result.userId, phone: rows[0]!.phone_e164 });
    redirect(ctx, href(ctx, '/verify-phone', { next: '/dashboard' }));
  });
}
