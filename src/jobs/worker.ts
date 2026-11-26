import type { Deps } from '../http/context.js';
import { deliverPending } from '../services/outbox.js';
import { translator, formatTime, type Locale } from '../i18n/index.js';
import { log, errorFields } from '../log.js';
import { expireOldEntries } from '../services/waitlist.js';
import { sendDueReminders } from '../services/medReminders.js';
import { keepDemoQueue } from '../services/demoQueue.js';
import { purgePendingUploads } from '../services/facilityDocuments.js';

/**
 * Queues reminders exactly once: the UPDATE … RETURNING claims each
 * appointment atomically, so several worker processes cannot double-send.
 */
export async function queueReminders(deps: Deps): Promise<number> {
  let queued = 0;
  for (const kind of ['24h', '2h'] as const) {
    const column = kind === '24h' ? 'reminder_24h_at' : 'reminder_2h_at';
    const window = kind === '24h' ? "interval '24 hours'" : "interval '2 hours'";
    // Skip the 24h reminder for bookings made less than 24h ahead (they just got a confirmation).
    const minLead = kind === '24h' ? "and a.created_at < a.starts_at - interval '20 hours'" : "and a.created_at < a.starts_at - interval '90 minutes'";
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ starts_at: Date; phone: string; locale: Locale; doctor: string; clinic: string }>(
        `with due as (
           update appointments a set ${column} = now()
            where a.status = 'confirmed' and a.${column} is null
              and a.starts_at > now() and a.starts_at <= now() + ${window} ${minLead}
           returning a.patient_id, a.walk_in_phone, a.doctor_id, a.clinic_id, a.starts_at)
         select due.starts_at, coalesce(p.phone_e164, due.walk_in_phone) as phone, coalesce(p.preferred_locale, 'ar') as locale,
                du.full_name as doctor, c.name as clinic
           from due left join users p on p.id = due.patient_id join users du on du.id = due.doctor_id join clinics c on c.id = due.clinic_id`,
      );
      for (const r of rows) {
        const t = translator(r.locale);
        await tx.query('insert into notification_outbox (to_phone, body) values ($1, $2)', [
          r.phone,
          t(kind === '24h' ? 'sms.reminder24' : 'sms.reminder2', { when: formatTime(r.starts_at, r.locale, deps.cfg.TIME_ZONE), doctor: r.doctor, clinic: r.clinic }),
        ]);
      }
      queued += rows.length;
    });
  }
  return queued;
}

export async function cleanup(deps: Deps): Promise<void> {
  await deps.db.query('delete from sessions where expires_at < now()');
  await deps.db.query("delete from rate_limits where window_start < now() - interval '2 days'");
  await deps.db.query("delete from otp_codes where created_at < now() - interval '2 days'");
  // SMS bodies mention doctors and times: keep them only as long as needed for support.
  await deps.db.query("delete from notification_outbox where status <> 'pending' and created_at < now() - interval '30 days'");
  await expireOldEntries(deps.db, deps.cfg.TIME_ZONE, deps.now());
  // Codes (and the booking details waiting on them) are not needed once used or expired.
  await deps.db.query("delete from email_codes where created_at < now() - interval '2 days'");
  // Dose history is only needed for a while (ticks shown for recent days).
  await deps.db.query("delete from medicine_doses where due_at < now() - interval '90 days'");
  // Files from sign-up forms that were never completed.
  await purgePendingUploads(deps);
}

export function startWorker(deps: Deps): () => void {
  let stopped = false;
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (ticks % 12 === 0) await queueReminders(deps); // every minute
      if (ticks % 12 === 6) await sendDueReminders(deps); // medicine reminders, every minute
      if (deps.cfg.DEMO_MODE && ticks % 60 === 1) await keepDemoQueue(deps); // demo site: Yasmin always waiting today
      await deliverPending(deps.db, deps.sms, 20, deps.email);
      if (ticks % 720 === 0) await cleanup(deps); // hourly
    } catch (err) {
      log.error('worker tick failed', errorFields(err));
    } finally {
      ticks++;
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
