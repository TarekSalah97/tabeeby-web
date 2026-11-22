import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestShield, isProbe } from '../../src/http/shield.js';

test('each IP has its own budget per minute; forms get a smaller one', () => {
  let t = 0;
  const s = new RequestShield({ pagesPerMinute: 3, postsPerMinute: 1 }, () => t);
  assert.ok(s.allow('a', false) && s.allow('a', false) && s.allow('a', false));
  assert.equal(s.allow('a', false), false);
  assert.ok(s.allow('b', false), 'other visitors are not affected');
  assert.ok(s.allow('a', true));
  assert.equal(s.allow('a', true), false);
  t = 60_000;
  assert.ok(s.allow('a', false) && s.allow('a', true), 'budget refills after a minute');
});

test('attack probes are recognised; real pages are not', () => {
  for (const p of ['/wp-login.php', '/.env', '/.git/config', '/admin/../../etc/passwd', '/phpmyadmin/', '/index.php', '/x/%2e%2e%2fetc', '/cgi-bin/x', '/%E0%A4%A']) {
    assert.ok(isProbe(p), p);
  }
  for (const p of ['/', '/en/doctors/dr-ahmed-hassan', '/admin', '/dashboard/clinics', '/static/styles.css', '/en/search', '/health-record']) {
    assert.ok(!isProbe(p), p);
  }
});
