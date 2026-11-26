import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { UploadedFile } from '../http/body.js';
import type { FileStorage } from '../storage/files.js';
import { sniffFacilityDocument, type FacilityDocMime } from '../storage/files.js';
import { docField, FACILITY_DOC_KINDS, MAX_FACILITY_FILES, MAX_FILES_PER_DOC, type FacilityDocKind } from '../domain/documents.js';
import type { MessageKey } from '../i18n/index.js';
import { hitRateLimit } from '../auth/rateLimit.js';
import { notFound, tooManyRequests } from '../http/errors.js';
import { audit } from './audit.js';

/*
 * Verification documents of labs, pharmacies and scan centres. Any phone photo or PDF is taken,
 * several per document, at sign-up or later. A bad file never blocks anything: it is simply left
 * out and the person is told which ones. Files from a sign-up form that had another mistake are
 * kept (pending) so nobody has to choose them again.
 */

export interface TakenFile {
  kind: FacilityDocKind;
  data: Buffer;
  mime: FacilityDocMime;
  ext: string;
  name: string;
}

export interface Taken {
  files: TakenFile[];
  /** Original names of files that were left out (not a photo/PDF, or too large). */
  refused: string[];
}

const FIELD_KIND = new Map<string, FacilityDocKind>(FACILITY_DOC_KINDS.map((k) => [docField(k), k]));

const cleanName = (n: string) => n.replace(/[\u0000-\u001f<>"\\/]/g, '').trim().slice(0, 120) || 'file';

/** Sorts the uploaded files into documents; never fails. */
export function takeFiles(maxBytes: number, uploads: readonly UploadedFile[]): Taken {
  const files: TakenFile[] = [];
  const refused: string[] = [];
  for (const f of uploads) {
    const kind = FIELD_KIND.get(f.field);
    if (!kind || f.data.length === 0) continue;
    const name = cleanName(f.filename ?? '');
    const type = f.data.length <= maxBytes ? sniffFacilityDocument(f.data) : null;
    if (!type) {
      refused.push(name);
      continue;
    }
    files.push({ kind, data: f.data, mime: type.mime, ext: type.ext, name });
  }
  return { files, refused };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------- kept files of a failed sign-up form

export interface KeptFile {
  /** What the form sends back: "<id>:<secret>". */
  token: string;
  kind: FacilityDocKind;
  name: string;
}

interface PendingRow {
  id: string;
  token_hash: string;
  kind: FacilityDocKind;
  storage_key: string;
  mime_type: FacilityDocMime;
  size_bytes: number;
  sha256: string;
  file_name: string;
}

const PENDING_HOURS = 24;
const MAX_PENDING_PER_HOUR = 60;

/** Stores files from a form that could not be saved yet, so they come back with the form. */
export async function keepFiles(deps: Deps, files: TakenFile[], ip: string): Promise<KeptFile[]> {
  const kept: KeptFile[] = [];
  for (const f of files.slice(0, MAX_FACILITY_FILES)) {
    if (!(await hitRateLimit(deps.db, `pending-upload:${ip}`, MAX_PENDING_PER_HOUR, 3600))) throw tooManyRequests();
    const secret = crypto.randomBytes(24).toString('base64url');
    const key = await deps.storage.put(f.data, f.ext);
    try {
      const { rows } = await deps.db.query<{ id: string }>(
        `insert into pending_uploads (token_hash, kind, storage_key, mime_type, size_bytes, sha256, file_name)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [sha(Buffer.from(secret)), f.kind, key, f.mime, f.data.length, sha(f.data), f.name],
      );
      kept.push({ token: `${rows[0]!.id}:${secret}`, kind: f.kind, name: f.name });
    } catch (e) {
      await deps.storage.remove(key).catch(() => undefined);
      throw e;
    }
  }
  return kept;
}

/** The kept files named by the form (unknown, expired or forged tokens are ignored). */
export async function loadKept(db: Queryable, tokens: readonly string[]): Promise<(PendingRow & { token: string })[]> {
  const parsed = tokens
    .map((t) => /^([0-9a-f-]{36}):([A-Za-z0-9_-]{20,64})$/.exec(t.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .slice(0, MAX_FACILITY_FILES);
  if (!parsed.length) return [];
  const { rows } = await db.query<PendingRow>(
    `select id, token_hash, kind, storage_key, mime_type, size_bytes, sha256, file_name from pending_uploads
      where id = any($1::uuid[]) and created_at > now() - make_interval(hours => $2)`,
    [parsed.map((m) => m[1]), PENDING_HOURS],
  );
  return parsed.flatMap((m) => {
    const row = rows.find((r) => r.id === m[1]);
    const ok = row && crypto.timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(sha(Buffer.from(m[2]!))));
    return ok ? [{ ...row, token: m[0] }] : [];
  });
}

export const keptAsList = (rows: { token: string; kind: FacilityDocKind; file_name: string }[]): KeptFile[] =>
  rows.map((r) => ({ token: r.token, kind: r.kind, name: r.file_name }));

/**
 * Files for a new facility: kept ones move over (their storage stays), new ones are stored.
 * Call inside the sign-up transaction; returns the storage keys of new files so the caller can
 * remove them if the transaction fails.
 */
export async function attachSignupFiles(tx: Queryable, storage: FileStorage, facilityId: string, kept: PendingRow[], fresh: TakenFile[]): Promise<string[]> {
  const newKeys: string[] = [];
  for (const k of kept.slice(0, MAX_FACILITY_FILES)) {
    await tx.query('delete from pending_uploads where id = $1', [k.id]);
    await tx.query(
      `insert into facility_documents (facility_id, kind, storage_key, mime_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6)`,
      [facilityId, k.kind, k.storage_key, k.mime_type, k.size_bytes, k.sha256],
    );
  }
  const room = Math.max(0, MAX_FACILITY_FILES - kept.length);
  for (const f of fresh.slice(0, room)) {
    const key = await storage.put(f.data, f.ext);
    newKeys.push(key);
    await tx.query(
      `insert into facility_documents (facility_id, kind, storage_key, mime_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6)`,
      [facilityId, f.kind, key, f.mime, f.data.length, sha(f.data)],
    );
  }
  if (kept.length || fresh.length) await tx.query('update facilities set docs_updated_at = now() where user_id = $1', [facilityId]);
  return newKeys;
}

/** Old kept files nobody came back for. */
export async function purgePendingUploads(deps: Pick<Deps, 'db' | 'storage'>): Promise<number> {
  const { rows } = await deps.db.query<{ id: string; storage_key: string }>(
    `delete from pending_uploads where created_at < now() - make_interval(hours => $1) returning id, storage_key`,
    [PENDING_HOURS],
  );
  for (const r of rows) await deps.storage.remove(r.storage_key).catch(() => undefined);
  return rows.length;
}

// ---------------------------------------------------------------- the facility's own documents

export interface FacilityDoc {
  id: string;
  kind: FacilityDocKind;
  mime_type: FacilityDocMime;
  size_bytes: number;
  uploaded_at: Date;
}

export async function listFacilityDocuments(db: Queryable, facilityId: string): Promise<FacilityDoc[]> {
  const { rows } = await db.query<FacilityDoc>(
    'select id, kind, mime_type, size_bytes, uploaded_at from facility_documents where facility_id = $1 order by uploaded_at',
    [facilityId],
  );
  return rows;
}

/** Adds documents from the dashboard. Bad files are left out and named; limits keep storage bounded. */
export async function addFacilityDocuments(deps: Deps, facilityId: string, uploads: readonly UploadedFile[], ip: string): Promise<{ added: number; refused: string[]; problem: MessageKey | null }> {
  const taken = takeFiles(deps.cfg.MAX_UPLOAD_BYTES, uploads);
  if (!taken.files.length) return { added: 0, refused: taken.refused, problem: taken.refused.length ? null : 'fdocs.err.none' };
  const existing = await listFacilityDocuments(deps.db, facilityId);
  const perKind = new Map<FacilityDocKind, number>();
  for (const d of existing) perKind.set(d.kind, (perKind.get(d.kind) ?? 0) + 1);
  let total = existing.length;
  const accepted: TakenFile[] = [];
  let overLimit = false;
  for (const f of taken.files) {
    if (total >= MAX_FACILITY_FILES || (perKind.get(f.kind) ?? 0) >= MAX_FILES_PER_DOC) {
      overLimit = true;
      continue;
    }
    accepted.push(f);
    total++;
    perKind.set(f.kind, (perKind.get(f.kind) ?? 0) + 1);
  }
  const keys: string[] = [];
  try {
    await deps.db.transaction(async (tx) => {
      for (const f of accepted) {
        const key = await deps.storage.put(f.data, f.ext);
        keys.push(key);
        await tx.query(
          `insert into facility_documents (facility_id, kind, storage_key, mime_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6)`,
          [facilityId, f.kind, key, f.mime, f.data.length, sha(f.data)],
        );
      }
      if (accepted.length) {
        await tx.query('update facilities set docs_updated_at = now(), updated_at = now() where user_id = $1', [facilityId]);
        await audit(tx, { actorId: facilityId, action: 'facility.documents_added', entityType: 'facility', entityId: facilityId, metadata: { count: accepted.length }, ip });
      }
    });
  } catch (e) {
    for (const k of keys) await deps.storage.remove(k).catch(() => undefined);
    throw e;
  }
  return { added: accepted.length, refused: taken.refused, problem: overLimit ? 'fdocs.err.limit' : null };
}

/** A facility may remove its own documents until it is approved (afterwards they are the record). */
export async function deleteFacilityDocument(deps: Deps, facilityId: string, docId: string, ip: string): Promise<MessageKey | null> {
  const { rows } = await deps.db.query<{ storage_key: string; status: string }>(
    `select d.storage_key, f.verification_status as status from facility_documents d join facilities f on f.user_id = d.facility_id
      where d.id = $1 and d.facility_id = $2`,
    [docId, facilityId],
  );
  const doc = rows[0];
  if (!doc) throw notFound();
  if (doc.status === 'approved' || doc.status === 'suspended') return 'fdocs.err.locked';
  await deps.db.query('delete from facility_documents where id = $1 and facility_id = $2', [docId, facilityId]);
  await deps.storage.remove(doc.storage_key).catch(() => undefined);
  await audit(deps.db, { actorId: facilityId, action: 'facility.document_removed', entityType: 'facility_document', entityId: docId, ip });
  return null;
}

export async function readOwnFacilityDocument(deps: Deps, facilityId: string, docId: string): Promise<{ data: Buffer; mime: string }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime_type: string }>(
    'select storage_key, mime_type from facility_documents where id = $1 and facility_id = $2',
    [docId, facilityId],
  );
  if (!rows[0]) throw notFound();
  return { data: await deps.storage.get(rows[0].storage_key), mime: rows[0].mime_type };
}
