import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearToMonth, displayYears, experienceYears, validatePosition } from '../../src/domain/experience.js';

const now = new Date('2026-11-21T10:00:00Z');

test('years are stored so 2015–2019 counts as 5 full years', () => {
  const p = { start: yearToMonth('2015', 'start', now), end: yearToMonth('2019', 'end', now) };
  assert.deepEqual(p, { start: '2015-01', end: '2020-01' });
  assert.equal(validatePosition(p, now), null);
  assert.equal(experienceYears([p], now), 5);
  assert.deepEqual(displayYears(p, now), { from: '2015', to: '2019' });
});

test('an end in the current year means up to now; Arabic digits and old YYYY-MM still work', () => {
  assert.equal(yearToMonth('2026', 'end', now), '2026-11');
  assert.equal(yearToMonth('٢٠١٨', 'start', now), '2018-01');
  assert.equal(yearToMonth('2021-09', 'start', now), '2021-09');
  assert.deepEqual(displayYears({ start: '2024-01', end: '2026-11' }, now), { from: '2024', to: '2026' });
  assert.deepEqual(displayYears({ start: '2024-01', end: null }, now), { from: '2024', to: null });
});

test('junk and future years are rejected by validation', () => {
  assert.equal(validatePosition({ start: yearToMonth('19', 'start', now), end: null }, now), 'experience.invalidMonth');
  assert.equal(validatePosition({ start: yearToMonth('2030', 'start', now), end: null }, now), 'experience.startInFuture');
  assert.equal(validatePosition({ start: '2015-01', end: yearToMonth('2030', 'end', now) }, now), 'experience.endInFuture');
  assert.equal(validatePosition({ start: yearToMonth('2020', 'start', now), end: yearToMonth('2018', 'end', now) }, now), 'experience.endBeforeStart');
});
