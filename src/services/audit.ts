import { realActor } from '../http/actor.js';
import type { Queryable } from '../db/db.js';

/**
 * Append-only record of security-relevant actions: who did what to which record.
 * Metadata must not contain health data or passwords; ids and status changes only.
 */
export async function audit(
  db: Queryable,
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown>; ip?: string | null },
): Promise<void> {
  // A secretary acting in a doctor's dashboard is recorded as the actor, with the doctor alongside.
  const actor = realActor(entry.actorId);
  const metadata = actor.onBehalfOf ? { ...(entry.metadata ?? {}), onBehalfOf: actor.onBehalfOf } : (entry.metadata ?? {});
  await db.query(
    `insert into audit_log (actor_user_id, action, entity_type, entity_id, metadata, ip) values ($1, $2, $3, $4, $5, $6)`,
    [actor.actorId, entry.action, entry.entityType, entry.entityId ?? null, metadata, entry.ip ?? null],
  );
}
