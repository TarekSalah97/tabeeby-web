import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { clientIp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const req = (headers: Record<string, string>, remote = '10.0.0.5') => ({ headers, socket: { remoteAddress: remote } }) as unknown as http.IncomingMessage;

test('a faked first X-Forwarded-For entry is never used', () => {
  // The visitor sends "1.2.3.4"; the trusted proxy appends the real address last.
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 41.33.10.20' }), true), '41.33.10.20');
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), false), '10.0.0.5', 'proxy not trusted: socket address');
});

test('the edge header (Cloudflare True-Client-IP on Render) wins over X-Forwarded-For', () => {
  assert.equal(clientIp(req({ 'true-client-ip': '41.33.10.20', 'x-forwarded-for': '1.2.3.4, 104.22.17.40' }), true, 'true-client-ip'), '41.33.10.20');
  assert.equal(clientIp(req({ 'true-client-ip': 'not an ip<script>', 'x-forwarded-for': '9.9.9.9' }), true, 'true-client-ip'), '9.9.9.9');
});

test('on Render the edge header is chosen automatically', () => {
  const base = { DATABASE_URL: 'postgres://u:p@h/db', NODE_ENV: 'test' as const };
  assert.equal(loadConfig({ ...base, RENDER: 'true' }).CLIENT_IP_HEADER, 'true-client-ip');
  assert.equal(loadConfig({ ...base }).CLIENT_IP_HEADER, '');
});
