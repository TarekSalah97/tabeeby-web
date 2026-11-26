import { teamPage, teamJoinPage } from '../views/pages/team.js';
import { listTeam, addTeamMember, setTeamAccess, reinviteTeamMember, removeTeamMember, findInvite, acceptInvite } from '../services/team.js';
import { forbidden } from '../http/errors.js';
import { markActingAssistant } from '../http/actor.js';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { yearToMonth } from '../domain/experience.js';
import { href, requireUser } from '../http/context.js';
import { smsEnabled } from '../config.js';
import { sendHtml, redirect } from '../http/respond.js';
import { fieldAll } from '../http/body.js';
import { destroySession, type SessionUser } from '../auth/sessions.js';
import { getReference } from '../services/reference.js';
import {
  getOwnDoctor, listOwnClinics, saveClinic, listOwnRules, addRules, deleteRule, listOwnBlocks, addBlock, deleteBlock,
  listPositions, addPosition, deletePosition, updateProfile, getOwnSelections, toRanges, type ClinicInput, type DayHours, type RuleProblem, setShowIncome, setInstapayAddress, setDoctorPhoto, removeDoctorPhoto,
} from '../services/doctors.js';
import { doctorDay, upcomingWeekCount } from '../services/dashboard.js';
import { changeStatus } from '../services/booking.js';
import { ratingsFor } from '../services/reviews.js';
import { todayPage, clinicsPage, hoursPage, profileEditPage, clinicBookPage, type HoursFormValues, type ClinicBookView } from '../views/pages/dashboard.js';
import { bookByClinic, clampClinicDate, clinicSlots, followUpSource, noShowCounts, ownActiveClinics, CLINIC_BOOKING_DAYS, type ClinicBookingInput } from '../services/clinicBooking.js';
import { doctorInsights, isPeriod } from '../services/insights.js';
import { insightsPage } from '../views/pages/insights.js';
import { activeServices, addService, updateService, listDoctorServices } from '../services/clinicServices.js';
import type { FieldErrors } from '../services/accounts.js';
import { recordPayment, refundPayment, paymentsFor, incomeReport, getReceipt, toCsv } from '../services/payments.js';
import { activeStrikes, bookingsOnDay, cancelDay } from '../services/reliability.js';
import { incomePage, receiptPage } from '../views/pages/payments.js';
import { formatDateTime } from '../i18n/index.js';
import { experienceYears } from '../domain/experience.js';
import { addDays, isValidDate, todayIn } from '../domain/time.js';
import { DomainError, notFound } from '../http/errors.js';
import { countResultsToReview } from '../services/orderResults.js';
import { isUuid } from '../http/router.js';
import { isMessageKey, type MessageKey } from '../i18n/index.js';
import type { AppointmentStatus } from '../domain/appointmentStatus.js';
import { formValue, noticeFrom, errorFrom, uuidParam, startSession } from './helpers.js';

/** Doctors must have verified their phone before using the dashboard. */
/**
 * Where in the doctor's dashboard a page sits:
 *   'doctor'   — the doctor only (default: notes, prescriptions, income, settings, messages);
 *   'schedule' — also the doctor's secretaries (the day, bookings, arrivals, payments);
 *   'files'    — also secretaries the doctor allowed to manage patient files.
 * A secretary gets back the doctor's identity (so every query stays scoped to that doctor);
 * the audit log still records the secretary as the one who acted.
 */
export type DoctorArea = 'doctor' | 'schedule' | 'files';

export function requireDoctor(ctx: Ctx, area: DoctorArea = 'doctor'): SessionUser | null {
  const u = ctx.user;
  if (u?.role === 'assistant') {
    const staff = u.staff;
    if (!staff || area === 'doctor' || (area === 'files' && staff.access !== 'files')) throw forbidden('secretary: not allowed here');
    markActingAssistant(u.id, staff.doctorId);
    return {
      id: staff.doctorId, role: 'doctor', fullName: staff.doctorName, phone: staff.doctorPhone, phoneVerified: true,
      locale: staff.doctorLocale, actingAssistantId: u.id,
    };
  }
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
  const [doctor, ref, clinics, services] = await Promise.all([
    getOwnDoctor(ctx.deps.db, user.id),
    getReference(ctx.deps.db),
    listOwnClinics(ctx.deps.db, user.id),
    listDoctorServices(ctx.deps.db, user.id),
  ]);
  sendHtml(ctx, status, clinicsPage(ctx, doctor, ref, clinics, { notice: ok(ctx), services, ...extra }));
}

async function renderHours(ctx: Ctx, user: SessionUser, extra: { ruleError?: RuleProblem; ruleValues?: HoursFormValues; blockError?: MessageKey } = {}, status = 200): Promise<void> {
  const db = ctx.deps.db;
  const [doctor, clinics, rules, blocks] = await Promise.all([getOwnDoctor(db, user.id), listOwnClinics(db, user.id), listOwnRules(db, user.id), listOwnBlocks(db, user.id)]);
  sendHtml(ctx, status, hoursPage(ctx, doctor, clinics, rules, blocks, { notice: ok(ctx), ...extra }));
}

async function renderProfile(ctx: Ctx, user: SessionUser, extra: { errors?: Record<string, MessageKey>; positionError?: MessageKey; photoError?: MessageKey; social?: Record<'facebook' | 'instagram' | 'tiktok', string> } = {}, status = 200): Promise<void> {
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
    const user = requireDoctor(ctx, 'schedule');
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
    const [ratings, noShows, payments, strikeCounts, confirmedToday, resultsToReview] = await Promise.all([
      ratingsFor(db, [user.id]),
      noShowCounts(db, ctx.deps.cfg.NO_SHOW_WINDOW_DAYS, user.id, appointments.map((a) => ({ patientId: a.patient_id, phone: a.patient_phone }))),
      paymentsFor(db, appointments.map((a) => a.id)),
      activeStrikes(db, ctx.deps.cfg, [user.id]),
      bookingsOnDay(db, user.id, date, tz),
      user.actingAssistantId || !doctor.records_enabled ? Promise.resolve(0) : countResultsToReview(db, user.id),
    ]);
    const strikes = { active: strikeCounts.get(user.id) ?? 0, limit: ctx.deps.cfg.STRIKE_LIMIT };
    const rating = ratings.get(user.id) ?? null;
    sendHtml(ctx, 200, todayPage(ctx, doctor, { date, appointments, weekCount, clinics, rules, rating, noShows, payments, strikes, confirmedToday, resultsToReview, notice: ok(ctx) }));
  });

  r.post('/dashboard/day-off', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const date = formValue(ctx, 'date');
    const back = (q: Record<string, string>) => href(ctx, '/dashboard', { ...(isValidDate(date) ? { date } : {}), ...q });
    try {
      await cancelDay(ctx.deps, user, date, formValue(ctx, 'reason'), ctx.ip);
      redirect(ctx, back({ ok: 'dayCancelled' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, back({ error: isMessageKey(e.messageKey) ? e.messageKey : 'appt.notAllowed' }));
    }
  });

  // --- Payments ------------------------------------------------------------
  r.post('/dashboard/appointments/:id/pay', async (ctx) => {
    const user = requireDoctor(ctx, 'schedule');
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const date = formValue(ctx, 'date');
    const fromIncome = formValue(ctx, 'back') === 'income';
    const back = (q: Record<string, string>) =>
      fromIncome
        ? href(ctx, '/dashboard/income', { from: formValue(ctx, 'from'), to: formValue(ctx, 'to'), ...q })
        : href(ctx, '/dashboard', { ...(isValidDate(date) ? { date } : {}), ...q });
    try {
      await recordPayment(ctx.deps, user, id, { method: formValue(ctx, 'method'), amount: formValue(ctx, 'amount'), note: formValue(ctx, 'note') }, ctx.ip);
      redirect(ctx, back({ ok: 'paid' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, back({ error: isMessageKey(e.messageKey) ? e.messageKey : 'appt.notAllowed' }));
    }
  });

  r.post('/dashboard/payments/:id/refund', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const range = { from: formValue(ctx, 'from'), to: formValue(ctx, 'to') };
    try {
      await refundPayment(ctx.deps, user, uuidParam(ctx, 'id'), formValue(ctx, 'reason'), ctx.ip);
      redirect(ctx, href(ctx, '/dashboard/income', { ...range, ok: 'refunded' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/dashboard/income', { ...range, error: isMessageKey(e.messageKey) ? e.messageKey : 'appt.notAllowed' }));
    }
  });

  /** Date range from ?from&to (local dates), defaulting to this month; at most one year. */
  const incomeRange = (ctx: Ctx) => {
    const today = todayIn(ctx.deps.cfg.TIME_ZONE, ctx.deps.now());
    let from = ctx.query.get('from') ?? '';
    let to = ctx.query.get('to') ?? '';
    if (!isValidDate(from)) from = `${today.slice(0, 7)}-01`;
    if (!isValidDate(to)) to = today;
    if (from > to) [from, to] = [to, from];
    if (addDays(from, 366) < to) from = addDays(to, -366);
    return { today, from, to };
  };

  r.post('/dashboard/photo', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const problem = await setDoctorPhoto(ctx.deps, user.id, ctx.files.find((f) => f.field === 'photo'), ctx.ip);
    if (problem) return renderProfile(ctx, user, { photoError: problem }, 422);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'photoSaved' }));
  });

  r.post('/dashboard/photo/delete', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    await removeDoctorPhoto(ctx.deps, user.id, ctx.ip);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'photoRemoved' }));
  });

  // ---- Team: the doctor's secretaries
  const renderTeam = async (ctx: Ctx, user: SessionUser, extra: Partial<Parameters<typeof teamPage>[3]> = {}, status = 200) =>
    sendHtml(ctx, status, teamPage(ctx, await getOwnDoctor(ctx.deps.db, user.id), await listTeam(ctx.deps.db, user.id), { notice: ok(ctx), ...extra }));
  const inviteLink = (ctx: Ctx, token: string) => `${ctx.deps.cfg.PUBLIC_ORIGIN}${href(ctx, `/team/join/${token}`)}`;

  r.get('/dashboard/team', async (ctx) => {
    const user = requireDoctor(ctx);
    if (user) await renderTeam(ctx, user);
  });

  r.post('/dashboard/team', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const values = { fullName: formValue(ctx, 'fullName'), phone: formValue(ctx, 'phone'), access: formValue(ctx, 'access') };
    const result = await addTeamMember(ctx.deps, user.id, values, ctx.ip);
    if ('errors' in result) return renderTeam(ctx, user, { values, errors: result.errors }, 422);
    // The link is shown once, on this page (never put in an address or stored readable).
    await renderTeam(ctx, user, { invite: { link: inviteLink(ctx, result.token), name: result.name } });
  });

  r.post('/dashboard/team/:id/access', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const err = await setTeamAccess(ctx.deps, user.id, uuidParam(ctx, 'id'), formValue(ctx, 'access'), ctx.ip);
    redirect(ctx, href(ctx, '/dashboard/team', err ? { error: err } : { ok: 'teamUpdated' }));
  });

  r.post('/dashboard/team/:id/reinvite', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const result = await reinviteTeamMember(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    await renderTeam(ctx, user, { invite: { link: inviteLink(ctx, result.token), name: result.name } });
  });

  r.post('/dashboard/team/:id/remove', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    await removeTeamMember(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/dashboard/team', { ok: 'teamRemoved' }));
  });

  // The secretary opens the doctor's invite link and chooses a password.
  r.get('/team/join/:token', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const invite = await findInvite(ctx.deps.db, token);
    sendHtml(ctx, invite ? 200 : 410, teamJoinPage(ctx, invite ? { token, name: invite.full_name, doctor: invite.doctor_name, phone: invite.phone_e164 } : null));
  });

  r.post('/team/join/:token', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const result = await acceptInvite(ctx.deps, token, formValue(ctx, 'password'), ctx.ip);
    if ('error' in result) {
      const invite = await findInvite(ctx.deps.db, token);
      return sendHtml(ctx, 422, teamJoinPage(ctx, invite ? { token, name: invite.full_name, doctor: invite.doctor_name, phone: invite.phone_e164, error: result.error } : null));
    }
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, result.userId, 'assistant');
    redirect(ctx, href(ctx, '/dashboard'));
  });

  r.post('/dashboard/settings/instapay', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const err = await setInstapayAddress(ctx.deps, user.id, formValue(ctx, 'instapay').slice(0, 120), ctx.ip);
    redirect(ctx, href(ctx, '/dashboard/profile', err ? { error: err } : { ok: 'instapay' }));
  });

  r.post('/dashboard/settings/income', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const show = formValue(ctx, 'show') === 'yes';
    await setShowIncome(ctx.deps, user.id, show, ctx.ip);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: show ? 'incomeOn' : 'incomeOff' }));
  });

  r.get('/dashboard/income', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    if (!(await getOwnDoctor(ctx.deps.db, user.id)).show_income) return redirect(ctx, href(ctx, '/dashboard/profile', { error: 'dash.incomeIsOff' }));
    const { today, from, to } = incomeRange(ctx);
    const [doctor, report] = await Promise.all([getOwnDoctor(ctx.deps.db, user.id), incomeReport(ctx.deps.db, user.id, from, to, ctx.deps.cfg.TIME_ZONE)]);
    sendHtml(ctx, 200, incomePage(ctx, doctor, report, { today, notice: ok(ctx) }));
  });

  r.get('/dashboard/income.csv', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const { from, to } = incomeRange(ctx);
    const tz = ctx.deps.cfg.TIME_ZONE;
    const report = await incomeReport(ctx.deps.db, user.id, from, to, tz);
    const t = ctx.t;
    const csv = toCsv([
      [t('pay.paidAt'), t('pay.receiptPatient'), t('pay.visit'), t('dash.clinic'), t('pay.method'), t('pay.amount'), t('dash.status'), t('pay.refundReason')],
      ...report.rows.map((p) => [
        formatDateTime(p.paid_at, ctx.locale, tz), p.patient_name, formatDateTime(p.visit_at, ctx.locale, tz), p.clinic_name,
        t(`pay.method.${p.method}` as MessageKey), p.amount_egp, t(p.status === 'paid' ? 'pay.paid' : 'pay.refunded'), p.refund_reason ?? '',
      ]),
    ]);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="tabeeby-income-${from}-to-${to}.csv"`);
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.end(csv);
  });

  r.get('/dashboard/appointments/:id/receipt', async (ctx) => {
    const user = requireDoctor(ctx, 'schedule');
    if (!user) return;
    const receipt = await getReceipt(ctx.deps.db, user, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, receiptPage(ctx, receipt, href(ctx, '/dashboard/income')));
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
    const [slots, services, open] = await Promise.all([
      clinicSlots(ctx.deps, db, user.id, clinic.id, date),
      activeServices(db, [clinic.id]),
      db.query<{ weekday: number }>('select distinct weekday from schedule_rules where clinic_id = $1', [clinic.id]),
    ]);
    const lastDate = addDays(today, CLINIC_BOOKING_DAYS);
    // Month shown in the calendar: ?month=YYYY-MM within the bookable range, else the chosen day's month.
    const askedMonth = ctx.query.get('month') ?? '';
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(askedMonth) && askedMonth >= today.slice(0, 7) && askedMonth <= lastDate.slice(0, 7) ? askedMonth : date.slice(0, 7);
    sendHtml(ctx, status, clinicBookPage(ctx, doctor, {
      clinics, clinicId: clinic.id, date, today, lastDate, slots, source, services, month,
      openWeekdays: new Set(open.rows.map((r) => Number(r.weekday))),
      ...extra,
    }));
  };

  r.get('/dashboard/book', async (ctx) => {
    const user = requireDoctor(ctx, 'schedule');
    if (!user) return;
    const clinic = ctx.query.get('clinic');
    const from = ctx.query.get('from');
    await renderClinicBook(ctx, user, { clinicId: isUuid(clinic) ? clinic : null, date: ctx.query.get('date') ?? '', fromId: isUuid(from) ? from : null });
  });

  r.post('/dashboard/book', async (ctx) => {
    const user = requireDoctor(ctx, 'schedule');
    if (!user) return;
    const clinicId = formValue(ctx, 'clinic');
    const from = formValue(ctx, 'from');
    const startRaw = formValue(ctx, 'start');
    if (!isUuid(clinicId)) throw notFound();
    const fromId = isUuid(from) ? from : null;
    const values = Object.fromEntries(['name', 'phone', 'visitType', 'reason', 'start'].map((k) => [k, formValue(ctx, k)]));
    const back = { clinicId, date: formValue(ctx, 'date'), fromId };
    if (!startRaw) return renderClinicBook(ctx, user, back, { values, errors: { start: 'cbook.pickTime' } satisfies FieldErrors }, 422);
    // "new", "follow_up", or "svc:<id>" for one of the clinic's services (checked again by the service layer).
    const kind = values['visitType'] ?? '';
    const serviceId = kind.startsWith('svc:') && isUuid(kind.slice(4)) ? kind.slice(4) : undefined;
    const input: ClinicBookingInput = {
      clinicId,
      startsAt: new Date(startRaw),
      visitType: serviceId ? 'service' : kind === 'follow_up' ? 'follow_up' : 'new',
      serviceId,
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
    const user = requireDoctor(ctx, 'schedule');
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const to = formValue(ctx, 'to') as AppointmentStatus;
    const date = formValue(ctx, 'date');
    const back = (q: Record<string, string>) => href(ctx, '/dashboard', { ...(isValidDate(date) ? { date } : {}), ...q });
    if (!STATUSES.includes(to)) return redirect(ctx, back({ error: 'appt.notAllowed' }));
    try {
      await changeStatus(ctx.deps, user, id, to, ctx.ip, formValue(ctx, 'cancelKind') === 'patient_request' ? 'patient_request' : 'clinic');
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

  // ---- the doctor's own services per clinic (besides consultation and follow-up)
  r.post('/dashboard/clinics/:id/services', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const clinicId = uuidParam(ctx, 'id');
    const values = { serviceName: formValue(ctx, 'serviceName'), serviceNameAr: formValue(ctx, 'serviceNameAr'), servicePrice: formValue(ctx, 'servicePrice') };
    const errors = await addService(ctx.deps, user.id, clinicId, { name: values.serviceName, nameAr: values.serviceNameAr, price: values.servicePrice }, ctx.ip);
    if (errors) return renderClinics(ctx, user, { serviceErrors: errors, serviceTarget: `new:${clinicId}`, serviceValues: values }, 422);
    redirect(ctx, href(ctx, '/dashboard/clinics', { ok: 'serviceSaved' }) + `#services-${clinicId}`);
  });

  r.post('/dashboard/services/:id', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const values = { serviceName: formValue(ctx, 'serviceName'), serviceNameAr: formValue(ctx, 'serviceNameAr'), servicePrice: formValue(ctx, 'servicePrice'), active: formValue(ctx, 'active') };
    const errors = await updateService(ctx.deps, user.id, id, { name: values.serviceName, nameAr: values.serviceNameAr, price: values.servicePrice, active: values.active === 'yes' }, ctx.ip);
    if (errors) return renderClinics(ctx, user, { serviceErrors: errors, serviceTarget: id, serviceValues: values }, 422);
    redirect(ctx, href(ctx, '/dashboard/clinics', { ok: 'serviceSaved' }));
  });

  // ---- insights: who the patients are and how the clinic is used (counts only)
  r.get('/dashboard/insights', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const p = ctx.query.get('period') ?? '';
    const period = isPeriod(p) ? p : '90d';
    const [doctor, data] = await Promise.all([
      getOwnDoctor(ctx.deps.db, user.id),
      doctorInsights(ctx.deps.db, user.id, period, ctx.deps.now(), ctx.deps.cfg.TIME_ZONE),
    ]);
    sendHtml(ctx, 200, insightsPage(ctx, doctor, data));
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
      social: { facebook: formValue(ctx, 'facebook'), instagram: formValue(ctx, 'instagram'), tiktok: formValue(ctx, 'tiktok') },
    });
    if (Object.keys(errors).length) return renderProfile(ctx, user, { errors: errors as Record<string, MessageKey>, social: { facebook: formValue(ctx, 'facebook'), instagram: formValue(ctx, 'instagram'), tiktok: formValue(ctx, 'tiktok') } }, 422);
    redirect(ctx, href(ctx, '/dashboard/profile', { ok: 'saved' }));
  });

  r.post('/dashboard/profile/positions', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const problem = await addPosition(ctx.deps, user.id, {
      title: formValue(ctx, 'posTitle'),
      workplace: formValue(ctx, 'posWorkplace'),
      start: yearToMonth(formValue(ctx, 'posStart'), 'start', ctx.deps.now()),
      end: formValue(ctx, 'posEnd') ? yearToMonth(formValue(ctx, 'posEnd'), 'end', ctx.deps.now()) : '',
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
