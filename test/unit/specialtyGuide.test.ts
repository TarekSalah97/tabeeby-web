import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideMatches, GUIDE } from '../../src/domain/specialtyGuide.js';
import { normalizeText } from '../../src/services/symptomChecker.js';

const top = (text: string, o: { ageGroup?: 'child' | 'adult' | 'senior'; sex?: 'female' | 'male' } = {}) =>
  guideMatches(normalizeText(text), { ageGroup: o.ageGroup ?? null, sex: o.sex ?? null, normalise: normalizeText })[0];

test('common presentations go to the usual specialist (English and Egyptian Arabic)', () => {
  const cases: [string, string, string][] = [
    ['My knee hurts when I climb stairs', 'orthopedics', 'knee'],
    ['ركبتي بتوجعني لما بطلع السلم', 'orthopedics', 'knee'],
    ['I have pimples on my face', 'dermatology', 'acne'],
    ['شعري بيقع جامد', 'dermatology', 'hair'],
    ['burning urine and going a lot', 'urology', ''],
    ['حصوة في الكلى ومغص كلوي', 'urology', 'stones'],
    ['I get migraines with nausea', 'neurology', 'headache'],
    ['عندي صداع نصفي', 'neurology', 'headache'],
    ['toothache when I drink cold water', 'dentistry', 'endodontics'],
    ['heartburn after eating', 'internal-medicine', 'gastroenterology'],
    ['my blood sugar is high', 'internal-medicine', 'diabetes'],
    ['blocked nose and snoring', 'ent', 'sinus'],
    ['I feel anxious and cannot sleep', 'psychiatry', 'adult-psychiatry'],
    ['blurred vision, I think I need glasses', 'ophthalmology', 'lasik'],
  ];
  for (const [text, spec, sub] of cases) {
    const m = top(text);
    assert.ok(m, text);
    assert.equal(m.specialty, spec, text);
    if (sub) assert.equal(m.subspecialty, sub, text);
  }
});

test('children go to the children’s version of the specialty', () => {
  assert.equal(top('fever and cough', { ageGroup: 'child' })!.specialty, 'pediatrics');
  assert.equal(top('toothache', { ageGroup: 'child' })!.subspecialty, 'pediatric-dentistry');
  assert.equal(top('ear pain', { ageGroup: 'child' })!.subspecialty, 'pediatric-ent');
});

test('sex-specific rules respect the chosen sex', () => {
  assert.equal(top('trying to conceive for two years', { sex: 'female' })!.subspecialty, 'fertility');
  assert.notEqual(top('missed period', { sex: 'male' })?.specialty, 'obgyn');
});

test('short English words only match whole words ("ear" is not in "year")', () => {
  assert.equal(top('pain for a year in my hip')!.specialty, 'orthopedics');
  assert.equal(guideMatches(normalizeText('I need advice this year'), { ageGroup: null, sex: null, normalise: normalizeText }).length, 0);
});

test('at most three suggestions, one per specialty; every rule has both languages', () => {
  const m = guideMatches(normalizeText('knee pain, acne, toothache and headache'), { ageGroup: null, sex: null, normalise: normalizeText });
  assert.equal(m.length, 3);
  assert.equal(new Set(m.map((x) => x.specialty)).size, 3);
  for (const r of GUIDE) assert.ok(r.reason[0] && r.reason[1]);
});
