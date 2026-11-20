import { PgPool, PgError, type QueryResult } from './pg.js';
import type { Config } from '../config.js';

/** The only database surface the rest of the app sees. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

export interface Tx extends Queryable {
  /** Multi-statement SQL without parameters (migrations only). */
  simpleQuery(text: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs fn in a transaction; commits on success, rolls back on any thrown error. */
  transaction<T>(fn: (tx: Tx) => Promise<T>, isolation?: 'read committed' | 'serializable'): Promise<T>;
  simpleQuery(text: string): Promise<void>;
  end(): Promise<void>;
}

export function createDb(cfg: Pick<Config, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_POOL_SIZE' | 'DATABASE_SSL_CA_FILE'>): Db {
  const pool = PgPool.fromUrl(cfg.DATABASE_URL, cfg.DATABASE_SSL, cfg.DATABASE_POOL_SIZE, cfg.DATABASE_SSL_CA_FILE);
  return {
    query: (text, params) => pool.query(text, params ?? []),
    async transaction(fn, isolation = 'read committed') {
      const client = await pool.connect();
      let destroy = false;
      try {
        await client.query(`begin isolation level ${isolation === 'serializable' ? 'serializable' : 'read committed'}`);
        const result = await fn({
          query: (t, p) => client.query(t, p ?? []),
          simpleQuery: async (t) => {
            await client.simpleQuery(t);
          },
        });
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          destroy = true;
        }
        if (!(err instanceof PgError) && !(err instanceof Error)) destroy = true;
        throw err;
      } finally {
        client.release(destroy);
      }
    },
    async simpleQuery(text) {
      const client = await pool.connect();
      try {
        await client.simpleQuery(text);
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export const isUniqueViolation = (e: unknown, constraint?: string): boolean =>
  e instanceof PgError && e.code === '23505' && (!constraint || e.constraint === constraint);

export const isExclusionViolation = (e: unknown, constraint?: string): boolean =>
  e instanceof PgError && e.code === '23P01' && (!constraint || e.constraint === constraint);

export { PgError };
