import type { Db, Queryable } from '../db/db.js';
import type { SmsProvider } from './sms.js';
import type { EmailProvider } from './email.js';
import { log } from '../log.js';

/**
 * Transactional outbox: messages are inserted in the same transaction as the
 * change they describe (a booking, a verification), then sent by the worker.
 * A crash can never produce "booked but no SMS" or "SMS but no booking".
 */
export async function enqueueSms(db: Queryable, toPhone: string, body: string): Promise<void> {
  await db.query('insert into notification_outbox (to_phone, body) values ($1, $2)', [toPhone, body]);
}

export async function enqueueEmail(db: Queryable, toEmail: string, subject: string, body: string): Promise<void> {
  await db.query(`insert into notification_outbox (channel, to_email, subject, body) values ('email', $1, $2, $3)`, [toEmail, subject.slice(0, 200), body]);
}

const MAX_ATTEMPTS = 6;

/**
 * Sends due messages. Safe to run in several processes (SKIP LOCKED).
 * A channel whose provider is disabled has its messages marked 'skipped'; a channel with no
 * provider passed (email in older callers) is left pending for a process that has one.
 */
export async function deliverPending(db: Db, sms: SmsProvider, batch = 20, email?: EmailProvider): Promise<number> {
  if (sms.disabled) await db.query(`update notification_outbox set status = 'skipped' where status = 'pending' and channel = 'sms'`);
  if (email?.disabled) await db.query(`update notification_outbox set status = 'skipped' where status = 'pending' and channel = 'email'`);
  const channels = [...(sms.disabled ? [] : ['sms']), ...(email && !email.disabled ? ['email'] : [])];
  if (!channels.length) return 0;
  let delivered = 0;
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; channel: 'sms' | 'email'; to_phone: string | null; to_email: string | null; subject: string | null; body: string; attempts: number }>(
      `select id, channel, to_phone, to_email, subject, body, attempts from notification_outbox
        where status = 'pending' and next_attempt_at <= now() and channel = any($2::text[])
        order by id limit $1 for update skip locked`,
      [batch, channels],
    );
    for (const m of rows) {
      try {
        if (m.channel === 'email') await email!.send(m.to_email!, m.subject ?? '', m.body);
        else await sms.send(m.to_phone!, m.body);
        await tx.query(`update notification_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1`, [m.id]);
        delivered++;
      } catch (err) {
        const attempts = m.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await tx.query(
          `update notification_outbox
              set attempts = $2, status = $3, last_error = $4,
                  next_attempt_at = now() + make_interval(secs => $5::int)
            where id = $1`,
          [m.id, attempts, failed ? 'failed' : 'pending', err instanceof Error ? err.message.slice(0, 300) : 'error', 30 * 2 ** attempts],
        );
        log.warn('message delivery failed', { outboxId: m.id, channel: m.channel, attempts, failed });
      }
    }
  });
  return delivered;
}
