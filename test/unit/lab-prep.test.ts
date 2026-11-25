import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepFor, mayNeedContrast, isKidneyTest, BUILT_IN_LAB_SETS } from '../../src/domain/labPrep.js';
import { labTest } from '../../src/domain/clinical.js';

const item = (test_code: string | null, test_name: string | null = null) => ({ test_code, test_name });

test('preparation advice: per test, no repeats, nothing for tests without preparation', () => {
  assert.deepEqual(prepFor([item('fbs'), item('cbc')]), ['prep.fast8']);
  assert.deepEqual(prepFor([item('ct'), item('xray_chest')]), ['prep.contrast', 'prep.pregnancy']);
  assert.deepEqual(prepFor([item('mri')]), ['prep.contrast', 'prep.mri']);
  assert.deepEqual(prepFor([item('tsh'), item(null, 'Anything')]), []);
});

test('contrast and kidney tests are recognised', () => {
  assert.equal(mayNeedContrast([item('ct')]), true);
  assert.equal(mayNeedContrast([item('us_abdomen'), item('xray_chest')]), false);
  assert.equal(isKidneyTest(item('kft')), true);
  assert.equal(isKidneyTest(item(null, 'Serum Creatinine')), true);
  assert.equal(isKidneyTest(item(null, 'كرياتينين')), true);
  assert.equal(isKidneyTest(item('cbc')), false);
});

test('built-in sets only use known tests and have unique ids', () => {
  assert.equal(new Set(BUILT_IN_LAB_SETS.map((s) => s.id)).size, BUILT_IN_LAB_SETS.length);
  for (const s of BUILT_IN_LAB_SETS) for (const c of s.codes) assert.ok(labTest(c), c);
});
