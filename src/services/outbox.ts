import type { Db, Queryable } from '../db/db.js';
import type { SmsProvider } from './sms.js';
import { log } from '../log.js';

/**
 * Transactional outbox: messages are inserted in the same transaction as the
 * change they describe (a booking, a verification), then sent by the worker.
 * A crash can never produce "booked but no SMS" or "SMS but no booking".
 */
export async function enqueueSms(db: Queryable, toPhone: string, body: string): Promise<void> {
  await db.query('insert into notification_outbox (to_phone, body) values ($1, $2)', [toPhone, body]);
}

const MAX_ATTEMPTS = 6;

/** Sends due messages. Safe to run in several processes (SKIP LOCKED). */
export async function deliverPending(db: Db, sms: SmsProvider, batch = 20): Promise<number> {
  if (sms.disabled) {
    await db.query(`update notification_outbox set status = 'skipped' where status = 'pending'`);
    return 0;
  }
  let delivered = 0;
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; to_phone: string; body: string; attempts: number }>(
      `select id, to_phone, body, attempts from notification_outbox
        where status = 'pending' and next_attempt_at <= now()
        order by id limit $1 for update skip locked`,
      [batch],
    );
    for (const m of rows) {
      try {
        await sms.send(m.to_phone, m.body);
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
        log.warn('sms delivery failed', { outboxId: m.id, attempts, failed });
      }
    }
  });
  return delivered;
}
