import { labInsights, pharmacyInsights } from '../services/facilityInsights.js';
import { isPeriod } from '../services/insights.js';
import { facilityInsightsPage } from '../views/pages/facilityInsights.js';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { applyDocumentHeaders } from '../http/security.js';
import { field, fieldAll } from '../http/body.js';
import type { SessionUser } from '../auth/sessions.js';
import { destroySession } from '../auth/sessions.js';
import { getReference } from '../services/reference.js';
import {
  registerFacility, getOwnFacility, updateFacilityProfile, listOwnBranches, saveBranch, deleteBranch, listOwnTests, saveTestPrices, listExtraTests, addExtraTest, updateExtraTest, deleteExtraTest,
  searchFacilities, getPublicFacility, listFacilitiesForReview, getFacilityForReview, decideFacility, isFacilityDecision, readFacilityDocument,
  FACILITY_KINDS, type BranchInput, type FacilityKind,
} from '../services/facilities.js';
import {
  facilityJoinPage, facilityProfilePage, facilityBranchesPage, facilityPricesPage, facilityListPage, facilityPublicPage, KIND_PATH,
} from '../views/pages/facilities.js';
import { adminFacilitiesPage, adminFacilityPage } from '../views/pages/admin.js';
import { DomainError, notFound } from '../http/errors.js';
import { isMessageKey, type MessageKey } from '../i18n/index.js';
import { formValue, noticeFrom, errorFrom, uuidParam, startSession } from './helpers.js';
import type { FieldErrors } from '../services/accounts.js';

const SLUG_RE = /^[a-z0-9-]{3,80}$/;
const TEST_RE = /^[a-z0-9_]{2,40}$/;

function notice(ctx: Ctx): { kind: 'success' | 'error'; key: MessageKey } | undefined {
  const n = noticeFrom(ctx);
  if (n) return { kind: 'success', key: n };
  const e = errorFrom(ctx);
  return e ? { kind: 'error', key: e } : undefined;
}

const requireFacility = (ctx: Ctx): SessionUser => requireUser(ctx, 'facility');

/** Tests from "?tests=cbc,hba1c" (from a patient's lab request), at most 30. */
const testsParam = (ctx: Ctx): string[] =>
  [...new Set((ctx.query.get('tests') ?? '').split(',').map((s) => s.trim()).filter((s) => TEST_RE.test(s)))].slice(0, 30);

function branchInput(ctx: Ctx): BranchInput {
  return {
    name: formValue(ctx, 'name'),
    districtId: Number(formValue(ctx, 'district')),
    address: formValue(ctx, 'address'),
    phone: formValue(ctx, 'phone'),
    open24h: formValue(ctx, 'open24h') === 'yes',
    days: fieldAll(ctx.form, 'days'),
    opens: formValue(ctx, 'opens'),
    closes: formValue(ctx, 'closes'),
    isActive: formValue(ctx, 'active') === 'yes',
  };
}

export function facilityRoutes(r: Router): void {
  // --- Sign-up ------------------------------------------------------------
  r.get('/facilities/join', async (ctx) => {
    if (ctx.user?.role === 'facility') return redirect(ctx, href(ctx, '/facility'));
    const kind = ctx.query.get('kind') ?? '';
    sendHtml(ctx, 200, facilityJoinPage(ctx, { values: (FACILITY_KINDS as readonly string[]).includes(kind) ? { kind } : {} }));
  });

  r.post('/facilities/join', async (ctx) => {
    const f = ctx.form;
    const values = Object.fromEntries(['kind', 'name', 'contactName', 'phone', 'email', 'licenceNumber'].map((k) => [k, field(f, k)]));
    const result = await registerFacility(ctx.deps, {
      kind: values['kind']!,
      name: values['name']!,
      contactName: values['contactName']!,
      phone: values['phone']!,
      email: values['email']!,
      password: f['password']?.[0] ?? '',
      licenceNumber: values['licenceNumber']!,
      files: ctx.files,
      consent: field(f, 'consent') === 'yes',
      locale: ctx.locale,
      ip: ctx.ip,
    });
    if ('errors' in result) return sendHtml(ctx, 422, facilityJoinPage(ctx, { values, errors: result.errors }));
    if (ctx.session) await destroySession(ctx.deps.db, ctx.session.id);
    await startSession(ctx, result.userId, 'facility');
    redirect(ctx, href(ctx, '/facility', { ok: 'facilityJoined' }));
  });

  // --- The facility's dashboard --------------------------------------------
  const renderProfile = async (ctx: Ctx, user: SessionUser, extra: { values?: Record<string, string>; errors?: FieldErrors } = {}, status = 200) => {
    const db = ctx.deps.db;
    const [f, branches, tests] = await Promise.all([getOwnFacility(db, user.id), listOwnBranches(db, user.id), listOwnTests(db, user.id)]);
    sendHtml(ctx, status, facilityProfilePage(ctx, f, { branches: branches.length, tests: tests.size, notice: notice(ctx), ...extra }));
  };

  r.get('/facility', async (ctx) => renderProfile(ctx, requireFacility(ctx)));

  r.post('/facility', async (ctx) => {
    const user = requireFacility(ctx);
    const values = Object.fromEntries(['name', 'description', 'phone', 'whatsapp', 'homeService'].map((k) => [k, formValue(ctx, k)]));
    const errors = await updateFacilityProfile(
      ctx.deps, user.id,
      { name: values['name']!, description: values['description']!, phone: values['phone']!, whatsapp: values['whatsapp']!, homeService: values['homeService'] === 'yes' },
      ctx.ip,
    );
    if (Object.keys(errors).length) return renderProfile(ctx, user, { values, errors }, 422);
    redirect(ctx, href(ctx, '/facility', { ok: 'saved' }));
  });

  const renderBranches = async (ctx: Ctx, user: SessionUser, extra: Parameters<typeof facilityBranchesPage>[4] = {}, status = 200) => {
    const db = ctx.deps.db;
    const [f, ref, branches] = await Promise.all([getOwnFacility(db, user.id), getReference(db), listOwnBranches(db, user.id)]);
    sendHtml(ctx, status, facilityBranchesPage(ctx, f, ref, branches, { notice: notice(ctx), ...extra }));
  };
  const rawBranch = (ctx: Ctx) => ({
    ...Object.fromEntries(['name', 'district', 'address', 'phone', 'open24h', 'opens', 'closes', 'active'].map((k) => [k, formValue(ctx, k)])),
    days: fieldAll(ctx.form, 'days'),
  });

  r.get('/facility/branches', async (ctx) => renderBranches(ctx, requireFacility(ctx)));

  const postBranch = async (ctx: Ctx, branchId: string | null) => {
    const user = requireFacility(ctx);
    try {
      const errors = await saveBranch(ctx.deps, user.id, branchId, branchInput(ctx), ctx.ip);
      if (Object.keys(errors).length) return renderBranches(ctx, user, { errors, values: rawBranch(ctx), editing: branchId }, 422);
      redirect(ctx, href(ctx, '/facility/branches', { ok: 'saved' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/facility/branches', { error: e.messageKey }));
    }
  };
  r.post('/facility/branches', async (ctx) => postBranch(ctx, null));
  r.post('/facility/branches/:id', async (ctx) => postBranch(ctx, uuidParam(ctx, 'id')));
  r.post('/facility/branches/:id/delete', async (ctx) => {
    const user = requireFacility(ctx);
    await deleteBranch(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/facility/branches', { ok: 'deleted' }));
  });

  r.get('/facility/prices', async (ctx) => {
    const user = requireFacility(ctx);
    const [f, prices, extras] = await Promise.all([getOwnFacility(ctx.deps.db, user.id), listOwnTests(ctx.deps.db, user.id), listExtraTests(ctx.deps.db, user.id)]);
    if (f.kind === 'pharmacy') throw notFound();
    sendHtml(ctx, 200, facilityPricesPage(ctx, f, prices, { notice: notice(ctx), extras }));
  });

  r.post('/facility/prices', async (ctx) => {
    const user = requireFacility(ctx);
    const f = await getOwnFacility(ctx.deps.db, user.id);
    const values = Object.fromEntries(Object.keys(ctx.form).filter((k) => k.startsWith('price_')).map((k) => [k, formValue(ctx, k)]));
    const prices = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.slice('price_'.length), v]));
    const errors = await saveTestPrices(ctx.deps, f, prices, ctx.ip);
    if (Object.keys(errors).length) {
      return sendHtml(ctx, 422, facilityPricesPage(ctx, f, await listOwnTests(ctx.deps.db, user.id), { values, errors, extras: await listExtraTests(ctx.deps.db, user.id) }));
    }
    redirect(ctx, href(ctx, '/facility/prices', { ok: 'saved' }));
  });

  r.get('/facility/insights', async (ctx) => {
    const user = requireFacility(ctx);
    const f = await getOwnFacility(ctx.deps.db, user.id);
    const raw = ctx.query.get('period') ?? '90d';
    const period = isPeriod(raw) ? raw : '90d';
    const load = f.kind === 'pharmacy' ? pharmacyInsights : labInsights;
    sendHtml(ctx, 200, facilityInsightsPage(ctx, f, await load(ctx.deps.db, user.id, period, ctx.deps.now(), ctx.deps.cfg.TIME_ZONE)));
  });

  // Tests the lab or scan centre adds itself, beyond the built-in list.
  r.post('/facility/extra-tests', async (ctx) => {
    const user = requireFacility(ctx);
    const f = await getOwnFacility(ctx.deps.db, user.id);
    const values = { extraName: formValue(ctx, 'extraName'), extraPrice: formValue(ctx, 'extraPrice'), extraNote: formValue(ctx, 'extraNote') };
    const errors = await addExtraTest(ctx.deps, f, { name: values.extraName, price: values.extraPrice, note: values.extraNote }, ctx.ip);
    if (Object.keys(errors).length) {
      const [prices, extras] = await Promise.all([listOwnTests(ctx.deps.db, user.id), listExtraTests(ctx.deps.db, user.id)]);
      return sendHtml(ctx, 422, facilityPricesPage(ctx, f, prices, { values, errors, extras }));
    }
    redirect(ctx, href(ctx, '/facility/prices', { ok: 'extraAdded' }) + '#extra');
  });

  r.post('/facility/extra-tests/:id', async (ctx) => {
    const user = requireFacility(ctx);
    const ok = await updateExtraTest(ctx.deps, user.id, uuidParam(ctx, 'id'), { price: formValue(ctx, 'price'), note: formValue(ctx, 'note') }, ctx.ip);
    redirect(ctx, href(ctx, '/facility/prices', ok ? { ok: 'extraUpdated' } : { error: 'clinics.feeInvalid' }) + '#extra');
  });

  r.post('/facility/extra-tests/:id/delete', async (ctx) => {
    const user = requireFacility(ctx);
    await deleteExtraTest(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/facility/prices', { ok: 'extraDeleted' }) + '#extra');
  });

  // --- Public pages ---------------------------------------------------------
  for (const kind of FACILITY_KINDS) {
    const base = KIND_PATH[kind];
    r.get(base, async (ctx) => {
      const ref = await getReference(ctx.deps.db);
      const district = Number(ctx.query.get('district'));
      const search = {
        kind: kind as FacilityKind,
        districtId: ref.districtById.has(district) ? district : null,
        openNow: ctx.query.get('open') === '1',
        homeService: ctx.query.get('home') === '1',
        tests: kind === 'pharmacy' ? [] : testsParam(ctx),
        q: (ctx.query.get('q') ?? '').slice(0, 80),
      };
      sendHtml(ctx, 200, facilityListPage(ctx, ref, search, await searchFacilities(ctx.deps, search)));
    });
    r.get(`${base}/:slug`, async (ctx) => {
      const slug = ctx.params['slug'] ?? '';
      if (!SLUG_RE.test(slug)) throw notFound();
      const p = await getPublicFacility(ctx.deps, slug, ctx.user?.id ?? null);
      if (p.kind !== kind) return redirect(ctx, href(ctx, `${KIND_PATH[p.kind]}/${p.slug}`), 301);
      sendHtml(ctx, 200, facilityPublicPage(ctx, await getReference(ctx.deps.db), p, testsParam(ctx)));
    });
  }

  // --- Admin ----------------------------------------------------------------
  r.get('/admin/facilities', async (ctx) => {
    requireUser(ctx, 'admin');
    sendHtml(ctx, 200, adminFacilitiesPage(ctx, await listFacilitiesForReview(ctx.deps.db), noticeFrom(ctx) ?? undefined));
  });

  r.get('/admin/facilities/:id', async (ctx) => {
    requireUser(ctx, 'admin');
    const [ref, f] = await Promise.all([getReference(ctx.deps.db), getFacilityForReview(ctx.deps.db, uuidParam(ctx, 'id'))]);
    sendHtml(ctx, 200, adminFacilityPage(ctx, ref, f, errorFrom(ctx) ?? undefined));
  });

  r.post('/admin/facilities/:id/:decision', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    const decision = ctx.params['decision'] ?? '';
    if (!isFacilityDecision(decision)) throw notFound();
    try {
      await decideFacility(ctx.deps, admin.id, id, decision, formValue(ctx, 'note'), ctx.ip);
      redirect(ctx, href(ctx, '/admin/facilities', { ok: 'done' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, `/admin/facilities/${id}`, { error: isMessageKey(e.messageKey) ? e.messageKey : 'appt.notAllowed' }));
    }
  });

  r.get('/admin/facility-documents/:id', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const doc = await readFacilityDocument(ctx.deps, admin.id, uuidParam(ctx, 'id'), ctx.ip);
    applyDocumentHeaders(ctx.res);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', doc.mime);
    ctx.res.setHeader('Content-Disposition', 'inline');
    ctx.res.end(doc.data);
  });
}
