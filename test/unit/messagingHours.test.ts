import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenNow } from '../../src/domain/messagingHours.js';

const h = { days: [0, 1, 2, 3, 4], start: '10:00', end: '20:00' }; // Sun–Thu
const tz = 'Africa/Cairo';

test('open inside the hours on a chosen day (Cairo time)', () => {
  // Sunday 2026-03-01 12:00 Cairo = 10:00 UTC
  assert.equal(isOpenNow(h, new Date('2026-03-01T10:00:00Z'), tz), true);
});

test('closed before the start, at the end minute, and on other days', () => {
  assert.equal(isOpenNow(h, new Date('2026-03-01T07:59:00Z'), tz), false); // 09:59
  assert.equal(isOpenNow(h, new Date('2026-03-01T18:00:00Z'), tz), false); // 20:00
  assert.equal(isOpenNow(h, new Date('2026-03-06T10:00:00Z'), tz), false); // Friday
});

test('uses the clinic day, not the UTC day, near midnight', () => {
  // Thursday 23:30 UTC is already Friday 01:30 in Cairo.
  assert.equal(isOpenNow({ days: [5], start: '00:00', end: '03:00' }, new Date('2026-03-05T23:30:00Z'), tz), true);
});
