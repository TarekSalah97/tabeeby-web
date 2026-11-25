import fs from 'node:fs';
import path from 'node:path';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href } from '../http/context.js';
import { sendHtml, sendJson, redirect } from '../http/respond.js';
import { isUuid } from '../http/router.js';
import { fieldAll } from '../http/body.js';
import { staticRoot } from '../http/staticRoot.js';
import { translator } from '../i18n/index.js';
import { todayIn } from '../domain/time.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';
import { patientGatePage } from '../views/pages/auth.js';
import { medicinesPage, setupPage } from '../views/pages/medicines.js';
import {
  countSubscriptions, dosesForDay, listReminders, markDose, prescriptionForSetup, reminderCalendar, removeSubscription, saveReminders,
  saveSubscription, sendTestNotification, setShowNames, stopReminder, type SetupInput,
} from '../services/medReminders.js';
import { vapidKeys } from '../services/webPush.js';

/** Signed-in patient, or the "sign in to see your medicines" page. */
function patient(ctx: Ctx): { id: string } | null {
  if (ctx.user?.role === 'patient') return { id: ctx.user.id };
  if (ctx.method === 'GET') sendHtml(ctx, 200, patientGatePage(ctx, 'prescriptions', ctx.path));
  else sendJson(ctx, 403, { error: 'forbidden' });
  return null;
}

const SW_FILE = path.join(staticRoot, 'sw.js');

export function medicineRoutes(r: Router): void {
  // The service worker must be served from the site root so it may show notifications for all pages.
  r.get('/sw.js', async (ctx) => {
    const body = await fs.promises.readFile(SW_FILE);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-cache');
    ctx.res.setHeader('Service-Worker-Allowed', '/');
    ctx.res.end(body);
  });

  r.get('/medicines', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const { db, cfg } = ctx.deps;
    const now = ctx.deps.now();
    const today = todayIn(cfg.TIME_ZONE, now);
    const [doses, reminders, phones, keys, settings] = await Promise.all([
      dosesForDay(db, p.id, today, cfg.TIME_ZONE),
      listReminders(db, p.id, { activeOn: today }),
      countSubscriptions(db, p.id),
      vapidKeys(db),
      db.query<{ reminder_show_names: boolean }>('select reminder_show_names from users where id = $1', [p.id]),
    ]);
    const ok = noticeFrom(ctx);
    const err = errorFrom(ctx);
    sendHtml(ctx, 200, medicinesPage(ctx, {
      doses, reminders, phones, vapidKey: keys.publicKey, showNames: !!settings.rows[0]?.reminder_show_names, now,
      notice: ok ? { kind: 'success', key: ok } : err ? { kind: 'error', key: err } : undefined,
    }));
  });

  r.get('/medicines/setup/:rx', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const rx = await prescriptionForSetup(ctx.deps.db, p.id, uuidParam(ctx, 'rx'), ctx.deps.cfg.TIME_ZONE, ctx.deps.now());
    sendHtml(ctx, 200, setupPage(ctx, rx));
  });

  r.post('/medicines/setup/:rx', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const rxId = uuidParam(ctx, 'rx');
    const { db, cfg } = ctx.deps;
    const rx = await prescriptionForSetup(db, p.id, rxId, cfg.TIME_ZONE, ctx.deps.now());
    const input: SetupInput[] = rx.items.map((it) => {
      const pos = it.position;
      const daysRaw = formValue(ctx, `days_${pos}`);
      const weekday = formValue(ctx, `weekday_${pos}`);
      return {
        position: pos,
        on: formValue(ctx, `on_${pos}`) === 'yes',
        times: fieldAll(ctx.form, `times_${pos}`).filter(Boolean),
        days: formValue(ctx, `ongoing_${pos}`) === 'yes' ? null : /^\d{1,3}$/.test(daysRaw) ? Number(daysRaw) : NaN,
        weekday: /^[0-6]$/.test(weekday) ? Number(weekday) : null,
      };
    });
    const problem = await saveReminders(ctx.deps, p.id, rxId, input, ctx.ip);
    if (problem) return sendHtml(ctx, 422, setupPage(ctx, await prescriptionForSetup(db, p.id, rxId, cfg.TIME_ZONE, ctx.deps.now()), problem));
    redirect(ctx, href(ctx, '/medicines', { ok: 'medSaved' }));
  });

  r.post('/medicines/reminders/:id/stop', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    await stopReminder(ctx.deps, p.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, '/medicines', { ok: 'medStopped' }));
  });

  r.post('/medicines/doses', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const reminder = formValue(ctx, 'reminder');
    if (!isUuid(reminder)) return redirect(ctx, href(ctx, '/medicines', { error: 'med.err.dose' }));
    const problem = await markDose(ctx.deps, p.id, reminder, formValue(ctx, 'due'), formValue(ctx, 'taken') === 'yes');
    redirect(ctx, href(ctx, '/medicines', problem ? { error: problem } : {}));
  });

  r.get('/medicines/calendar.ics', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const today = todayIn(ctx.deps.cfg.TIME_ZONE, ctx.deps.now());
    const body = reminderCalendar(await listReminders(ctx.deps.db, p.id, { activeOn: today }), translator(ctx.locale), ctx.deps.now());
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', 'attachment; filename="tabeeby-medicines.ics"');
    ctx.res.setHeader('Cache-Control', 'private, no-store');
    ctx.res.end(body);
  });

  // ---- phones
  r.post('/medicines/push/subscribe', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const ok = await saveSubscription(ctx.deps, p.id, { endpoint: formValue(ctx, 'endpoint'), p256dh: formValue(ctx, 'p256dh'), auth: formValue(ctx, 'auth') });
    sendJson(ctx, ok ? 200 : 422, { ok });
  });

  r.post('/medicines/push/unsubscribe', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    await removeSubscription(ctx.deps.db, p.id, formValue(ctx, 'endpoint'));
    sendJson(ctx, 200, { ok: true });
  });

  r.post('/medicines/push/test', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    const n = await sendTestNotification(ctx.deps, p.id, ctx.locale);
    redirect(ctx, href(ctx, '/medicines', n ? { ok: 'medTestSent' } : { error: 'med.err.testFailed' }));
  });

  r.post('/medicines/settings', async (ctx) => {
    const p = patient(ctx);
    if (!p) return;
    await setShowNames(ctx.deps.db, p.id, formValue(ctx, 'showNames') === 'yes');
    redirect(ctx, href(ctx, '/medicines', { ok: 'medSettings' }));
  });
}
