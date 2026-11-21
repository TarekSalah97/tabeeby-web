import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameName } from '../../src/domain/personName.js';

test('same person despite case, spaces and Arabic letter variants', () => {
  assert.ok(sameName('tarek tarahony', 'Tarek  Tarahony'));
  assert.ok(sameName('Tarek', 'Tarek Tarahony'));
  assert.ok(sameName('أحمد محمد', 'احمد محمد علي'));
  assert.ok(sameName('فاطمة', 'فاطمه'));
});

test('different people sharing a phone are not merged', () => {
  assert.ok(!sameName('Tarek Tarahony', 'Mona Tarahony'));
  assert.ok(!sameName('Ahmed Ali', 'Ahmed Hassan'));
  assert.ok(!sameName('', 'Ahmed'));
});
