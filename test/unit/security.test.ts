import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, escapeHtml, trusted } from '../../src/views/html.js';
import { checkPasswordPolicy, hashPassword, verifyPassword, needsRehash } from '../../src/auth/password.js';
import { checkCsrfToken, checkOrigin } from '../../src/auth/csrf.js';
import { safeNext } from '../../src/http/context.js';
import { parseMultipart, parseUrlEncoded } from '../../src/http/body.js';
import { sniffDocumentType } from '../../src/storage/files.js';
import { encodeParam } from '../../src/db/pg.js';
import { en } from '../../src/i18n/en.js';
import { ar } from '../../src/i18n/ar.js';
import { loadConfig } from '../../src/config.js';

test('html: interpolated values are escaped, SafeHtml is not', () => {
  const evil = `<script>alert("x")</script>' onmouseover='x`;
  const out = html`<p title="${evil}">${evil}${trusted('<b>ok</b>')}</p>`.value;
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes(`' onmouseover`));
  assert.ok(out.includes('<b>ok</b>'));
  assert.equal(escapeHtml('a&b`c'), 'a&amp;b&#96;c');
  assert.equal(html`${['<i>', html`<i>`]}`.value, '&lt;i&gt;<i>');
});

test('password policy: 9+ characters, no common or name-based passwords', () => {
  assert.equal(checkPasswordPolicy('short123'), 'password.tooShort');
  assert.equal(checkPasswordPolicy('123456789'), 'password.tooCommon');
  assert.equal(checkPasswordPolicy('aaaaaaaaaaaa'), 'password.tooCommon');
  assert.equal(checkPasswordPolicy('ahmedhassan2026', ['Ahmed Hassan', 'hassan']), 'password.tooCommon');
  assert.equal(checkPasswordPolicy('x'.repeat(129)), 'password.tooLong');
  assert.equal(checkPasswordPolicy('blue-river-kettle'), null);
});

test('password hashing: verifies correct password only', async () => {
  const h = await hashPassword('blue-river-kettle');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('blue-river-kettle', h), true);
  assert.equal(await verifyPassword('blue-river-kettlE', h), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
  assert.equal(needsRehash(h), false);
  assert.notEqual(await hashPassword('blue-river-kettle'), h, 'salted');
});

test('csrf: token must match and origin must be ours', () => {
  const token = 'a'.repeat(43);
  assert.equal(checkCsrfToken(token, token), true);
  assert.equal(checkCsrfToken(token, 'b'.repeat(43)), false);
  assert.equal(checkCsrfToken(undefined, token), false);
  assert.equal(checkCsrfToken('short', 'short'), false);
  assert.equal(checkOrigin({ origin: 'https://tabeeby.com' }, 'https://tabeeby.com'), true);
  assert.equal(checkOrigin({ origin: 'https://evil.example' }, 'https://tabeeby.com'), false);
  assert.equal(checkOrigin({ referer: 'https://evil.example/x' }, 'https://tabeeby.com'), false);
  assert.equal(checkOrigin({ referer: 'https://tabeeby.com/en/login' }, 'https://tabeeby.com'), true);
});

test('open redirects are refused', () => {
  assert.equal(safeNext('/dashboard'), '/dashboard');
  assert.equal(safeNext('/book?doctor=x'), '/book?doctor=x');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/a\r\nSet-Cookie: x=y', '']) {
    assert.equal(safeNext(bad), null, bad);
  }
});

test('multipart: fields and files parsed; bad bodies rejected', () => {
  const b = 'XyZ123';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="fullName"\r\n\r\nد. أحمد\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="card"; filename="../../etc/card.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from('%PDF-1.4 data'),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const parsed = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.deepEqual(parsed.fields['fullName'], ['د. أحمد']);
  assert.equal(parsed.files[0]!.filename.includes('/'), false);
  assert.equal(parsed.files[0]!.data.toString(), '%PDF-1.4 data');
  assert.throws(() => parseMultipart(Buffer.from('garbage'), `multipart/form-data; boundary=${b}`));
  assert.deepEqual(parseUrlEncoded(Buffer.from('a=1&a=2&b=x%20y'))['a'], ['1', '2']);
});

test('uploads: type is detected from content, not the name', () => {
  assert.equal(sniffDocumentType(Buffer.from('%PDF-1.7'))?.mime, 'application/pdf');
  assert.equal(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
  assert.equal(sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext, 'png');
  assert.equal(sniffDocumentType(Buffer.from('<html><script>')), null);
});

test('db params: arrays and special values are encoded safely', () => {
  assert.equal(encodeParam(['a"b', 'c\\d', null]), '{"a\\"b","c\\\\d",NULL}');
  assert.equal(encodeParam(true), 't');
  assert.equal(encodeParam(null), null);
  assert.equal(encodeParam(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
});

test('i18n: Arabic has every English key and the same placeholders', () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(ar[key], `missing ar: ${key}`);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(vars(ar[key]), vars(en[key]), `placeholders differ: ${key}`);
  }
});

test('config: unsafe production settings are refused', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@y/z', PUBLIC_ORIGIN: 'http://tabeeby.com' }), /https/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@y/z', PUBLIC_ORIGIN: 'https://tabeeby.com' }), /SMS_PROVIDER/);
  assert.doesNotThrow(() =>
    loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@y/z', PUBLIC_ORIGIN: 'https://tabeeby.com', SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://sms.example/send', SMS_HTTP_TOKEN: 't' }),
  );
  // A public demo may print codes instead of sending SMS; the origin can come from the host.
  const demo = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@y/z', DEMO_MODE: 'true', RENDER_EXTERNAL_URL: 'https://tabeeby-demo.onrender.com' });
  assert.equal(demo.PUBLIC_ORIGIN, 'https://tabeeby-demo.onrender.com');
  assert.equal(demo.SMS_PROVIDER, 'console');
});
