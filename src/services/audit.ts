import type { Queryable } from '../db/db.js';

/**
 * Append-only record of security-relevant actions: who did what to which record.
 * Metadata must not contain health data or passwords; ids and status changes only.
 */
export async function audit(
  db: Queryable,
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown>; ip?: string | null },
): Promise<void> {
  await db.query(
    `insert into audit_log (actor_user_id, action, entity_type, entity_id, metadata, ip) values ($1, $2, $3, $4, $5, $6)`,
    [entry.actorId, entry.action, entry.entityType, entry.entityId ?? null, entry.metadata ?? {}, entry.ip ?? null],
  );
}
