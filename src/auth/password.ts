import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/**
 * scrypt with N=2^14, r=8, p=5 — one of OWASP's recommended scrypt settings
 * (about 16 MiB of memory per hash, which keeps login bursts safe on a small
 * server). Argon2id is preferred when the argon2 package can be installed;
 * the stored format records parameters so hashes can be upgraded on login.
 */
const PARAMS = { N: 2 ** 14, r: 8, p: 5 } as const;
const KEYLEN = 32;

export const PASSWORD_MIN = 9;
/** Upper bound exists only to stop multi-megabyte "passwords" being hashed (DoS). */
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  '123456789', '1234567890', 'password1', 'password123', 'qwertyuiop', '123123123', '111111111',
  '987654321', 'iloveyou1', 'abc123456', 'qwerty123', '000000000', '123456789a', 'a123456789',
  'tabeeby123', 'egypt1234', 'alexandria', 'doctor123', 'welcome123', 'admin1234',
]);

export type PasswordProblem = 'password.tooShort' | 'password.tooLong' | 'password.tooCommon';

export function checkPasswordPolicy(pw: string, context: string[] = []): PasswordProblem | null {
  if ([...pw].length < PASSWORD_MIN) return 'password.tooShort';
  if (pw.length > PASSWORD_MAX) return 'password.tooLong';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'password.tooCommon';
  if (/^(.)\1+$/.test(pw)) return 'password.tooCommon';
  if (context.some((c) => c.length >= 4 && lower.includes(c.toLowerCase()))) return 'password.tooCommon';
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(pw.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$`);
}

/**
 * A precomputed hash used when the account does not exist, so "unknown phone"
 * and "wrong password" take the same time (no user enumeration by timing).
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(12).toString('hex'));
  return dummyHash;
}
