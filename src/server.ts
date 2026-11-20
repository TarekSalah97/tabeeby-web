import { loadConfig } from './config.js';
import { createDb } from './db/db.js';
import { createApp } from './app.js';
import { createSmsProvider } from './services/sms.js';
import { LocalFileStorage, DbFileStorage } from './storage/files.js';
import { startWorker } from './jobs/worker.js';
import { log, setLogLevel, errorFields } from './log.js';
import type { Deps } from './http/context.js';

const cfg = loadConfig();
setLogLevel(cfg.LOG_LEVEL);

const db = createDb(cfg);
const deps: Deps = {
  cfg,
  db,
  sms: createSmsProvider(cfg),
  storage: cfg.STORAGE_DRIVER === 'db' ? new DbFileStorage(db) : new LocalFileStorage(cfg.UPLOAD_DIR),
  now: () => new Date(),
};
if (cfg.SMS_PROVIDER === 'none') log.warn('running without SMS: phone numbers are not verified and no confirmations or reminders are sent');

const server = createApp(deps);
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 10_000;

const stopWorker = cfg.RUN_WORKER ? startWorker(deps) : () => undefined;

server.listen(cfg.PORT, cfg.HOST, () => log.info('tabeeby listening', { port: cfg.PORT, env: cfg.NODE_ENV }));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  stopWorker();
  server.close();
  setTimeout(() => process.exit(1), 15_000).unref();
  await new Promise((r) => server.on('close', r));
  await deps.db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', errorFields(err)));
