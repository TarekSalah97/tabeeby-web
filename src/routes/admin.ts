import type { Router } from '../http/router.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { applyDocumentHeaders } from '../http/security.js';
import { getReference } from '../services/reference.js';
import { listForReview, getForReview, decide, readDocument, type Decision } from '../services/admin.js';
import { setRecordsEnabled } from '../services/records.js';
import { adminListPage, adminDoctorPage, adminReviewsPage } from '../views/pages/admin.js';
import { listReviewsForAdmin, setReviewVisibility } from '../services/reviews.js';
import { DomainError, notFound } from '../http/errors.js';
import { isMessageKey } from '../i18n/index.js';
import { errorFrom, formValue, noticeFrom, uuidParam } from './helpers.js';

const DECISIONS: Decision[] = ['approve', 'reject', 'suspend', 'reinstate'];

export function adminRoutes(r: Router): void {
  r.get('/admin', async (ctx) => {
    requireUser(ctx, 'admin');
    const [ref, data] = await Promise.all([getReference(ctx.deps.db), listForReview(ctx.deps.db)]);
    sendHtml(ctx, 200, adminListPage(ctx, ref, data, noticeFrom(ctx)));
  });

  r.get('/admin/reviews', async (ctx) => {
    requireUser(ctx, 'admin');
    sendHtml(ctx, 200, adminReviewsPage(ctx, await listReviewsForAdmin(ctx.deps.db), { notice: noticeFrom(ctx), error: errorFrom(ctx) }));
  });

  r.post('/admin/reviews/:id/:action', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    const action = ctx.params['action'];
    if (action !== 'hide' && action !== 'show') throw notFound();
    try {
      await setReviewVisibility(ctx.deps, admin, id, action === 'show', formValue(ctx, 'reason'), ctx.ip);
      redirect(ctx, href(ctx, '/admin/reviews', { ok: 'done' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/admin/reviews', { error: e.messageKey }));
    }
  });

  r.get('/admin/doctors/:id', async (ctx) => {
    requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    const [ref, d] = await Promise.all([getReference(ctx.deps.db), getForReview(ctx.deps.db, id)]);
    const e = ctx.query.get('error') ?? '';
    sendHtml(ctx, 200, adminDoctorPage(ctx, ref, d, isMessageKey(e) ? e : undefined, noticeFrom(ctx)));
  });

  // Registered before the generic decision route below so "records" is not read as a decision.
  r.post('/admin/doctors/:id/records', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    await setRecordsEnabled(ctx.deps, admin.id, id, formValue(ctx, 'on') === 'yes', ctx.ip);
    redirect(ctx, href(ctx, `/admin/doctors/${id}`, { ok: 'done' }));
  });

  r.post('/admin/doctors/:id/:decision', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    const decision = ctx.params['decision'] as Decision;
    if (!DECISIONS.includes(decision)) throw notFound();
    try {
      await decide(ctx.deps, admin.id, id, decision, formValue(ctx, 'note'), ctx.ip);
      redirect(ctx, href(ctx, '/admin', { ok: 'done' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, `/admin/doctors/${id}`, { error: e.messageKey }));
    }
  });

  r.get('/admin/documents/:id', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const doc = await readDocument(ctx.deps, admin.id, uuidParam(ctx, 'id'), ctx.ip);
    applyDocumentHeaders(ctx.res);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', doc.mime);
    ctx.res.setHeader('Content-Disposition', 'inline');
    ctx.res.end(doc.data);
  });
}
