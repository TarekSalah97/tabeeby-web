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
  listCentreRequests, getCentreRequest, markReceived, markSampleTaken, patientKidneyResults, addResultFile, removeResultFile, markReady, readResultFile, type ResultViewer,
} from '../services/orderResults.js';
import { createLinkCode } from '../services/accountLink.js';
import { healthRecordPage, sendOrderPage, centreRequestsPage, centreRequestPage, isHealthTab, sendToPharmacyPage, pharmacyInboxPage, pharmacyRequestPage } from '../views/pages/healthRecord.js';
import {
  patientPrescription, pharmacyChoices, sendToPharmacy, cancelPharmacyRequest, listPharmacyInbox, getPharmacyRequest, replyToRequest, completeRequest,
} from '../services/pharmacyRequests.js';

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

/** A signed-in pharmacy. */
async function requirePharmacy(ctx: Ctx) {
  const user = requireUser(ctx, 'facility');
  const f = await getOwnFacility(ctx.deps.db, user.id);
  if (f.kind !== 'pharmacy') throw notFound();
  return f;
}

export function healthRecordRoutes(r: Router): void {
  // ---- patient → pharmacy: send a prescription, see the answer
  r.get('/health-record/prescriptions/:id/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const rx = await patientPrescription(ctx.deps.db, user.id, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, sendToPharmacyPage(ctx, rx, await pharmacyChoices(ctx.deps.db)));
  });

  r.post('/health-record/prescriptions/:id/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    const values = { facility: formValue(ctx, 'facility'), delivery: formValue(ctx, 'delivery') === 'yes', note: formValue(ctx, 'note') };
    const problem = isUuid(values.facility)
      ? await sendToPharmacy(ctx.deps, user.id, id, { facilityId: values.facility, delivery: values.delivery, note: values.note }, ctx.ip)
      : 'rxsend.err.choose';
    if (problem) {
      const rx = await patientPrescription(ctx.deps.db, user.id, id);
      return sendHtml(ctx, 422, sendToPharmacyPage(ctx, rx, await pharmacyChoices(ctx.deps.db), { error: problem, values }));
    }
    redirect(ctx, href(ctx, '/health-record', { ok: 'rxSent' }));
  });

  r.post('/health-record/pharmacy-requests/:id/cancel', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const problem = await cancelPharmacyRequest(ctx.deps, user.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/health-record', problem ? { error: problem } : { ok: 'rxRequestCancelled' }));
  });

  // ---- pharmacy inbox
  r.get('/facility/prescriptions', async (ctx) => {
    const f = await requirePharmacy(ctx);
    sendHtml(ctx, 200, pharmacyInboxPage(ctx, f, await listPharmacyInbox(ctx.deps.db, f.user_id), notice(ctx)));
  });

  r.get('/facility/prescriptions/:id', async (ctx) => {
    const f = await requirePharmacy(ctx);
    sendHtml(ctx, 200, pharmacyRequestPage(ctx, f, await getPharmacyRequest(ctx.deps.db, f.user_id, uuidParam(ctx, 'id')), notice(ctx)));
  });

  r.post('/facility/prescriptions/:id/reply', async (ctx) => {
    const f = await requirePharmacy(ctx);
    const id = uuidParam(ctx, 'id');
    const problem = await replyToRequest(ctx.deps, f.user_id, id, { status: formValue(ctx, 'status'), total: formValue(ctx, 'total'), note: formValue(ctx, 'note') }, ctx.ip);
    redirect(ctx, href(ctx, `/facility/prescriptions/${id}`, problem ? { error: problem } : { ok: 'rxReplied' }));
  });

  r.post('/facility/prescriptions/:id/done', async (ctx) => {
    const f = await requirePharmacy(ctx);
    const id = uuidParam(ctx, 'id');
    const problem = await completeRequest(ctx.deps, f.user_id, id, ctx.ip);
    redirect(ctx, href(ctx, problem ? `/facility/prescriptions/${id}` : '/facility/prescriptions', problem ? { error: problem } : { ok: 'rxCompleted' }));
  });

  // ---- patient: one place for prescriptions, lab tests and imaging
  r.get('/health-record', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'prescriptions', ctx.path));
    const tab = ctx.query.get('tab') ?? '';
    sendHtml(ctx, 200, healthRecordPage(ctx, await patientHealthRecord(ctx.deps.db, ctx.user.id), isHealthTab(tab) ? tab : 'prescriptions', notice(ctx)));
  });

  // A short code the patient shows at the clinic so a walk-in file can be linked to this account.
  // Shown on the page that made it (never put in an address, never stored in plain text).
  r.post('/health-record/link-code', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const code = await createLinkCode(ctx.deps, user.id, ctx.ip);
    sendHtml(ctx, 200, healthRecordPage(ctx, await patientHealthRecord(ctx.deps.db, user.id), 'prescriptions', undefined, code));
  });

  // The old address keeps working.
  r.get('/prescriptions', async (ctx) => redirect(ctx, href(ctx, '/health-record')));

  r.get('/health-record/orders/:id/:section/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const part = await patientOrderPart(ctx.deps.db, user.id, uuidParam(ctx, 'id'), sectionParam(ctx));
    if (part.request) return redirect(ctx, href(ctx, '/health-record', { tab: part.section }));
    const [choices, kidney] = await Promise.all([centreChoices(ctx.deps.db, part), patientKidneyResults(ctx.deps.db, user.id)]);
    sendHtml(ctx, 200, sendOrderPage(ctx, part, choices, kidney));
  });

  r.post('/health-record/orders/:id/:section/send', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const id = uuidParam(ctx, 'id');
    const section = sectionParam(ctx);
    const facility = formValue(ctx, 'facility');
    const problem = isUuid(facility)
      ? await sendOrderPart(ctx.deps, user.id, id, section, facility, ctx.ip, {
          note: formValue(ctx, 'note'),
          homeVisit: formValue(ctx, 'homeVisit') === 'yes',
          shareKidney: isUuid(formValue(ctx, 'shareKidney')) ? formValue(ctx, 'shareKidney') : undefined,
        })
      : 'hr.err.chooseCentre';
    if (problem) {
      const part = await patientOrderPart(ctx.deps.db, user.id, id, section);
      const [choices, kidney] = await Promise.all([centreChoices(ctx.deps.db, part), patientKidneyResults(ctx.deps.db, user.id)]);
      return sendHtml(ctx, 422, sendOrderPage(ctx, part, choices, kidney, problem));
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
    await markReceived(ctx.deps, f.user_id, id, ctx.ip, formValue(ctx, 'instructions'));
    redirect(ctx, href(ctx, `/facility/requests/${id}`, { ok: 'orderReceived' }));
  });

  r.post('/facility/requests/:id/sample', async (ctx) => {
    const f = await requireCentre(ctx);
    const id = uuidParam(ctx, 'id');
    const problem = await markSampleTaken(ctx.deps, f.user_id, id, ctx.ip);
    redirect(ctx, href(ctx, `/facility/requests/${id}`, problem ? { error: problem } : { ok: 'sampleTaken' }));
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
