import crypto from 'node:crypto';

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
