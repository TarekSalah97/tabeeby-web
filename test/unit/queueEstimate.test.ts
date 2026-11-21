import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateQueue, type QueueVisit } from '../../src/domain/queueEstimate.js';
import type { AppointmentStatus } from '../../src/domain/appointmentStatus.js';

const T = (hhmm: string) => new Date(`2026-03-01T${hhmm}:00Z`);
const v = (id: string, start: string, status: AppointmentStatus, extra: Partial<QueueVisit> = {}): QueueVisit => {
  const s = T(start);
  return { id, startsAt: s, endsAt: new Date(s.getTime() + 20 * 60_000), status, consultStartedAt: null, completedAt: null, ...extra };
};

test('before the clinic starts: the wait is simply the time to the booked slot', () => {
  const e = estimateQueue([v('a', '10:00', 'confirmed'), v('me', '10:20', 'confirmed')], 'me', T('09:00'))!;
  assert.equal(e.stage, 'booked');
  assert.equal(e.ahead, 1);
  assert.equal(e.waitMin, 80);
  assert.equal(e.delayMinutes, 0);
  assert.equal(e.paceFromToday, false);
  assert.equal(e.visitMinutes, 20);
});

test('running late: people ahead push the time past the booked slot, using today\'s real pace', () => {
  const visits = [
    v('d1', '09:00', 'completed', { consultStartedAt: T('09:10'), completedAt: T('09:40') }), // 30 min
    v('d2', '09:20', 'completed', { consultStartedAt: T('09:40'), completedAt: T('10:10') }), // 30 min
    v('in', '09:40', 'in_consultation', { consultStartedAt: T('10:10') }),
    v('w1', '10:00', 'arrived'),
    v('me', '10:20', 'arrived'),
  ];
  const e = estimateQueue(visits, 'me', T('10:20'))!;
  assert.equal(e.paceFromToday, true);
  assert.equal(e.visitMinutes, 30);
  assert.equal(e.ahead, 2);
  // inside: 10 of 30 min done → 20 left; then w1 30 → 50 min from now.
  assert.equal(e.waitMin, 50);
  assert.ok(e.waitMax! > e.waitMin!);
  assert.equal(e.delayMinutes, 50);
  assert.equal(e.stage, 'arrived');
});

test('cancelled and no-show visits ahead do not count; next in line says so', () => {
  const e = estimateQueue([v('x', '10:00', 'cancelled'), v('y', '10:20', 'no_show'), v('me', '10:40', 'arrived')], 'me', T('10:45'))!;
  assert.equal(e.ahead, 0);
  assert.equal(e.stage, 'next');
  assert.equal(e.waitMin, 0);
});

test('a long consultation still leaves at least a few minutes, never a negative wait', () => {
  const e = estimateQueue([v('in', '10:00', 'in_consultation', { consultStartedAt: T('10:00') }), v('me', '10:20', 'arrived')], 'me', T('11:30'))!;
  assert.ok(e.waitMin! >= 0 && e.waitMin! <= 5);
});

test('with the doctor, done, and closed visits have no wait', () => {
  assert.equal(estimateQueue([v('me', '10:00', 'in_consultation')], 'me', T('10:05'))!.stage, 'with_doctor');
  assert.equal(estimateQueue([v('me', '10:00', 'completed')], 'me', T('10:30'))!.waitMin, null);
  assert.equal(estimateQueue([v('me', '10:00', 'cancelled')], 'me', T('10:30'))!.stage, 'closed');
  assert.equal(estimateQueue([v('a', '10:00', 'confirmed')], 'me', T('10:30')), null);
});

test('one finished visit is not enough evidence: the slot length is used', () => {
  const e = estimateQueue([v('d1', '09:00', 'completed', { consultStartedAt: T('09:00'), completedAt: T('10:00') }), v('me', '09:20', 'confirmed')], 'me', T('10:00'))!;
  assert.equal(e.paceFromToday, false);
  assert.equal(e.visitMinutes, 20);
});
