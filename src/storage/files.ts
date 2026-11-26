import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Queryable } from '../db/db.js';

/**
 * Private file storage for verification documents. Local disk today; the
 * interface lets you move to object storage (with server-side encryption)
 * without touching callers. Files are never served from a public URL.
 */
export interface FileStorage {
  put(data: Buffer, extension: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f]{32}\.(pdf|jpg|png|webp|heic|avif)$/;

export class LocalFileStorage implements FileStorage {
  constructor(private readonly dir: string) {}

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('invalid storage key');
    return path.join(this.dir, key);
  }

  async put(data: Buffer, extension: string): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const key = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
    await fs.writeFile(this.resolve(key), data, { mode: 0o600, flag: 'wx' });
    return key;
  }

  get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/**
 * Files kept in PostgreSQL. Used on hosts without a persistent disk (free tiers),
 * so verification documents survive restarts and are covered by database backups.
 */
export class DbFileStorage implements FileStorage {
  constructor(private readonly db: Queryable) {}

  async put(data: Buffer, extension: string): Promise<string> {
    const key = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
    await this.db.query('insert into stored_files (key, data) values ($1, $2)', [key, data]);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (!KEY_RE.test(key)) throw new Error('invalid storage key');
    const { rows } = await this.db.query<{ data: string }>('select data from stored_files where key = $1', [key]);
    if (!rows[0]) throw new Error('file not found');
    // bytea arrives in hex text form ('\x…') from the driver.
    return Buffer.from(String(rows[0].data).replace(/^\\x/, ''), 'hex');
  }

  async remove(key: string): Promise<void> {
    await this.db.query('delete from stored_files where key = $1', [key]);
  }
}

/** Detect type from content, never from the filename or the browser's claim. */
export type FacilityDocMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'image/avif';

/**
 * Any photo a phone produces, or a PDF — recognised by content, not by name: JPG, PNG, WebP,
 * iPhone HEIC/HEIF, AVIF, PDF. Anything else (Word files, videos, …) is refused.
 */
export function sniffFacilityDocument(data: Buffer): { mime: FacilityDocMime; ext: 'pdf' | 'jpg' | 'png' | 'webp' | 'heic' | 'avif' } | null {
  const basic = sniffDocumentType(data);
  if (basic) return basic;
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (data.length >= 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (['mif1', 'msf1'].includes(brand)) return { mime: 'image/heif', ext: 'heic' };
    if (['avif', 'avis'].includes(brand)) return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

export function sniffDocumentType(data: Buffer): { mime: 'application/pdf' | 'image/jpeg' | 'image/png'; ext: 'pdf' | 'jpg' | 'png' } | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  return null;
}
