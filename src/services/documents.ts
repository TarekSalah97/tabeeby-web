import crypto from 'node:crypto';
import type { Config } from '../config.js';
import type { Queryable } from '../db/db.js';
import type { UploadedFile } from '../http/body.js';
import type { FileStorage } from '../storage/files.js';
import { sniffDocumentType } from '../storage/files.js';
import { docField, type DocKind, type DocSpec } from '../domain/documents.js';
import type { FieldErrors } from './accounts.js';

export interface CheckedDoc {
  kind: DocKind;
  file: UploadedFile;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  ext: 'pdf' | 'jpg' | 'png';
}

/**
 * Checks the sign-up documents: every required one is there, and each uploaded file is a real
 * JPG, PNG or PDF (by its content, not its name) within the size limit. Errors go on the field.
 */
export function checkDocuments(cfg: Pick<Config, 'MAX_UPLOAD_BYTES'>, specs: readonly DocSpec[], files: UploadedFile[], errors: FieldErrors): CheckedDoc[] {
  const docs: CheckedDoc[] = [];
  for (const spec of specs) {
    const field = docField(spec.kind);
    const file = files.find((f) => f.field === field && f.data.length > 0);
    if (!file) {
      if (spec.required) errors[field] = spec.kind === 'syndicate_card' ? 'join.cardRequired' : 'docs.required';
      continue;
    }
    if (file.data.length > cfg.MAX_UPLOAD_BYTES) {
      errors[field] = 'docs.tooLarge';
      continue;
    }
    const type = sniffDocumentType(file.data);
    if (!type) {
      errors[field] = 'docs.invalid';
      continue;
    }
    docs.push({ kind: spec.kind, file, ...type });
  }
  return docs;
}

/** Saves the files; returns their storage keys in the same order (removed again by the caller on failure). */
export async function storeDocuments(storage: FileStorage, docs: CheckedDoc[]): Promise<string[]> {
  const keys: string[] = [];
  try {
    for (const d of docs) keys.push(await storage.put(d.file.data, d.ext));
  } catch (e) {
    await removeDocuments(storage, keys);
    throw e;
  }
  return keys;
}

export async function removeDocuments(storage: FileStorage, keys: string[]): Promise<void> {
  for (const k of keys) await storage.remove(k).catch(() => undefined);
}

/** Inserts the document rows for a doctor or a facility in the caller's transaction. */
export async function insertDocuments(tx: Queryable, table: 'verification_documents' | 'facility_documents', ownerId: string, docs: CheckedDoc[], keys: string[]): Promise<void> {
  const owner = table === 'verification_documents' ? 'doctor_id' : 'facility_id';
  for (const [i, d] of docs.entries()) {
    await tx.query(
      `insert into ${table} (${owner}, kind, storage_key, mime_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6)`,
      [ownerId, d.kind, keys[i], d.mime, d.file.data.length, crypto.createHash('sha256').update(d.file.data).digest('hex')],
    );
  }
}
