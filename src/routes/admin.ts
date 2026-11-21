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
import { adminStats, parseRange, searchAccounts, setAccountStatus, listAudit, outboxOverview, retryFailedMessages } from '../services/adminConsole.js';
import { adminDashboardPage, adminAccountsPage, adminAuditPage, adminMessagesPage } from '../views/pages/adminConsole.js';
import { smsEnabled, emailEnabled } from '../config.js';

const DECISIONS: Decision[] = ['approve', 'reject', 'suspend', 'reinstate'];

export function adminRoutes(r: Router): void {
  r.get('/admin', async (ctx) => {
    requireUser(ctx, 'admin');
    const range = parseRange(ctx.query, ctx.deps.cfg.TIME_ZONE, ctx.deps.now());
    sendHtml(ctx, 200, adminDashboardPage(ctx, await adminStats(ctx.deps.db, range, ctx.deps.cfg.TIME_ZONE), range));
  });

  r.get('/admin/doctors', async (ctx) => {
    requireUser(ctx, 'admin');
    const [ref, data] = await Promise.all([getReference(ctx.deps.db), listForReview(ctx.deps.db)]);
    sendHtml(ctx, 200, adminListPage(ctx, ref, data, noticeFrom(ctx)));
  });

  // Find any patient or doctor account; suspend (blocks sign-in at once) or reactivate.
  r.get('/admin/accounts', async (ctx) => {
    requireUser(ctx, 'admin');
    const q = (ctx.query.get('q') ?? '').slice(0, 120);
    const results = q.trim().length >= 2 ? await searchAccounts(ctx.deps.db, q) : null;
    sendHtml(ctx, 200, adminAccountsPage(ctx, { q, results, notice: noticeFrom(ctx), error: errorFrom(ctx) }));
  });

  r.post('/admin/accounts/:id/:action', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    const id = uuidParam(ctx, 'id');
    const action = ctx.params['action'];
    if (action !== 'suspend' && action !== 'reactivate') throw notFound();
    const q = formValue(ctx, 'q').slice(0, 120) || undefined;
    try {
      await setAccountStatus(ctx.deps, admin, id, action === 'suspend', formValue(ctx, 'reason'), ctx.ip);
      redirect(ctx, href(ctx, '/admin/accounts', { q, ok: action === 'suspend' ? 'accountSuspended' : 'accountReactivated' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      redirect(ctx, href(ctx, '/admin/accounts', { q, error: e.messageKey }));
    }
  });

  r.get('/admin/audit', async (ctx) => {
    requireUser(ctx, 'admin');
    const g = (k: string) => (ctx.query.get(k) ?? '').slice(0, 120);
    const filters = {
      action: g('action'),
      entityType: g('entityType'),
      entityId: g('entityId'),
      actor: g('actor'),
      range: parseRange(ctx.query, ctx.deps.cfg.TIME_ZONE, ctx.deps.now()),
    };
    sendHtml(ctx, 200, adminAuditPage(ctx, filters, await listAudit(ctx.deps.db, filters, ctx.deps.cfg.TIME_ZONE)));
  });

  r.get('/admin/messages', async (ctx) => {
    requireUser(ctx, 'admin');
    const cfg = ctx.deps.cfg;
    const [overview, records] = await Promise.all([
      outboxOverview(ctx.deps.db),
      ctx.deps.db.query<{ n: number }>('select count(*)::int as n from doctors where records_enabled'),
    ]);
    const svc = {
      sms: smsEnabled(cfg),
      email: emailEnabled(cfg),
      ai: !!ctx.deps.ai,
      records: records.rows[0]?.n ?? 0,
      rules: { cancelHours: cfg.CANCEL_CUTOFF_HOURS, horizonDays: cfg.BOOKING_HORIZON_DAYS, leadMinutes: cfg.BOOKING_MIN_LEAD_MINUTES, maxActive: cfg.MAX_ACTIVE_APPOINTMENTS_PER_PATIENT },
    };
    sendHtml(ctx, 200, adminMessagesPage(ctx, svc, { ...overview, notice: noticeFrom(ctx) }));
  });

  r.post('/admin/messages/retry', async (ctx) => {
    const admin = requireUser(ctx, 'admin');
    await retryFailedMessages(ctx.deps, admin, ctx.ip);
    redirect(ctx, href(ctx, '/admin/messages', { ok: 'retried' }));
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
      redirect(ctx, href(ctx, '/admin/doctors', { ok: 'done' }));
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
