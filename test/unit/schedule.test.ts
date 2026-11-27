import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSchedule, matchesSchedule, foldName, isJustFinished } from '../../src/domain/schedule.js';

const at = (h: number) => new Date(Date.UTC(2026, 10, 27, h, 0));

test('finished visits go to the end; the next patient comes up', () => {
  const list = [
    { id: 'a', status: 'completed' as const, starts_at: at(9) },
    { id: 'b', status: 'cancelled' as const, starts_at: at(9) },
    { id: 'c', status: 'arrived' as const, starts_at: at(10) },
    { id: 'd', status: 'in_consultation' as const, starts_at: at(11) },
    { id: 'e', status: 'confirmed' as const, starts_at: at(9) },
    { id: 'f', status: 'no_show' as const, starts_at: at(8) },
    { id: 'g', status: 'completed' as const, starts_at: at(8) },
  ];
  assert.deepEqual(orderSchedule(list).map((x) => x.id), ['d', 'e', 'c', 'g', 'a', 'f', 'b']);
});

test('a visit finished in the last 3 minutes stays on top, then goes to the end', () => {
  const now = new Date(Date.UTC(2026, 10, 27, 12, 0));
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const list = [
    { id: 'old', status: 'completed' as const, starts_at: at(9), completed_at: ago(10) },
    { id: 'next', status: 'arrived' as const, starts_at: at(11) },
    { id: 'fresh', status: 'completed' as const, starts_at: at(10), completed_at: ago(2.9) },
    { id: 'edge', status: 'completed' as const, starts_at: at(8), completed_at: ago(3) },
    { id: 'gone', status: 'no_show' as const, starts_at: at(8), completed_at: ago(1) },
  ];
  assert.deepEqual(orderSchedule(list, now).map((x) => x.id), ['fresh', 'next', 'edge', 'old', 'gone']);
  // Without a clock (or a minute later) it is the plain working order.
  assert.deepEqual(orderSchedule(list).map((x) => x.id), ['next', 'edge', 'old', 'fresh', 'gone']);
  assert.equal(isJustFinished(list[2]!, new Date(now.getTime() + 60_000)), false);
});

test('schedule search: names in Arabic or English, or part of the number', () => {
  assert.equal(foldName('أحمــد  حَسَن'), 'احمد حسن');
  assert.ok(matchesSchedule('احمد', 'أحمد علي', '+201012345678'));
  assert.ok(matchesSchedule('منه', 'منة الله', '+201012345678'));
  assert.ok(matchesSchedule('mariam', 'Mariam Gaber', '+201000000205'));
  assert.ok(matchesSchedule('0205', 'Mariam Gaber', '+201000000205'));
  assert.ok(matchesSchedule('٠٢٠٥', 'Mariam Gaber', '+201000000205'));
  assert.ok(matchesSchedule('01000000205', 'Mariam Gaber', '+201000000205'));
  assert.ok(!matchesSchedule('heba', 'Mariam Gaber', '+201000000205'));
  assert.ok(!matchesSchedule('12', 'Mariam Gaber', '+201000000205'));
  assert.ok(matchesSchedule('', 'Anyone', '+201000000205'));
});
