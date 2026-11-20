import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { log, errorFields } from '../src/log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both scripts/ (tsx) and dist/scripts/ (compiled).
const candidates = [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations')];

const cfg = loadConfig();
const db = createDb(cfg);
try {
  const { existsSync } = await import('node:fs');
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) throw new Error('migrations directory not found');
  const applied = await migrate(db, dir);
  log.info('migrations complete', { applied });
} catch (err) {
  log.error('migration failed', errorFields(err));
  process.exitCode = 1;
} finally {
  await db.end();
}
