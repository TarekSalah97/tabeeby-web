import crypto from 'node:crypto';
import type { Queryable } from '../db/db.js';
import { log, errorFields } from '../log.js';

/*
 * Web Push (phone / browser notifications) without third-party packages:
 *  - VAPID (RFC 8292): an ES256-signed token proves the messages come from this site;
 *  - message encryption (RFC 8291, "aes128gcm" from RFC 8188): only the patient's browser can read it.
 * The site's VAPID key pair is created once and kept in the database (app_secrets).
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export type PushOutcome = 'ok' | 'gone' | 'error';

export interface PushSender {
  send(sub: PushSubscriptionKeys, payload: string, ttlSeconds: number): Promise<PushOutcome>;
}

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/**
 * Only the browsers' own push services: the endpoint comes from the browser, and without this
 * check a crafted "subscription" could make our server call any address (SSRF).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^(.+\.)?push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^(.+\.)?notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];

export function isAllowedEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

/** A subscription as sent by the browser: sane sizes and a real P-256 point / 16-byte secret. */
export function validSubscription(s: PushSubscriptionKeys): boolean {
  if (s.endpoint.length > 1000 || !isAllowedEndpoint(s.endpoint)) return false;
  if (!/^[A-Za-z0-9_-]+=*$/.test(s.p256dh) || !/^[A-Za-z0-9_-]+=*$/.test(s.auth)) return false;
  const key = fromB64u(s.p256dh);
  const auth = fromB64u(s.auth);
  if (key.length !== 65 || key[0] !== 4 || auth.length !== 16) return false;
  try {
    const probe = crypto.createECDH('prime256v1');
    probe.generateKeys();
    probe.computeSecret(key); // throws if not on the curve
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- VAPID keys

export interface VapidKeys {
  /** Uncompressed public key, base64url (given to browsers as applicationServerKey). */
  publicKey: string;
  privateKey: crypto.KeyObject;
}

let cached: VapidKeys | null = null;

export function clearVapidCache(): void {
  cached = null;
}

export async function vapidKeys(db: Queryable): Promise<VapidKeys> {
  if (cached) return cached;
  const read = async () => (await db.query<{ value: string }>(`select value from app_secrets where name = 'vapid'`)).rows[0]?.value;
  let stored = await read();
  if (!stored) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    // If two processes race, the first insert wins and both read it back.
    await db.query(`insert into app_secrets (name, value) values ('vapid', $1) on conflict (name) do nothing`, [JSON.stringify(jwk)]);
    stored = await read();
  }
  const jwk = JSON.parse(stored!) as { x: string; y: string; d: string; kty: string; crv: string };
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  cached = { publicKey, privateKey };
  return cached;
}

/** "vapid t=<JWT>, k=<public key>" for one push service. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: Date): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------- encryption (RFC 8291)

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();

/** Encrypts one message for one browser. `salt` and `ephemeral` are only passed in tests. */
export function encryptPayload(
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  payload: Buffer,
  salt: Buffer = crypto.randomBytes(16),
  ephemeral?: crypto.ECDH,
): Buffer {
  if (!ephemeral) {
    ephemeral = crypto.createECDH('prime256v1');
    ephemeral.generateKeys();
  }
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const asPublic = ephemeral.getPublicKey();
  const ecdhSecret = ephemeral.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the message, then the 0x02 "last record" delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// ---------------------------------------------------------------- sending

export class WebPushSender implements PushSender {
  constructor(
    private readonly db: Queryable,
    private readonly subject: string,
  ) {}

  async send(sub: PushSubscriptionKeys, payload: string, ttlSeconds: number): Promise<PushOutcome> {
    if (!isAllowedEndpoint(sub.endpoint)) return 'gone';
    const keys = await vapidKeys(this.db);
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(sub.endpoint, keys, this.subject, new Date()),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(ttlSeconds),
          Urgency: 'high',
        },
        body: new Uint8Array(encryptPayload(sub, Buffer.from(payload, 'utf8'))),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) return 'gone'; // unsubscribed / expired
      if (!res.ok) {
        log.warn('push rejected', { status: res.status, host: new URL(sub.endpoint).hostname });
        return 'error';
      }
      return 'ok';
    } catch (err) {
      log.warn('push failed', { host: new URL(sub.endpoint).hostname, ...errorFields(err) });
      return 'error';
    }
  }
}
