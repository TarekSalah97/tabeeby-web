import type { Ctx } from '../http/context.js';
import { href } from '../http/context.js';
import type { MessageKey } from '../i18n/index.js';
import { isMessageKey } from '../i18n/index.js';
import { field } from '../http/body.js';
import { createSession, sessionMaxAgeSeconds, SESSION_COOKIE, type Role } from '../auth/sessions.js';
import { setCookie } from '../http/context.js';
import { isUuid } from '../http/router.js';
import { notFound } from '../http/errors.js';

/** Short, whitelisted success codes in the URL instead of a server-side flash store. */
const NOTICES: Record<string, MessageKey> = {
  booked: 'appts.booked',
  bookedNoSms: 'appts.bookedNoSms',
  cancelled: 'appts.cancelled',
  saved: 'common.saved',
  done: 'admin.done',
  deleted: 'common.deleted',
  facilityJoined: 'facdash.joined',
  fileCreated: 'records.createdNotice',
  linked: 'records.linked',
  visitSaved: 'visit.saved',
  rxIssued: 'rx.issued',
  labIssued: 'lab.issued',
  medSaved: 'med.saved',
  medStopped: 'med.stopped',
  medTestSent: 'med.testSent',
  medSettings: 'med.settingsSaved',
  labIssuedSet: 'labset.issuedSaved',
  visitSavedSet: 'labset.visitSaved',
  labSetSaved: 'labset.saved',
  labSetDeleted: 'labset.deleted',
  resReviewed: 'res.done',
  sampleTaken: 'track.sampleDone',
  voided: 'rx.voidedNotice',
  reviewSaved: 'review.saved',
  waitlistJoined: 'waitlist.joined',
  waitlistLeft: 'waitlist.left',
  bookedGuest: 'guest.booked',
  clinicBooked: 'cbook.done',
  paid: 'pay.paidDone',
  incomeOn: 'dash.incomeOnDone',
  payRef: 'payopt.refSaved',
  extraAdded: 'extra.added',
  extraUpdated: 'extra.updated',
  extraDeleted: 'extra.deleted',
  teamUpdated: 'team.updated',
  teamRemoved: 'team.removed',
  accountRemoved: 'adm.removed',
  rxSent: 'rxsend.done.sent',
  rxRequestCancelled: 'rxsend.done.cancelled',
  rxReplied: 'rxsend.done.replied',
  rxCompleted: 'rxsend.done.completed',
  photosAdded: 'vphoto.added',
  photoRemovedVisit: 'vphoto.removed',
  instapay: 'payopt.settingSaved',
  photoSaved: 'photo.savedDone',
  photoRemoved: 'photo.removedDone',
  incomeOff: 'dash.incomeOffDone',
  dayCancelled: 'dayoff.done',
  issueReported: 'issue.done',
  resolved: 'issue.resolvedDone',
  waived: 'strike.waivedDone',
  refunded: 'pay.refundedDone',
  msgBlocked: 'msg.blockedDone',
  msgUnblocked: 'msg.unblockedDone',
  noShowsCleared: 'adm.noShowsClearedDone',
  passwordSet: 'password.setDone',
  accountSuspended: 'adm.suspendedDone',
  accountReactivated: 'adm.reactivatedDone',
  retried: 'adm.retriedDone',
  orderSent: 'hr.done.sent',
  serviceSaved: 'svc.saved',
  fileFoundByPhone: 'records.foundByPhone',
  fileLinkedByCode: 'link.done',
  messagingOn: 'msgset.nowOn',
  messagingOff: 'msgset.nowOff',
  orderCancelled: 'hr.done.cancelled',
  orderReceived: 'hr.done.received',
  resultAdded: 'hr.done.fileAdded',
  resultRemoved: 'hr.done.fileRemoved',
  resultsReleased: 'hr.done.released',
};

export function noticeFrom(ctx: Ctx): MessageKey | undefined {
  return NOTICES[ctx.query.get('ok') ?? ''];
}

/** Error codes passed through redirects must be real message keys. */
export function errorFrom(ctx: Ctx): MessageKey | undefined {
  const e = ctx.query.get('error') ?? '';
  return isMessageKey(e) ? e : undefined;
}

export const formValue = (ctx: Ctx, name: string): string => field(ctx.form, name);

export function uuidParam(ctx: Ctx, name: string): string {
  const v = ctx.params[name];
  if (!isUuid(v)) throw notFound();
  return v;
}

export async function startSession(ctx: Ctx, userId: string, role: Role): Promise<void> {
  const token = await createSession(ctx.deps.db, userId, role);
  setCookie(ctx, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', maxAgeSeconds: sessionMaxAgeSeconds(role) });
}

export function homeFor(ctx: Ctx, role: Role): string {
  return href(ctx, role === 'doctor' || role === 'assistant' ? '/dashboard' : role === 'admin' ? '/admin' : role === 'facility' ? '/facility' : '/');
}

/** Turn a stored locale-less path ("/dashboard") into the current-locale URL. */
export function localized(ctx: Ctx, path: string): string {
  if (path.startsWith('/en/') || path === '/en') return path;
  return href(ctx, path);
}

/**
 * Demo site only: the newest emailed code for this address (from the outbox), shown on screen
 * because the demo does not really send email. Never used when DEMO_MODE is off.
 */
export async function demoEmailCode(ctx: Ctx, email: string): Promise<string | null> {
  if (!ctx.deps.cfg.DEMO_MODE || !email) return null;
  const { rows } = await ctx.deps.db.query<{ body: string }>(
    `select body from notification_outbox where channel = 'email' and to_email = $1 and created_at > now() - interval '15 minutes' order by id desc limit 3`,
    [email],
  );
  for (const r of rows) {
    const m = /\b(\d{6})\b/.exec(r.body);
    if (m) return m[1]!;
  }
  return null;
}
