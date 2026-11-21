import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceOf, visitForOnlineBooking } from '../../src/domain/visitPricing.js';

const prices = { fee: 400, followUpFee: 200, followUpDays: 14 };
const start = new Date('2026-05-20T10:00:00Z');
const daysBefore = (n: number) => new Date(start.getTime() - n * 86400_000);

test('a first visit is a new visit at the full price', () => {
  assert.deepEqual(visitForOnlineBooking(prices, null, start), { type: 'new', fee: 400 });
});

test('a finished visit within the period makes it a follow-up, including the last day', () => {
  assert.deepEqual(visitForOnlineBooking(prices, daysBefore(3), start), { type: 'follow_up', fee: 200 });
  assert.deepEqual(visitForOnlineBooking(prices, daysBefore(14), start), { type: 'follow_up', fee: 200 });
  assert.deepEqual(visitForOnlineBooking(prices, daysBefore(15), start), { type: 'new', fee: 400 });
});

test('a "finished" visit after the new appointment does not count', () => {
  assert.equal(visitForOnlineBooking(prices, new Date(start.getTime() + 3600_000), start).type, 'new');
});

test('no follow-up price means follow-ups cost the same', () => {
  const same = { fee: 300, followUpFee: null, followUpDays: 10 };
  assert.deepEqual(visitForOnlineBooking(same, daysBefore(2), start), { type: 'follow_up', fee: 300 });
  assert.equal(priceOf(same, 'follow_up'), 300);
  assert.equal(priceOf(prices, 'new'), 400);
});
