import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderSchedule, matchesSchedule, foldName } from '../../src/domain/schedule.js';

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
