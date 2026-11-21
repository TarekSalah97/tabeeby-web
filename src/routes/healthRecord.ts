import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { notFound } from '../http/errors.js';
import { isUuid } from '../http/router.js';
import type { MessageKey } from '../i18n/index.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';
import { patientGatePage } from '../views/pages/auth.js';
import { getOwnFacility, offersTests } from '../services/facilities.js';
import {
  patientHealthRecord, patientOrderPart, centreChoices, sendOrderPart, cancelOrderPart, isSection,
  listCentreRequests, getCentreRequest, markReceived, addResultFile, removeResultFile, markReady, readResultFile, type ResultViewer,
} from '../services/orderResults.js';
import { healthRecordPage, sendOrderPage, centreRequestsPage, centreRequestPage, isHealthTab } from '../views/pages/healthRecord.js';

function notice(ctx: Ctx): { kind: 'success' | 'error'; key: MessageKey } | undefined {
  const n = noticeFrom(ctx);
  if (n) return { kind: 'success', key: n };
  const e = errorFrom(ctx);
  return e ? { kind: 'error', key: e } : undefined;
}

function sectionParam(ctx: Ctx) {
  const s = ctx.params['section'] ?? '';
  if (!isSection(s)) throw notFound();
  return s;
}

/** A signed-in lab or scan centre (pharmacies have no test requests). */
async function requireCentre(ctx: Ctx) {
  const user = requireUser(ctx, 'facility');
  const f = await getOwnFacility(ctx.deps.db, user.id);
  if (!offersTests(f.kind)) throw notFound();
  return f;
}

export function healthRecordRoutes(r: Router): void {
  // ---- patient: one place for prescriptions, lab tests and imaging
  r.get('/health-record', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'prescriptions', ctx.path));
    const tab = ctx.query.get('tab') ?? '';
    sendHtml(ctx, 200, healthRecordPage(ctx, await patientHealthRecord(ctx.deps.db, ctx.user.id), isHealthTab(tab) ? tab : 'prescriptions', notice(ctx)));
  });

  // The old address keeps working.
  r.get('/prescriptions', async (ctx) => redirect(ctx, href(ctx, '/health-record')));

  r.get('/health-record/orders/:id/:section/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const part = await patientOrderPart(ctx.deps.db, user.id, uuidParam(ctx, 'id'), sectionParam(ctx));
    if (part.request) return redirect(ctx, href(ctx, '/health-record', { tab: part.section }));
    sendHtml(ctx, 200, sendOrderPage(ctx, part, await centreChoices(ctx.deps.db, part)));
  });

  r.post('/health-record/orders/:id/:section/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    const section = sectionParam(ctx);
    const facility = formValue(ctx, 'facility');
    const problem = isUuid(facility) ? await sendOrderPart(ctx.deps, user.id, id, section, facility, ctx.ip) : 'hr.err.chooseCentre';
    if (problem) {
      const part = await patientOrderPart(ctx.deps.db, user.id, id, section);
      return sendHtml(ctx, 422, sendOrderPage(ctx, part, await centreChoices(ctx.deps.db, part), problem));
    }
    redirect(ctx, href(ctx, '/health-record', { tab: section, ok: 'orderSent' }));
  });

  r.post('/health-record/requests/:id/cancel', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const problem = await cancelOrderPart(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    const back = ctx.query.get('tab') ?? '';
    redirect(ctx, href(ctx, '/health-record', { ...(isHealthTab(back) ? { tab: back } : {}), ...(problem ? { error: problem } : { ok: 'orderCancelled' }) }));
  });

  // ---- one result file: the patient, the centre that uploaded it, or the ordering doctor
  r.get('/results/:id', async (ctx) => {
    const u = ctx.user;
    if (!u) throw notFound();
    const viewer: ResultViewer | null =
      u.role === 'patient' ? { patientId: u.id } : u.role === 'facility' ? { facilityId: u.id } : u.role === 'doctor' ? { doctorId: u.id } : null;
    if (!viewer) throw notFound();
    const file = await readResultFile(ctx.deps, viewer, uuidParam(ctx, 'id'), ctx.ip);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', file.mime);
    ctx.res.setHeader('Content-Disposition', 'inline');
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'self'; plugin-types application/pdf; sandbox");
    ctx.res.setHeader('Cache-Control', 'private, no-store');
    ctx.res.end(file.data);
  });

  // ---- lab / scan centre
  r.get('/facility/requests', async (ctx) => {
    const f = await requireCentre(ctx);
    sendHtml(ctx, 200, centreRequestsPage(ctx, f, await listCentreRequests(ctx.deps.db, f.user_id), notice(ctx)));
  });

  r.get('/facility/requests/:id', async (ctx) => {
    const f = await requireCentre(ctx);
    sendHtml(ctx, 200, centreRequestPage(ctx, f, await getCentreRequest(ctx.deps.db, f.user_id, uuidParam(ctx, 'id')), notice(ctx)));
  });

  r.post('/facility/requests/:id/received', async (ctx) => {
    const f = await requireCentre(ctx);
    const id = uuidParam(ctx, 'id');
    await markReceived(ctx.deps, f.user_id, id, ctx.ip);
    redirect(ctx, href(ctx, `/facility/requests/${id}`, { ok: 'orderReceived' }));
  });

  r.post('/facility/requests/:id/results', async (ctx) => {
    const f = await requireCentre(ctx);
    const id = uuidParam(ctx, 'id');
    const problem = await addResultFile(ctx.deps, f.user_id, id, ctx.files.find((x) => x.field === 'file'), ctx.ip);
    redirect(ctx, href(ctx, `/facility/requests/${id}`, problem ? { error: problem } : { ok: 'resultAdded' }));
  });

  r.post('/facility/results/:id/remove', async (ctx) => {
    const f = await requireCentre(ctx);
    const resultId = uuidParam(ctx, 'id');
    const { rows } = await ctx.deps.db.query<{ request_id: string }>(
      'select r.request_id from order_results r join order_requests q on q.id = r.request_id where r.id = $1 and q.facility_id = $2',
      [resultId, f.user_id],
    );
    if (!rows[0]) throw notFound();
    await removeResultFile(ctx.deps, f.user_id, resultId, ctx.ip);
    redirect(ctx, href(ctx, `/facility/requests/${rows[0].request_id}`, { ok: 'resultRemoved' }));
  });

  r.post('/facility/requests/:id/ready', async (ctx) => {
    const f = await requireCentre(ctx);
    const id = uuidParam(ctx, 'id');
    const problem = await markReady(ctx.deps, f.user_id, id, formValue(ctx, 'note'), ctx.ip);
    redirect(ctx, href(ctx, problem ? `/facility/requests/${id}` : '/facility/requests', problem ? { error: problem } : { ok: 'resultsReleased' }));
  });
}
