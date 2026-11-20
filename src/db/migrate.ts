import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db } from './db.js';
import { log } from '../log.js';

/**
 * Forward-only migrations. Each file in migrations/ runs once, in name order,
 * inside a transaction, guarded by an advisory lock so two deploys cannot race.
 * An applied file whose contents later change aborts the run (edit = new file).
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();

  const applied: string[] = [];
  await db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(727274)');
    await tx.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map(
      (await tx.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) throw new Error(`migration ${file} was modified after being applied`);
        continue;
      }
      log.info('applying migration', { file });
      await tx.simpleQuery(sql);
      await tx.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file, checksum]);
      applied.push(file);
    }
  });
  return applied;
}
