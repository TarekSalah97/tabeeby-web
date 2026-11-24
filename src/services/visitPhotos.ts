import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { UploadedFile } from '../http/body.js';
import type { MessageKey } from '../i18n/index.js';
import { sniffDocumentType } from '../storage/files.js';
import { notFound } from '../http/errors.js';
import { audit } from './audit.js';

/** Most photos one upload may carry, and most kept on one visit. */
export const PHOTOS_PER_UPLOAD = 6;
export const PHOTOS_PER_VISIT = 30;

export interface VisitPhoto {
  id: string;
  created_at: Date;
}

/**
 * Adds photos to one of the doctor's own visits. Only JPG/PNG (checked by content). All or none:
 * a bad file stops the whole upload so the doctor sees which problem to fix.
 */
export async function addVisitPhotos(deps: Deps, doctorId: string, encounterId: string, files: UploadedFile[], ip: string): Promise<MessageKey | null> {
  const photos = files.filter((f) => f.field === 'photos' && f.data.length > 0);
  if (!photos.length) return 'vphoto.pickFirst';
  if (photos.length > PHOTOS_PER_UPLOAD) return 'vphoto.tooMany';
  const typed: { file: UploadedFile; mime: 'image/jpeg' | 'image/png'; ext: string }[] = [];
  for (const file of photos) {
    if (file.data.length > deps.cfg.MAX_UPLOAD_BYTES) return 'vphoto.tooLarge';
    const t = sniffDocumentType(file.data);
    if (!t || t.mime === 'application/pdf') return 'vphoto.invalid';
    typed.push({ file, mime: t.mime, ext: t.ext });
  }
  const keys: string[] = [];
  try {
    for (const p of typed) keys.push(await deps.storage.put(p.file.data, p.ext));
    return await deps.db.transaction(async (tx) => {
      const own = await tx.query('select 1 from encounters where id = $1 and doctor_id = $2 for update', [encounterId, doctorId]);
      if (!own.rows.length) throw notFound();
      const count = await tx.query<{ n: number }>('select count(*)::int as n from encounter_photos where encounter_id = $1 and removed_at is null', [encounterId]);
      if ((count.rows[0]?.n ?? 0) + typed.length > PHOTOS_PER_VISIT) {
        await Promise.all(keys.map((k) => deps.storage.remove(k).catch(() => undefined)));
        return 'vphoto.visitFull';
      }
      for (const [i, p] of typed.entries()) {
        await tx.query(
          `insert into encounter_photos (encounter_id, doctor_id, storage_key, mime_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6)`,
          [encounterId, doctorId, keys[i], p.mime, p.file.data.length, crypto.createHash('sha256').update(p.file.data).digest('hex')],
        );
      }
      await audit(tx, { actorId: doctorId, action: 'visit.photos_add', entityType: 'encounter', entityId: encounterId, metadata: { count: typed.length }, ip });
      return null;
    });
  } catch (e) {
    await Promise.all(keys.map((k) => deps.storage.remove(k).catch(() => undefined)));
    throw e;
  }
}

export async function listVisitPhotos(db: Queryable, doctorId: string, encounterId: string): Promise<VisitPhoto[]> {
  return (
    await db.query<VisitPhoto>(
      'select id, created_at from encounter_photos where encounter_id = $1 and doctor_id = $2 and removed_at is null order by created_at',
      [encounterId, doctorId],
    )
  ).rows;
}

/** One photo for its own doctor only (anyone else gets "not found"). */
export async function readVisitPhoto(deps: Deps, doctorId: string, photoId: string): Promise<{ data: Buffer; mime: string }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime_type: string }>(
    'select storage_key, mime_type from encounter_photos where id = $1 and doctor_id = $2 and removed_at is null',
    [photoId, doctorId],
  );
  if (!rows[0]) throw notFound();
  return { data: await deps.storage.get(rows[0].storage_key), mime: rows[0].mime_type };
}

/** Hides a photo from the visit (kept for the record). Returns the visit id. */
export async function removeVisitPhoto(deps: Deps, doctorId: string, photoId: string, ip: string): Promise<string> {
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ encounter_id: string }>(
      'update encounter_photos set removed_at = now() where id = $1 and doctor_id = $2 and removed_at is null returning encounter_id',
      [photoId, doctorId],
    );
    if (!rows[0]) throw notFound();
    await audit(tx, { actorId: doctorId, action: 'visit.photo_remove', entityType: 'encounter_photo', entityId: photoId, ip });
    return rows[0].encounter_id;
  });
}
