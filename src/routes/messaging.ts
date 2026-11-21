import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { fieldAll } from '../http/body.js';
import type { SessionUser } from '../auth/sessions.js';
import { getOwnDoctor } from '../services/doctors.js';
import {
  listPatientConversations, listDoctorConversations, patientThread, doctorThread, sendFromPatient, replyFromDoctor,
  setConversationBlocked, getMessagingSettings, saveMessagingSettings, unreadConversations,
} from '../services/messaging.js';
import { patientInboxPage, patientThreadPage, doctorInboxPage, doctorThreadPage } from '../views/pages/messaging.js';
import { patientGatePage } from '../views/pages/auth.js';
import { DomainError, notFound } from '../http/errors.js';
import { isMessageKey, type MessageKey } from '../i18n/index.js';
import type { FieldErrors } from '../services/accounts.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';
import { requireDoctor } from './dashboard.js';

const SLUG_RE = /^[a-z0-9-]{3,80}$/;
const slugParam = (ctx: Ctx): string => {
  const s = ctx.params['slug'] ?? '';
  if (!SLUG_RE.test(s)) throw notFound();
  return s;
};
const keyOf = (e: DomainError): MessageKey => (isMessageKey(e.messageKey) ? e.messageKey : 'error.badRequest');

export function messagingRoutes(r: Router): void {
  // --- Patients -------------------------------------------------------------
  r.get('/messages', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'messages', ctx.path));
    sendHtml(ctx, 200, patientInboxPage(ctx, await listPatientConversations(ctx.deps.db, ctx.user.id)));
  });

  r.get('/messages/:slug', async (ctx) => {
    if (ctx.user?.role !== 'patient') return sendHtml(ctx, 200, patientGatePage(ctx, 'messages', ctx.path));
    const thread = await patientThread(ctx.deps, ctx.user, slugParam(ctx));
    ctx.unreadMessages = await unreadConversations(ctx.deps.db, ctx.user); // just read: refresh the badge
    sendHtml(ctx, 200, patientThreadPage(ctx, thread, { sent: ctx.query.get('ok') === 'sent' }));
  });

  r.post('/messages/:slug', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const slug = slugParam(ctx);
    const body = formValue(ctx, 'body');
    try {
      await sendFromPatient(ctx.deps, user, slug, body, ctx.ip);
      redirect(ctx, href(ctx, `/messages/${slug}`, { ok: 'sent' }));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      sendHtml(ctx, 422, patientThreadPage(ctx, await patientThread(ctx.deps, user, slug), { value: body, error: keyOf(e) }));
    }
  });

  // --- Doctors --------------------------------------------------------------
  const renderInbox = async (ctx: Ctx, user: SessionUser, extra: { errors?: FieldErrors; values?: { enabled: boolean; days: number[]; start: string; end: string } } = {}, status = 200) => {
    const db = ctx.deps.db;
    const [doctor, list, settings] = await Promise.all([getOwnDoctor(db, user.id), listDoctorConversations(db, user.id), getMessagingSettings(db, user.id)]);
    const n = noticeFrom(ctx);
    const e = errorFrom(ctx);
    sendHtml(ctx, status, doctorInboxPage(ctx, doctor, list, settings, { ...extra, notice: n ? { kind: 'success', key: n } : e ? { kind: 'error', key: e } : undefined }));
  };

  r.get('/dashboard/messages', async (ctx) => {
    const user = requireDoctor(ctx);
    if (user) await renderInbox(ctx, user);
  });

  r.post('/dashboard/messages/settings', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const input = { enabled: formValue(ctx, 'enabled') === 'yes', days: fieldAll(ctx.form, 'days'), start: formValue(ctx, 'start'), end: formValue(ctx, 'end') };
    const errors = await saveMessagingSettings(ctx.deps, user.id, input, ctx.ip);
    if (Object.keys(errors).length) {
      return renderInbox(ctx, user, { errors, values: { ...input, days: input.days.map(Number) } }, 422);
    }
    redirect(ctx, href(ctx, '/dashboard/messages', { ok: 'saved' }));
  });

  r.get('/dashboard/messages/:id', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const [doctor, thread] = await Promise.all([getOwnDoctor(ctx.deps.db, user.id), doctorThread(ctx.deps.db, user.id, id)]);
    ctx.unreadMessages = await unreadConversations(ctx.deps.db, user);
    const n = noticeFrom(ctx);
    sendHtml(ctx, 200, doctorThreadPage(ctx, doctor, thread, { notice: n ? { kind: 'success', key: n } : undefined }));
  });

  r.post('/dashboard/messages/:id', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const body = formValue(ctx, 'body');
    try {
      await replyFromDoctor(ctx.deps, user, id, body, ctx.ip);
      redirect(ctx, href(ctx, `/dashboard/messages/${id}`));
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      const [doctor, thread] = await Promise.all([getOwnDoctor(ctx.deps.db, user.id), doctorThread(ctx.deps.db, user.id, id)]);
      sendHtml(ctx, 422, doctorThreadPage(ctx, doctor, thread, { value: body, error: keyOf(e) }));
    }
  });

  r.post('/dashboard/messages/:id/:action', async (ctx) => {
    const user = requireDoctor(ctx);
    if (!user) return;
    const id = uuidParam(ctx, 'id');
    const action = ctx.params['action'];
    if (action !== 'block' && action !== 'unblock') throw notFound();
    await setConversationBlocked(ctx.deps, user, id, action === 'block', ctx.ip);
    redirect(ctx, href(ctx, `/dashboard/messages/${id}`, { ok: action === 'block' ? 'msgBlocked' : 'msgUnblocked' }));
  });
}
