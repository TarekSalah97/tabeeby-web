import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { book, resolveSlot, changeStatus, listPatientAppointments } from '../services/booking.js';
import { confirmPage, appointmentsPage } from '../views/pages/booking.js';
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
    // Patients must be signed in with a verified phone before they see the confirm step.
    const user = requireUser(ctx);
    if (user.role !== 'patient') throw new DomainError('booking.notPatient');
    if (!user.phoneVerified) return redirect(ctx, href(ctx, '/verify-phone', { next: ctx.path + ctx.url.search }));
    const clinicId = ctx.query.get('clinic');
    const start = new Date(ctx.query.get('start') ?? '');
    if (!isUuid(clinicId) || Number.isNaN(start.getTime())) throw badRequest();
    try {
      const target = await resolveSlot(ctx.deps, ctx.deps.db, clinicId, start);
      sendHtml(ctx, 200, confirmPage(ctx, target, {}));
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
    const visitType = formValue(ctx, 'visitType') === 'follow_up' ? 'follow_up' : 'new';
    const reason = formValue(ctx, 'reason');
    try {
      await book(ctx.deps, user, { clinicId, startsAt: start, visitType, reason }, ctx.ip);
      redirect(ctx, href(ctx, '/appointments', { ok: 'booked' }));
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
        sendHtml(ctx, 409, confirmPage(ctx, target, { error: key, reason, visitType }));
      } catch {
        redirect(ctx, href(ctx, '/appointments', { error: key }));
      }
    }
  });

  r.get('/appointments', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const list = await listPatientAppointments(ctx.deps.db, user.id);
    sendHtml(ctx, 200, appointmentsPage(ctx, list, { notice: noticeFrom(ctx), error: errorFrom(ctx) }));
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
