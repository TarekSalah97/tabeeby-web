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
};

/** Serves files from one directory only; no directory listing, no traversal. */
export async function serveStatic(root: string, urlPath: string, res: ServerResponse, method: string): Promise<boolean> {
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
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}
