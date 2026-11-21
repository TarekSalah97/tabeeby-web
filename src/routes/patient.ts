import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser, LoginRequired } from '../http/context.js';
import { smsEnabled, emailEnabled } from '../config.js';
import { sendHtml, redirect } from '../http/respond.js';
import { startGuestBooking, confirmGuestCode, hasPassword } from '../services/guestBooking.js';
import { pendingEmailCode, maskEmail } from '../services/emailCodes.js';
import { emailCodePage, patientGatePage } from '../views/pages/auth.js';
import { startSession } from './helpers.js';
import type { SessionUser } from '../auth/sessions.js';
import { book, resolveSlot, changeStatus, listPatientAppointments, quote } from '../services/booking.js';
import { confirmPage, appointmentsPage, reviewPage, guestConfirmPage } from '../views/pages/booking.js';
import { getReceipt } from '../services/payments.js';
import { receiptPage } from '../views/pages/payments.js';
import { getReviewTarget, parseRating, submitReview } from '../services/reviews.js';
import { joinWaitlist, leaveWaitlist, listPatientWaitlist } from '../services/waitlist.js';
import { DomainError, badRequest } from '../http/errors.js';
import { isUuid } from '../http/router.js';
import { isMessageKey, type MessageKey } from '../i18n/index.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';

async function doctorSlugForClinic(ctx: Ctx, clinicId: string): Promise<string | null> {
  const { rows } = await ctx.deps.db.query<{ slug: string }>('select d.slug from clinics c join doctors d on d.user_id = c.doctor_id where c.id = $1', [clinicId]);
  return rows[0]?.slug ?? null;
}

const domainKey = (e: DomainError): MessageKey => (isMessageKey(e.messageKey) ? e.messageKey : 'error.badRequest');

export function patientRoutes(r: Router): void {
  r.get('/book', async (ctx) => {
    // Signed-out visitors can book with an emailed code when email is set up; otherwise they sign in first.
    if (!ctx.user) {
      if (!emailEnabled(ctx.deps.cfg)) throw new LoginRequired();
      const clinicId = ctx.query.get('clinic');
      const start = new Date(ctx.query.get('start') ?? '');
      if (!isUuid(clinicId) || Number.isNaN(start.getTime())) throw badRequest();
      try {
        return sendHtml(ctx, 200, guestConfirmPage(ctx, await resolveSlot(ctx.deps, ctx.deps.db, clinicId, start), {}));
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        const slug = await doctorSlugForClinic(ctx, clinicId);
        if (!slug) throw e;
        return redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, error: domainKey(e) }));
      }
    }
    // Patients must be signed in with a verified phone before they see the confirm step.
    const user = requireUser(ctx);
    if (user.role !== 'patient') throw new DomainError('booking.notPatient');
    if (smsEnabled(ctx.deps.cfg) && !user.phoneVerified) return redirect(ctx, href(ctx, '/verify-phone', { next: ctx.path + ctx.url.search }));
    const clinicId = ctx.query.get('clinic');
    const start = new Date(ctx.query.get('start') ?? '');
    if (!isUuid(clinicId) || Number.isNaN(start.getTime())) throw badRequest();
    try {
      const target = await resolveSlot(ctx.deps, ctx.deps.db, clinicId, start);
      sendHtml(ctx, 200, confirmPage(ctx, target, await quote(ctx.deps.db, user.id, target), {}));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const slug = await doctorSlugForClinic(ctx, clinicId);
      if (!slug) throw e;
      redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, error: domainKey(e) }));
    }
  });

  r.post('/book', async (ctx) => {
    const user = requireUser(ctx);
    const clinicId = formValue(ctx, 'clinic');
    const start = new Date(formValue(ctx, 'start'));
    if (!isUuid(clinicId) || Number.isNaN(start.getTime())) throw badRequest();
    const reason = formValue(ctx, 'reason');
    try {
      await book(ctx.deps, user, { clinicId, startsAt: start, reason }, ctx.ip);
      redirect(ctx, href(ctx, '/appointments', { ok: smsEnabled(ctx.deps.cfg) ? 'booked' : 'bookedNoSms' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const key = domainKey(e);
      if (key === 'booking.slotTaken' || key === 'booking.slotUnavailable' || key === 'booking.doctorUnavailable') {
        const slug = await doctorSlugForClinic(ctx, clinicId);
        if (slug) return redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, error: key }));
      }
      if (key === 'booking.verifyPhoneFirst') return redirect(ctx, href(ctx, '/verify-phone'));
      try {
        const target = await resolveSlot(ctx.deps, ctx.deps.db, clinicId, start);
        sendHtml(ctx, 409, confirmPage(ctx, target, await quote(ctx.deps.db, user.id, target), { error: key, reason }));
      } catch {
        redirect(ctx, href(ctx, '/appointments', { error: key }));
      }
    }
  });

  // Booking without an account, step 1: details → emailed code.
  r.post('/book/guest', async (ctx) => {
    const clinicId = formValue(ctx, 'clinic');
    const start = new Date(formValue(ctx, 'start'));
    if (!isUuid(clinicId) || Number.isNaN(start.getTime())) throw badRequest();
    if (ctx.user) return redirect(ctx, href(ctx, '/book', { clinic: clinicId, start: start.toISOString() }));
    if (!emailEnabled(ctx.deps.cfg)) throw new LoginRequired();
    const values = {
      fullName: formValue(ctx, 'fullName'),
      phone: formValue(ctx, 'phone'),
      email: formValue(ctx, 'email'),
      reason: formValue(ctx, 'reason'),
    } as const;
    try {
      const result = await startGuestBooking(ctx.deps, {
        clinicId,
        startsAt: start,
        ...values,
        consent: formValue(ctx, 'consent') === 'yes',
        locale: ctx.locale,
        ip: ctx.ip,
      });
      if ('errors' in result) {
        const target = await resolveSlot(ctx.deps, ctx.deps.db, clinicId, start);
        return sendHtml(ctx, 422, guestConfirmPage(ctx, target, { values, errors: result.errors }));
      }
      redirect(ctx, href(ctx, `/book/guest/${result.codeId}`));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const slug = await doctorSlugForClinic(ctx, clinicId);
      if (!slug) throw e;
      redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, error: domainKey(e) }));
    }
  });

  const guestCodePage = async (ctx: Ctx, id: string, status: number, error?: MessageKey) => {
    const pending = await pendingEmailCode(ctx.deps.db, id, 'guest_booking');
    const clinicId = pending ? String((pending.payload as { clinicId?: string }).clinicId ?? '') : '';
    const slug = isUuid(clinicId) ? await doctorSlugForClinic(ctx, clinicId) : null;
    sendHtml(
      ctx,
      pending ? status : 410,
      emailCodePage(ctx, {
        action: href(ctx, `/book/guest/${id}`),
        maskedEmail: pending ? maskEmail(pending.email) : '',
        title: 'guest.codeTitle',
        lead: 'guest.codeLead',
        error: pending ? error : (error ?? 'emailCode.expired'),
        startOver: slug ? href(ctx, `/doctors/${slug}`, { clinic: clinicId }) : href(ctx, '/search'),
      }),
    );
  };

  r.get('/book/guest/:id', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw new LoginRequired();
    await guestCodePage(ctx, uuidParam(ctx, 'id'), 200);
  });

  // Step 2: the right code creates the patient account, signs them in and books the visit.
  r.post('/book/guest/:id', async (ctx) => {
    if (!emailEnabled(ctx.deps.cfg)) throw new LoginRequired();
    const id = uuidParam(ctx, 'id');
    const result = await confirmGuestCode(ctx.deps, id, formValue(ctx, 'code'), ctx.ip);
    if ('error' in result) return guestCodePage(ctx, id, 422, result.error);
    const req = result.request;
    await startSession(ctx, result.userId, 'patient');
    const user: SessionUser = { id: result.userId, role: 'patient', fullName: req.fullName, phone: req.phone, phoneVerified: false, locale: req.locale };
    const start = new Date(req.startsAt);
    try {
      await book(ctx.deps, user, { clinicId: req.clinicId, startsAt: start, reason: req.reason }, ctx.ip);
      redirect(ctx, href(ctx, '/appointments', { ok: 'bookedGuest' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const key = domainKey(e);
      if (key === 'booking.verifyPhoneFirst') {
        return redirect(ctx, href(ctx, '/verify-phone', { next: href(ctx, '/book', { clinic: req.clinicId, start: req.startsAt }) }));
      }
      // The account exists and the patient is signed in; the time went to someone else in between.
      const slug = await doctorSlugForClinic(ctx, req.clinicId);
      redirect(ctx, slug ? href(ctx, `/doctors/${slug}`, { clinic: req.clinicId, error: 'guest.slotTakenSignedIn' }) : href(ctx, '/appointments', { error: key }));
    }
  });

  r.get('/appointments/:id/receipt', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'appointments', ctx.path));
    const receipt = await getReceipt(ctx.deps.db, ctx.user, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, receiptPage(ctx, receipt, href(ctx, '/appointments')));
  });

  r.get('/appointments', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'appointments', ctx.path));
    const user = ctx.user;
    const [list, waitlist, pw] = await Promise.all([
      listPatientAppointments(ctx.deps.db, user.id),
      listPatientWaitlist(ctx.deps, user.id),
      hasPassword(ctx.deps, user.id),
    ]);
    sendHtml(ctx, 200, appointmentsPage(ctx, list, waitlist, { notice: noticeFrom(ctx), error: errorFrom(ctx), needsPassword: !pw }));
  });

  // Verified reviews: only the patient of a completed visit can rate it.
  r.get('/appointments/:id/review', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    try {
      sendHtml(ctx, 200, reviewPage(ctx, await getReviewTarget(ctx.deps.db, user.id, id), {}));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/appointments', { error: domainKey(e) }));
    }
  });

  r.post('/appointments/:id/review', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    const rating = parseRating(formValue(ctx, 'rating'));
    const comment = formValue(ctx, 'comment');
    try {
      if (rating === null) throw new DomainError('review.ratingRequired');
      await submitReview(ctx.deps, user, id, rating, comment, ctx.ip);
      redirect(ctx, href(ctx, '/appointments', { ok: 'reviewSaved' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const target = await getReviewTarget(ctx.deps.db, user.id, id).catch(() => null);
      if (!target) return redirect(ctx, href(ctx, '/appointments', { error: domainKey(e) }));
      sendHtml(ctx, 422, reviewPage(ctx, target, { error: domainKey(e), rating, comment }));
    }
  });

  // Waitlist for fully booked days.
  r.post('/waitlist', async (ctx) => {
    const user = requireUser(ctx);
    const clinicId = formValue(ctx, 'clinic');
    const date = formValue(ctx, 'date');
    if (!isUuid(clinicId)) throw badRequest();
    const slug = await doctorSlugForClinic(ctx, clinicId);
    if (!slug) throw badRequest();
    try {
      await joinWaitlist(ctx.deps, user, clinicId, date, ctx.ip);
      redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, ok: 'waitlistJoined' }) + '#book-title');
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      if (domainKey(e) === 'booking.verifyPhoneFirst') return redirect(ctx, href(ctx, '/verify-phone'));
      redirect(ctx, href(ctx, `/doctors/${slug}`, { clinic: clinicId, error: domainKey(e) }) + '#book-title');
    }
  });

  r.post('/waitlist/:id/leave', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    await leaveWaitlist(ctx.deps, user, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/appointments', { ok: 'waitlistLeft' }));
  });

  r.post('/appointments/:id/cancel', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    try {
      await changeStatus(ctx.deps, user, id, 'cancelled', ctx.ip);
      redirect(ctx, href(ctx, '/appointments', { ok: 'cancelled' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/appointments', { error: domainKey(e) }));
    }
  });
}
