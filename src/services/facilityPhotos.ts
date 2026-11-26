import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { UploadedFile } from '../http/body.js';
import type { MessageKey } from '../i18n/index.js';
import { sniffDocumentType } from '../storage/files.js';
import { stripImageMetadata } from '../storage/imageClean.js';
import { notFound } from '../http/errors.js';
import { audit } from './audit.js';

/** Most photos of the place (the logo is extra). */
export const MAX_FACILITY_PHOTOS = 8;

export type FacilityPhotoKind = 'logo' | 'photo';

export interface FacilityPhoto {
  id: string;
  kind: FacilityPhotoKind;
  hidden: boolean;
  created_at: Date;
}

/**
 * Adds a logo (replacing the old one) or photos of the place. Only JPG/PNG, checked by content;
 * the browser converts other phone formats to JPG first. Hidden metadata (exact GPS location,
 * phone model) is removed, since these photos are public. Files that aren't photos are skipped
 * and counted, so one bad file does not lose the good ones.
 */
export async function addFacilityPhotos(
  deps: Deps,
  facilityId: string,
  kind: FacilityPhotoKind,
  files: UploadedFile[],
  ip: string,
): Promise<{ added: number; skipped: number; problem: MessageKey | null }> {
  const chosen = files.filter((f) => f.field === (kind === 'logo' ? 'logo' : 'photos') && f.data.length > 0);
  if (!chosen.length) return { added: 0, skipped: 0, problem: 'fphoto.err.none' };
  const clean: { data: Buffer; mime: 'image/jpeg' | 'image/png'; ext: string }[] = [];
  let skipped = 0;
  for (const file of kind === 'logo' ? chosen.slice(0, 1) : chosen) {
    const t = file.data.length <= deps.cfg.MAX_UPLOAD_BYTES ? sniffDocumentType(file.data) : null;
    const data = t && t.mime !== 'application/pdf' ? stripImageMetadata(file.data) : null;
    if (!t || t.mime === 'application/pdf' || !data) { skipped++; continue; }
    clean.push({ data, mime: t.mime, ext: t.ext });
  }
  if (!clean.length) return { added: 0, skipped, problem: 'fphoto.err.invalid' };

  const keys: string[] = [];
  try {
    for (const p of clean) keys.push(await deps.storage.put(p.data, p.ext));
    const result = await deps.db.transaction(async (tx) => {
      await tx.query('select 1 from facilities where user_id = $1 for update', [facilityId]);
      let oldKeys: string[] = [];
      if (kind === 'logo') {
        oldKeys = (await tx.query<{ storage_key: string }>("delete from facility_photos where facility_id = $1 and kind = 'logo' returning storage_key", [facilityId])).rows.map((r) => r.storage_key);
      } else {
        const n = (await tx.query<{ n: number }>("select count(*)::int as n from facility_photos where facility_id = $1 and kind = 'photo'", [facilityId])).rows[0]?.n ?? 0;
        if (n + clean.length > MAX_FACILITY_PHOTOS) return { problem: 'fphoto.err.full' as MessageKey, oldKeys: [] };
      }
      for (const [i, p] of clean.entries()) {
        await tx.query('insert into facility_photos (facility_id, kind, storage_key, mime_type, size_bytes) values ($1, $2, $3, $4, $5)', [facilityId, kind, keys[i], p.mime, p.data.length]);
      }
      await audit(tx, { actorId: facilityId, action: `facility.${kind}_add`, entityType: 'facility', entityId: facilityId, metadata: { count: clean.length }, ip });
      return { problem: null, oldKeys };
    });
    if (result.problem) {
      await Promise.all(keys.map((k) => deps.storage.remove(k).catch(() => undefined)));
      return { added: 0, skipped, problem: result.problem };
    }
    await Promise.all(result.oldKeys.map((k) => deps.storage.remove(k).catch(() => undefined)));
    return { added: clean.length, skipped, problem: null };
  } catch (e) {
    await Promise.all(keys.map((k) => deps.storage.remove(k).catch(() => undefined)));
    throw e;
  }
}

export async function listFacilityPhotos(db: Queryable, facilityId: string): Promise<FacilityPhoto[]> {
  return (
    await db.query<FacilityPhoto>(
      "select id, kind, hidden_at is not null as hidden, created_at from facility_photos where facility_id = $1 order by kind = 'logo' desc, created_at",
      [facilityId],
    )
  ).rows;
}

/** Visible photos for public pages, per place: the logo id and the other photo ids. */
export async function publicPhotos(db: Queryable, facilityIds: string[]): Promise<Map<string, { logo: string | null; photos: string[] }>> {
  const out = new Map<string, { logo: string | null; photos: string[] }>();
  if (!facilityIds.length) return out;
  const { rows } = await db.query<{ id: string; facility_id: string; kind: FacilityPhotoKind }>(
    'select id, facility_id, kind from facility_photos where facility_id = any($1::uuid[]) and hidden_at is null order by created_at',
    [facilityIds],
  );
  for (const r of rows) {
    const e = out.get(r.facility_id) ?? { logo: null, photos: [] };
    if (r.kind === 'logo') e.logo = r.id;
    else e.photos.push(r.id);
    out.set(r.facility_id, e);
  }
  return out;
}

/**
 * One photo: anyone may see a visible photo of an approved, active place; the place itself and
 * admins can always see theirs (including hidden ones). Everyone else gets "not found".
 */
export async function readFacilityPhoto(deps: Deps, photoId: string, viewer: { id: string; role: string } | null): Promise<{ data: Buffer; mime: string; isPublic: boolean }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime_type: string; facility_id: string; public: boolean }>(
    `select p.storage_key, p.mime_type, p.facility_id,
            (p.hidden_at is null and f.verification_status = 'approved' and u.status = 'active') as public
       from facility_photos p join facilities f on f.user_id = p.facility_id join users u on u.id = f.user_id
      where p.id = $1`,
    [photoId],
  );
  const p = rows[0];
  if (!p || (!p.public && viewer?.id !== p.facility_id && viewer?.role !== 'admin')) throw notFound();
  return { data: await deps.storage.get(p.storage_key), mime: p.mime_type, isPublic: p.public };
}

export async function deleteFacilityPhoto(deps: Deps, facilityId: string, photoId: string, ip: string): Promise<void> {
  const { rows } = await deps.db.query<{ storage_key: string }>('delete from facility_photos where id = $1 and facility_id = $2 returning storage_key', [photoId, facilityId]);
  if (!rows[0]) throw notFound();
  await deps.storage.remove(rows[0].storage_key).catch(() => undefined);
  await audit(deps.db, { actorId: facilityId, action: 'facility.photo_remove', entityType: 'facility_photo', entityId: photoId, ip });
}

/** Admin: hide a photo from the public (or show it again). Returns the place's id. */
export async function setFacilityPhotoHidden(deps: Deps, adminId: string, photoId: string, hidden: boolean, ip: string): Promise<string> {
  const { rows } = await deps.db.query<{ facility_id: string }>(
    'update facility_photos set hidden_at = case when $2 then now() end, hidden_by = case when $2 then $3::uuid end where id = $1 returning facility_id',
    [photoId, hidden, adminId],
  );
  if (!rows[0]) throw notFound();
  await audit(deps.db, { actorId: adminId, action: hidden ? 'facility.photo_hide' : 'facility.photo_show', entityType: 'facility_photo', entityId: photoId, ip });
  return rows[0].facility_id;
}
