/**
 * Creates (or promotes) an admin account. There is deliberately no web sign-up
 * for admins. Credentials come from environment variables so they never appear
 * in shell history or process listings:
 *
 *   ADMIN_NAME="Ops Lead" ADMIN_PHONE=01012345678 ADMIN_PASSWORD='…' npm run create-admin
 */
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/db.js';
import { hashPassword, checkPasswordPolicy } from '../src/auth/password.js';
import { normalizeEgyptMobile } from '../src/domain/phone.js';

const cfg = loadConfig();
const name = process.env['ADMIN_NAME']?.trim();
const phone = normalizeEgyptMobile(process.env['ADMIN_PHONE'] ?? '');
const password = process.env['ADMIN_PASSWORD'] ?? '';

if (!name || !phone) {
  console.error('Set ADMIN_NAME and a valid Egyptian ADMIN_PHONE.');
  process.exit(1);
}
const problem = checkPasswordPolicy(password, [name]);
if (problem || password.length < 14) {
  console.error('ADMIN_PASSWORD must be at least 14 characters and not a common password.');
  process.exit(1);
}

const db = createDb(cfg);
try {
  const hash = await hashPassword(password);
  const { rows } = await db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at, preferred_locale)
     values ('admin', $1, $2, $3, now(), 'en')
     on conflict (phone_e164) do update set role = 'admin', password_hash = excluded.password_hash, status = 'active', updated_at = now()
     returning id`,
    [name, phone, hash],
  );
  await db.query('delete from sessions where user_id = $1', [rows[0]!.id]);
  console.log(`Admin ready: ${name} (${phone}).`);
} finally {
  await db.end();
}
