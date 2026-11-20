import type { Router } from '../http/router.js';
import { sendHtml, sendJson } from '../http/respond.js';
import { getReference } from '../services/reference.js';
import { searchDoctors, getPublicProfile, type SearchFilters } from '../services/search.js';
import { slotsForDoctors } from '../services/availability.js';
import { homePage, searchPage, profilePage, legalPage, groupDays } from '../views/pages/public.js';
import { forDoctorsPage } from '../views/pages/forDoctors.js';
import { notFound } from '../http/errors.js';
import { isValidDate } from '../domain/time.js';
import { errorFrom, noticeFrom } from './helpers.js';
import { listDoctorReviews } from '../services/reviews.js';
import { fullDays, waitingDates } from '../services/waitlist.js';
import { recentDoctors, nextVisit } from '../services/patientHome.js';

export function publicRoutes(r: Router): void {
  r.get('/', async (ctx) => {
    const ref = await getReference(ctx.deps.db);
    const user = ctx.user;
    const patient =
      user?.role === 'patient'
        ? await Promise.all([recentDoctors(ctx.deps.db, user.id), nextVisit(ctx.deps.db, user.id)]).then(([recent, next]) => ({ recent, next }))
        : undefined;
    sendHtml(ctx, 200, homePage(ctx, ref, patient));
  });

  r.get('/search', async (ctx) => {
    const ref = await getReference(ctx.deps.db);
    const q = ctx.query;
    const specialty = ref.specialties.find((s) => s.slug === q.get('specialty'));
    const sub = specialty?.subspecialties.find((s) => s.slug === q.get('sub'));
    const district = ref.districts.find((d) => d.slug === q.get('district'));
    const insurer = ref.insurers.find((i) => i.slug === q.get('insurer'));
    const page = Number.parseInt(q.get('page') ?? '1', 10);
    const filters: SearchFilters = {
      q: (q.get('q') ?? '').slice(0, 80),
      specialtyId: specialty?.id ?? null,
      subspecialtyId: sub?.id ?? null,
      districtId: district?.id ?? null,
      insurerId: insurer?.id ?? null,
      page: Number.isFinite(page) && page > 0 && page < 1000 ? page : 1,
    };
    const result = await searchDoctors(ctx.deps, filters);
    sendHtml(ctx, 200, searchPage(ctx, ref, { ...filters, page: Math.min(filters.page, Math.max(1, result.pages)) }, result));
  });

  r.get('/doctors/:slug', async (ctx) => {
    const slug = ctx.params['slug'] ?? '';
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw notFound();
    const now = ctx.deps.now();
    const doctor = await getPublicProfile(ctx.deps.db, slug, now);
    if (!doctor) throw notFound();
    const ref = await getReference(ctx.deps.db);

    const all = (await slotsForDoctors(ctx.deps.db, ctx.deps.cfg, [doctor.id], { days: ctx.deps.cfg.BOOKING_HORIZON_DAYS, now })).get(doctor.id) ?? [];
    const requestedClinic = ctx.query.get('clinic');
    const clinicId =
      doctor.clinics.find((c) => c.id === requestedClinic)?.id ??
      doctor.clinics.find((c) => all.some((s) => s.clinicId === c.id))?.id ??
      doctor.clinics[0]?.id ??
      '';
    const slots = all.filter((s) => s.clinicId === clinicId);
    const days = groupDays(slots);
    const requestedDate = ctx.query.get('date') ?? '';
    const date = isValidDate(requestedDate) && days.some((d) => d.date === requestedDate) ? requestedDate : (days[0]?.date ?? '');
    const [reviews, full, waiting] = await Promise.all([
      listDoctorReviews(ctx.deps.db, doctor.id),
      clinicId ? fullDays(ctx.deps, ctx.deps.db, doctor.id, clinicId) : Promise.resolve([]),
      clinicId && ctx.user?.role === 'patient' ? waitingDates(ctx.deps, ctx.user.id, clinicId) : Promise.resolve([]),
    ]);
    sendHtml(
      ctx,
      200,
      profilePage(ctx, ref, doctor, { clinicId, date, slots, days, error: errorFrom(ctx), notice: noticeFrom(ctx), fullDays: full, waiting }, reviews),
    );
  });

  r.get('/for-doctors', async (ctx) => {
    sendHtml(ctx, 200, forDoctorsPage(ctx));
  });

  r.get('/privacy', async (ctx) => sendHtml(ctx, 200, legalPage(ctx, 'privacy')));
  r.get('/terms', async (ctx) => sendHtml(ctx, 200, legalPage(ctx, 'terms')));

  /** Liveness + database readiness for the load balancer / uptime monitor. */
  r.get('/healthz', async (ctx) => {
    try {
      await ctx.deps.db.query('select 1');
      sendJson(ctx, 200, { ok: true });
    } catch {
      sendJson(ctx, 503, { ok: false });
    }
  });
}
