import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Serves files from one directory only; no directory listing, no traversal. */
export async function serveStatic(root: string, urlPath: string, res: ServerResponse, method: string, versioned = false): Promise<boolean> {
  const rel = urlPath.replace(/^\/static\//, '');
  if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(rel) || rel.includes('..')) return false;
  const ext = path.extname(rel);
  const type = TYPES[ext];
  if (!type) return false;
  const file = path.join(root, rel);
  if (!file.startsWith(path.resolve(root) + path.sep)) return false;
  try {
    const data = await fs.readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    // Fingerprinted links (?v=…) never change content, so they can be kept for a year; plain links only briefly.
    res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    res.end(method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

/**
 * A short fingerprint of a static file's content, added to its link ("styles.css?v=1a2b3c4d") so that
 * every deploy that changes the file gives browsers a new address and they never keep an old copy.
 * Computed once per file per process; "dev" if the file cannot be read.
 */
const versions = new Map<string, string>();
export function assetVersion(root: string, rel: string): string {
  const cached = versions.get(rel);
  if (cached) return cached;
  let v = 'dev';
  try {
    v = crypto.createHash('sha256').update(fsSync.readFileSync(path.join(root, rel))).digest('hex').slice(0, 10);
  } catch {
    /* keep "dev" */
  }
  versions.set(rel, v);
  return v;
}
