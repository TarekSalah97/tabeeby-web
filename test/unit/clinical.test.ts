import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, LAB_TESTS, MEDICINE_FORMS, FREQUENCIES, TIMINGS, HABITS } from '../../src/domain/clinical.js';
import { validateRx, validateLab } from '../../src/services/records.js';
import fs from 'node:fs';

test('age from date of birth, counting the birthday itself', () => {
  assert.equal(ageOn('1990-05-20', '2026-05-19'), 35);
  assert.equal(ageOn('1990-05-20', '2026-05-20'), 36);
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(ageOn('2026-01-01', '2026-11-20'), 0);
  assert.equal(ageOn(null, '2026-11-20'), null);
  assert.equal(ageOn('2030-01-01', '2026-11-20'), null);
});

const line = (o: Partial<Record<'medicine' | 'form' | 'dose' | 'frequency' | 'timing' | 'duration' | 'instructions', string>>) =>
  ({ medicine: '', form: '', dose: '', frequency: '', timing: '', duration: '', instructions: '', ...o });

test('prescription lines: blanks skipped, incomplete lines named, unknown codes rejected', () => {
  const ok = validateRx({ lines: [line({}), line({ medicine: '  Augmentin   1 g ', form: 'tablet', dose: '1 tablet', frequency: 'twice_daily', timing: 'bogus' })], notes: '' });
  assert.ok(!('key' in ok));
  assert.deepEqual(ok.lines, [{ medicine: 'Augmentin 1 g', form: 'tablet', dose: '1 tablet', frequency: 'twice_daily', timing: null, duration: null, instructions: null }]);
  assert.deepEqual(validateRx({ lines: [line({ medicine: 'A', form: 'tablet', dose: '1', frequency: 'once_daily' }), line({ dose: '2' })], notes: '' }), { key: 'rx.err.line', line: 2 });
  // Only the name is required; unknown codes from a tampered form are dropped, and an over-long dose is refused.
  assert.deepEqual(validateRx({ lines: [line({ medicine: 'A', form: 'pill', dose: '1', frequency: 'bogus' })], notes: '' }), { lines: [{ medicine: 'A', form: null, dose: '1', frequency: null, timing: null, duration: null, instructions: null }], notes: null });
  assert.deepEqual(validateRx({ lines: [line({ medicine: 'A', dose: 'x'.repeat(61) })], notes: '' }), { key: 'rx.err.line', line: 1 });
  assert.deepEqual(validateRx({ lines: Array.from({ length: 21 }, () => line({ medicine: 'A', form: 'tablet', dose: '1', frequency: 'once_daily' })), notes: '' }), { key: 'rx.err.tooMany' });
});

test('lab orders: known codes and typed tests, deduplicated', () => {
  const ok = validateLab({ codes: ['cbc', 'cbc'], other: 'Throat swab\n\n throat  swab \nX', notes: '' });
  assert.ok(!('key' in ok));
  assert.deepEqual(ok.items, [{ code: 'cbc', name: null }, { code: null, name: 'Throat swab' }, { code: null, name: 'throat swab' }, { code: null, name: 'X' }]);
  assert.deepEqual(validateLab({ codes: ['nope'], other: '', notes: '' }), { key: 'lab.err.unknown' });
});

test('fixed lists match the database constraints', () => {
  const sql = fs.readFileSync(new URL('../../migrations/004_clinical_records.sql', import.meta.url), 'utf8');
  for (const list of [MEDICINE_FORMS, FREQUENCIES, TIMINGS, HABITS]) for (const code of list) assert.ok(sql.includes(`'${code}'`), code);
  assert.equal(new Set(LAB_TESTS.map((t) => t.code)).size, LAB_TESTS.length, 'lab codes unique');
  for (const t of LAB_TESTS) assert.match(t.code, /^[a-z0-9_]{2,40}$/);
});
