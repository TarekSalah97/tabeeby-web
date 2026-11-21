import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { smsEnabled } from '../config.js';
import { sendHtml, redirect } from '../http/respond.js';
import { fieldAll } from '../http/body.js';
import type { SessionUser } from '../auth/sessions.js';
import { getReference } from '../services/reference.js';
import {
  getOwnDoctor, listOwnClinics, saveClinic, listOwnRules, addRules, deleteRule, listOwnBlocks, addBlock, deleteBlock,
  listPositions, addPosition, deletePosition, updateProfile, getOwnSelections, toRanges, type ClinicInput, type DayHours, type RuleProblem,
} from '../services/doctors.js';
import { doctorDay, upcomingWeekCount } from '../services/dashboard.js';
import { changeStatus } from '../services/booking.js';
import { ratingsFor } from '../services/reviews.js';
import { todayPage, clinicsPage, hoursPage, profileEditPage, clinicBookPage, type HoursFormValues, type ClinicBookView } from '../views/pages/dashboard.js';
import { bookByClinic, clampClinicDate, clinicSlots, followUpSource, noShowCounts, ownActiveClinics, CLINIC_BOOKING_DAYS, type ClinicBookingInput } from '../services/clinicBooking.js';
import type { FieldErrors } from '../services/accounts.js';
import { experienceYears } from '../domain/experience.js';
import { addDays, isValidDate, todayIn } from '../domain/time.js';
import { DomainError, notFound } from '../http/errors.js';
import { isUuid } from '../http/router.js';
import { isMessageKey, type MessageKey } from '../i18n/index.js';
import type { AppointmentStatus } from '../domain/appointmentStatus.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';

/** Doctors must have verified their phone before using the dashboard. */
export function requireDoctor(ctx: Ctx): SessionUser | null {
  const user = requireUser(ctx, 'doctor');
  if (smsEnabled(ctx.deps.cfg) && !user.phoneVerified) {
    redirect(ctx, href(ctx, '/verify-phone', { next: '/dashboard' }));
    return null;
  }
  return user;
}

const ok = (ctx: Ctx): { kind: 'success'; key: MessageKey } | { kind: 'error'; key: MessageKey } | undefined => {
  const n = noticeFrom(ctx);
  if (n) return { kind: 'success', key: n };
  const e = errorFrom(ctx);
  return e ? { kind: 'error', key: e } : undefined;
};

const STATUSES: AppointmentStatus[] = ['arrived', 'in_consultation', 'completed', 'no_show', 'cancelled'];

function clinicInput(ctx: Ctx): ClinicInput {
  return {
    name: formValue(ctx, 'name'),
    districtId: Number(formValue(ctx, 'district')),
    address: formValue(ctx, 'address'),
    phone: formValue(ctx, 'phone'),
    fee: formValue(ctx, 'fee'),
    followUpFee: formValue(ctx, 'followUpFee'),
    followUpDays: formValue(ctx, 'followUpDays'),
    isActive: formValue(ctx, 'active') === 'yes',
  };
}

function rawClinicValues(ctx: Ctx): Record<string, string> {
  return Object.fromEntries(['name', 'district', 'address', 'phone', 'fee', 'followUpFee', 'followUpDays', 'active'].map((k) => [k, formValue(ctx, k)]));
}

async function renderClinics(ctx: Ctx, user: SessionUser, extra: Parameters<typeof clinicsPage>[4] = {}, status = 200): Promise<void> {
  const [doctor, ref, clinics] = await Promise.all([getOwnDoctor(ctx.deps.db, user.id), getReference(ctx.deps.db), listOwnClinics(ctx.deps.db, user.id)]);
  sendHtml(ctx, status, clinicsPage(ctx, doctor, ref, clinics, { notice: ok(ctx), ...extra }));
}

async function renderHours(ctx: Ctx, user: SessionUser, extra: { ruleError?: RuleProblem; ruleValues?: HoursFormValues; blockError?: MessageKey } = {}, status = 200): Promise<void> {
  const db = ctx.deps.db;
  const [doctor, clinics, rules, blocks] = await Promise.all([getOwnDoctor(db, user.id), listOwnClinics(db, user.id), listOwnRules(db, user.id), listOwnBlocks(db, user.id)]);
  sendHtml(ctx, status, hoursPage(ctx, doctor, clinics, rules, blocks, { notice: ok(ctx), ...extra }));
}

async function renderProfile(ctx: Ctx, user: SessionUser, extra: { errors?: Record<string, MessageKey>; positionError?: MessageKey } = {}, status = 200): Promise<void> {
  const db = ctx.deps.db;
  const [doctor, ref, sel, positions] = await Promise.all([getOwnDoctor(db, user.id), getReference(db), getOwnSelections(db, user.id), listPositions(db, [user.id])]);
  const own = positions.get(user.id) ?? [];
  sendHtml(
    ctx,
    status,
    profileEditPage(ctx, doctor, ref, { ...sel, positions: own, years: experienceYears(toRanges(own), ctx.deps.now()), notice: ok(ctx), ...extra }),
  );
}

export function dashboardRoutes(r: Router): void {
  r.get('/dashboard', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const db = ctx.deps.db;
    const tz = ctx.deps.cfg.TIME_ZONE;
    const requested = ctx.query.get('date') ?? '';
    const date = isValidDate(requested) ? requested : todayIn(tz, ctx.deps.now());
    const [doctor, appointments, weekCount, clinics, rules] = await Promise.all([
      getOwnDoctor(db, user.id),
      doctorDay(db, user.id, date, tz),
      upcomingWeekCount(db, user.id),
      listOwnClinics(db, user.id),
      listOwnRules(db, user.id),
    ]);
    const [ratings, noShows] = await Promise.all([
      ratingsFor(db, [user.id]),
      noShowCounts(db, ctx.deps.cfg.NO_SHOW_WINDOW_DAYS, user.id, appointments.map((a) => ({ patientId: a.patient_id, phone: a.patient_phone }))),
    ]);
    const rating = ratings.get(user.id) ?? null;
    sendHtml(ctx, 200, todayPage(ctx, doctor, { date, appointments, weekCount, clinics, rules, rating, noShows, notice: ok(ctx) }));
  });

  /** Booking by the clinic: a phone call, a walk-in, or a follow-up from today's list. */
  const renderClinicBook = async (
    ctx: Ctx,
    user: SessionUser,
    req: { clinicId: string | null; date: string; fromId: string | null },
    extra: Pick<ClinicBookView, 'values' | 'errors' | 'error'> = {},
    status = 200,
  ): Promise<void> => {
    const db = ctx.deps.db;
    const [doctor, clinics] = await Promise.all([getOwnDoctor(db, user.id), ownActiveClinics(db, user.id)]);
    if (doctor.verification_status !== 'approved' || !clinics.length) return redirect(ctx, href(ctx, '/dashboard', { error: 'cbook.notApproved' }));
    const source = req.fromId ? await followUpSource(db, user.id, req.fromId) : null;
    const clinic = clinics.find((c) => c.id === req.clinicId) ?? clinics.find((c) => c.id === source?.clinicId) ?? clinics[0]!;
    const today = todayIn(ctx.deps.cfg.TIME_ZONE, ctx.deps.now());
    const date = clampClinicDate(req.date, today);
    const slots = await clinicSlots(ctx.deps, db, user.id, clinic.id, date);
    sendHtml(ctx, status, clinicBookPage(ctx, doctor, { clinics, clinicId: clinic.id, date, today, lastDate: addDays(today, CLINIC_BOOKING_DAYS), slots, source, ...extra }));
  };

  r.get('/dashboard/book', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const clinic = ctx.query.get('clinic');
    const from = ctx.query.get('from');
    await renderClinicBook(ctx, user, { clinicId: isUuid(clinic) ? clinic : null, date: ctx.query.get('date') ?? '', fromId: isUuid(from) ? from : null });
  });

  r.post('/dashboard/book', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const clinicId = formValue(ctx, 'clinic');
    const from = formValue(ctx, 'from');
    const startRaw = formValue(ctx, 'start');
    if (!isUuid(clinicId)) throw notFound();
    const fromId = isUuid(from) ? from : null;
    const values = Object.fromEntries(['name', 'phone', 'visitType', 'reason', 'start'].map((k) => [k, formValue(ctx, k)]));
    const back = { clinicId, date: formValue(ctx, 'date'), fromId };
    if (!startRaw) return renderClinicBook(ctx, user, back, { values, errors: { start: 'cbook.pickTime' } satisfies FieldErrors }, 422);
    const input: ClinicBookingInput = {
      clinicId,
      startsAt: new Date(startRaw),
      visitType: values['visitType'] === 'follow_up' ? 'follow_up' : 'new',
      reason: values['reason'] ?? '',
      fromAppointmentId: fromId,
      name: values['name'] ?? '',
      phone: values['phone'] ?? '',
    };
    try {
      const result = await bookByClinic(ctx.deps, user, input, ctx.ip);
      if ('errors' in result) return renderClinicBook(ctx, user, back, { values, errors: result.errors }, 422);
      const day = new Date(startRaw);
      redirect(ctx, href(ctx, '/dashboard', { date: todayIn(ctx.deps.cfg.TIME_ZONE, day), ok: 'clinicBooked' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const key = isMessageKey(e.messageKey) ? e.messageKey : 'booking.slotUnavailable';
      await renderClinicBook(ctx, user, back, { values: { ...values, start: '' }, error: key }, 409);
    }
  });

  r.post('/dashboard/appointments/:id/status', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const to = formValue(ctx, 'to') as AppointmentStatus;
    const date = formValue(ctx, 'date');
    const back = (q: Record<string, string>) => href(ctx, '/dashboard', { ...(isValidDate(date) ? { date } : {}), ...q });
    if (!STATUSES.includes(to)) return redirect(ctx, back({ error: 'appt.notAllowed' }));
    try {
      await changeStatus(ctx.deps, user, id, to, ctx.ip);
      redirect(ctx, back({}));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, back({ error: isMessageKey(e.messageKey) ? e.messageKey : 'appt.notAllowed' }));
    }
  });

  r.get('/dashboard/clinics', async (ctx) => {
    const user = requireDoctor(ctx);
    if (user) await renderClinics(ctx, user);
  });

  r.post('/dashboard/clinics', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const input = clinicInput(ctx);
    const errors = await saveClinic(ctx.deps, user.id, null, input);
    if (Object.keys(errors).length) {
      return renderClinics(ctx, user, { errors, editing: null, values: rawClinicValues(ctx) }, 422);
    }
    redirect(ctx, href(ctx, '/dashboard/clinics', { ok: 'saved' }));
  });

  r.post('/dashboard/clinics/:id', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const input = clinicInput(ctx);
    const errors = await saveClinic(ctx.deps, user.id, id, input);
    if (Object.keys(errors).length) {
      return renderClinics(ctx, user, { errors, editing: id, values: rawClinicValues(ctx) }, 422);
    }
    redirect(ctx, href(ctx, '/dashboard/clinics', { ok: 'saved' }));
  });

  r.get('/dashboard/hours', async (ctx) => {
    const user = requireDoctor(ctx);
    if (user) await renderHours(ctx, user);
  });

  r.post('/dashboard/hours/rules', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const values = hoursFormValues(ctx);
    const problem = await addRules(ctx.deps, user.id, {
      clinicId: uuidFromForm(ctx, 'clinic'),
      slotMinutes: Number(values.slot),
      days: values.days.map((weekday): DayHours => ({ weekday, ...values.times[weekday]! })),
    });
    if (problem) return renderHours(ctx, user, { ruleError: problem, ruleValues: values }, 422);
    redirect(ctx, href(ctx, '/dashboard/hours', { ok: 'saved' }));
  });

  r.post('/dashboard/hours/rules/:id/delete', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    await deleteRule(ctx.deps.db, user.id, uuidParam(ctx, 'id'));
    redirect(ctx, href(ctx, '/dashboard/hours', { ok: 'saved' }));
  });

  r.post('/dashboard/hours/blocks', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const problem = await addBlock(ctx.deps, user.id, { fromDate: formValue(ctx, 'fromDate'), toDate: formValue(ctx, 'toDate'), note: formValue(ctx, 'note') });
    if (problem) return renderHours(ctx, user, { blockError: problem }, 422);
    redirect(ctx, href(ctx, '/dashboard/hours', { ok: 'saved' }));
  });

  r.post('/dashboard/hours/blocks/:id/delete', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    await deleteBlock(ctx.deps.db, user.id, uuidParam(ctx, 'id'));
    redirect(ctx, href(ctx, '/dashboard/hours', { ok: 'saved' }));
  });

  r.get('/dashboard/profile', async (ctx) => {
    const user = requireDoctor(ctx);
    if (user) await renderProfile(ctx, user);
  });

  r.post('/dashboard/profile', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const errors = await updateProfile(ctx.deps, user.id, {
      titleEn: formValue(ctx, 'titleEn'),
      titleAr: formValue(ctx, 'titleAr'),
      bio: ctx.form['bio']?.[0] ?? '',
      gender: formValue(ctx, 'gender'),
      languages: fieldAll(ctx.form, 'languages'),
      subspecialtyIds: fieldAll(ctx.form, 'subspecialties').map(Number).filter(Number.isInteger),
      insurerIds: fieldAll(ctx.form, 'insurers').map(Number).filter(Number.isInteger),
    });
    if (Object.keys(errors).length) return renderProfile(ctx, user, { errors: errors as Record<string, MessageKey> }, 422);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'saved' }));
  });

  r.post('/dashboard/profile/positions', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const problem = await addPosition(ctx.deps, user.id, {
      title: formValue(ctx, 'posTitle'),
      workplace: formValue(ctx, 'posWorkplace'),
      start: formValue(ctx, 'posStart'),
      end: formValue(ctx, 'posEnd'),
    });
    if (problem) return renderProfile(ctx, user, { positionError: problem }, 422);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'saved' }));
  });

  r.post('/dashboard/profile/positions/:id/delete', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    await deletePosition(ctx.deps.db, user.id, uuidParam(ctx, 'id'));
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'saved' }));
  });
}

/**
 * Reads the working-hours form: ticked days in `days`, each day's times in
 * `start_N` / `end_N`. A single `weekday` + `start` / `end` (the previous form,
 * possibly still open in a browser during a deploy) is accepted too.
 */
function hoursFormValues(ctx: Ctx): HoursFormValues {
  const times: HoursFormValues['times'] = {};
  for (let d = 0; d < 7; d++) times[d] = { start: formValue(ctx, `start_${d}`), end: formValue(ctx, `end_${d}`) };
  let days = [...new Set(fieldAll(ctx.form, 'days').map(Number))];
  const legacy = formValue(ctx, 'weekday');
  if (days.length === 0 && legacy !== '') {
    const d = Number(legacy);
    days = [d];
    times[d] = { start: formValue(ctx, 'start'), end: formValue(ctx, 'end') };
  }
  // Unknown day numbers are kept so the service rejects them rather than silently dropping them.
  days = days.map((d) => (Number.isInteger(d) && d >= 0 && d <= 6 ? d : -1)).sort((a, b) => a - b);
  for (const d of days) times[d] ??= { start: '', end: '' };
  return { clinic: formValue(ctx, 'clinic'), slot: formValue(ctx, 'slot'), days, times };
}

function uuidFromForm(ctx: Ctx, name: string): string {
  const v = formValue(ctx, name);
  if (!isUuid(v)) throw notFound();
  return v;
}
