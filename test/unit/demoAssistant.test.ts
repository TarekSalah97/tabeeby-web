import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assist, type AssistInput } from '../../src/services/demoAssistant.js';

const patient: AssistInput['patient'] = { ageYears: 40, sex: 'female', allergies: null, habits: [], chronic: null, medications: null };

test('ranks the best-matching presentation first and keeps at most 5 suggestions', () => {
  const r = assist({ complaint: 'Fever and burning urine', history: 'Back pain for 2 days', examination: '', patient });
  assert.equal(r.matched, true);
  assert.equal(r.suggestions[0]!.condition, 'Acute pyelonephritis');
  assert.ok(r.suggestions.length <= 5);
  assert.ok(r.tests.includes('Urine culture'));
});

test('understands Arabic complaints too', () => {
  assert.equal(assist({ complaint: 'صداع نصفي مع غثيان', history: '', examination: '', patient }).suggestions[0]!.condition, 'Migraine without aura');
});

test('no match gives no invented suggestions; "none" allergies are not flagged', () => {
  const r = assist({ complaint: 'xyz', history: '', examination: '', patient: { ...patient, allergies: 'None known', medications: 'None' } });
  assert.equal(r.matched, false);
  assert.deepEqual(r.suggestions, []);
  assert.deepEqual(r.cautions, []);
});

test('patient file cautions: allergy, child dosing', () => {
  const r = assist({ complaint: 'Ear pain and fever', history: '', examination: '', patient: { ...patient, ageYears: 5, allergies: 'Penicillin (rash)' } });
  assert.ok(r.cautions.includes('Allergy on file: Penicillin (rash)'));
  assert.ok(r.cautions.some((c) => /weight-based/.test(c)));
});
