import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt } from '../../src/domain/facilityHours.js';

const tz = 'Africa/Cairo';
// 2026-03-05 is a Thursday (4). Cairo is UTC+2 in March 2026.
const at = (iso: string) => new Date(iso);

test('same-day hours', () => {
  const h = { open24h: false, days: [4], opens: '09:00', closes: '17:00' };
  assert.equal(isOpenAt(h, at('2026-03-05T08:00:00Z'), tz), true); // 10:00 Thu
  assert.equal(isOpenAt(h, at('2026-03-05T15:00:00Z'), tz), false); // 17:00 Thu
  assert.equal(isOpenAt(h, at('2026-03-06T08:00:00Z'), tz), false); // Friday
});

test('late-night hours continue after midnight into the next morning', () => {
  const h = { open24h: false, days: [4], opens: '18:00', closes: '02:00' }; // Thursday evening
  assert.equal(isOpenAt(h, at('2026-03-05T20:00:00Z'), tz), true); // Thu 22:00
  assert.equal(isOpenAt(h, at('2026-03-05T23:30:00Z'), tz), true); // Fri 01:30, still Thursday's shift
  assert.equal(isOpenAt(h, at('2026-03-06T00:30:00Z'), tz), false); // Fri 02:30
  assert.equal(isOpenAt(h, at('2026-03-05T14:00:00Z'), tz), false); // Thu 16:00
  assert.equal(isOpenAt(h, at('2026-03-04T23:30:00Z'), tz), false, 'Wednesday night is not a working night');
});

test('24 hours on chosen days only', () => {
  const h = { open24h: true, days: [0, 1, 2, 3, 4], opens: '00:00', closes: '23:59' };
  assert.equal(isOpenAt(h, at('2026-03-05T21:59:00Z'), tz), true); // Thu 23:59
  assert.equal(isOpenAt(h, at('2026-03-06T10:00:00Z'), tz), false); // Friday
});
