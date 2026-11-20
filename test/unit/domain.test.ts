import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEgyptMobile, formatEgyptMobile, maskEgyptMobile } from '../../src/domain/phone.js';
import { experienceMonths, experienceYears, validatePosition } from '../../src/domain/experience.js';
import { computeSlots, rulesOverlap } from '../../src/domain/availability.js';
import { zonedToUtc, toZoned, addDays, isValidDate, weekdayOf } from '../../src/domain/time.js';
import { checkTransition, nextDoctorAction } from '../../src/domain/appointmentStatus.js';

test('phone: accepts every common way of writing an Egyptian mobile', () => {
  for (const input of ['01012345678', '1012345678', '+201012345678', '00201012345678', '201012345678', '010 1234 5678', '٠١٠١٢٣٤٥٦٧٨']) {
    assert.equal(normalizeEgyptMobile(input), '+201012345678', input);
  }
  assert.equal(normalizeEgyptMobile('01512345678'), '+201512345678');
});

test('phone: rejects landlines, wrong prefixes and wrong lengths', () => {
  for (const input of ['0312345678', '01312345678', '0101234567', '010123456789', 'abc', '', '+441012345678']) {
    assert.equal(normalizeEgyptMobile(input), null, input);
  }
});

test('phone: display formats', () => {
  assert.equal(formatEgyptMobile('+201012345678'), '010 1234 5678');
  assert.equal(maskEgyptMobile('+201012345678'), '010 •••• 5678');
});

const NOW = new Date('2026-11-20T12:00:00Z');

test('experience: overlapping periods count once (2021–2023 + 2022–2024 = 3 years)', () => {
  const positions = [
    { start: '2021-01', end: '2023-01' },
    { start: '2022-01', end: '2024-01' },
  ];
  assert.equal(experienceMonths(positions, NOW), 36);
  assert.equal(experienceYears(positions, NOW), 3);
});

test('experience: separate periods add up, gaps are not counted', () => {
  assert.equal(experienceMonths([{ start: '2015-01', end: '2016-01' }, { start: '2018-01', end: '2019-07' }], NOW), 12 + 18);
});

test('experience: current job runs until this month', () => {
  assert.equal(experienceMonths([{ start: '2024-11', end: null }], NOW), 24);
});

test('experience: nested and touching periods', () => {
  assert.equal(experienceMonths([{ start: '2010-01', end: '2020-01' }, { start: '2012-01', end: '2013-01' }], NOW), 120);
  assert.equal(experienceMonths([{ start: '2010-01', end: '2011-01' }, { start: '2011-01', end: '2012-01' }], NOW), 24);
});

test('experience: validation rules', () => {
  assert.equal(validatePosition({ start: '2027-01', end: null }, NOW), 'experience.startInFuture');
  assert.equal(validatePosition({ start: '2020-01', end: '2027-01' }, NOW), 'experience.endInFuture');
  assert.equal(validatePosition({ start: '2020-05', end: '2020-01' }, NOW), 'experience.endBeforeStart');
  assert.equal(validatePosition({ start: '2020-13', end: null }, NOW), 'experience.invalidMonth');
  assert.equal(validatePosition({ start: '2026-11', end: null }, NOW), null);
  // Invalid rows are ignored by the total rather than inflating it.
  assert.equal(experienceMonths([{ start: '2030-01', end: null }], NOW), 0);
});

test('time: Cairo offset follows daylight saving time', () => {
  // Winter: UTC+2. Summer (Egypt reinstated DST): UTC+3.
  assert.equal(zonedToUtc('2026-01-15', '17:00', 'Africa/Cairo').toISOString(), '2026-01-15T15:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-15', '17:00', 'Africa/Cairo').toISOString(), '2026-07-15T14:00:00.000Z');
  const back = toZoned(new Date('2026-07-15T14:00:00Z'), 'Africa/Cairo');
  assert.deepEqual(back, { date: '2026-07-15', time: '17:00', weekday: 3 });
});

test('time: date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-11-22'), 0);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-02-28'), true);
});

test('availability: slots from rules, minus busy time and lead time', () => {
  const rules = [{ clinicId: 'c1', weekday: 0, startTime: '17:00', endTime: '19:00', slotMinutes: 30 }];
  const now = new Date('2026-11-22T14:50:00Z'); // Sunday 16:50 Cairo
  const busy = [{ start: new Date('2026-11-22T15:30:00Z'), end: new Date('2026-11-22T16:00:00Z') }]; // 17:30–18:00 local
  const slots = computeSlots({ rules, busy, fromDate: '2026-11-22', days: 1, tz: 'Africa/Cairo', now, minLeadMinutes: 30 });
  // 17:00 is only 10 minutes away (< 30 lead) → excluded. 17:30 is busy.
  assert.deepEqual(slots.map((s) => s.time), ['18:00', '18:30']);
  assert.equal(slots[0]!.endsAt.getTime() - slots[0]!.startsAt.getTime(), 30 * 60000);
});

test('availability: a slot that would run past closing time is not offered', () => {
  const rules = [{ clinicId: 'c1', weekday: 0, startTime: '17:00', endTime: '18:40', slotMinutes: 30 }];
  const slots = computeSlots({ rules, busy: [], fromDate: '2026-11-22', days: 1, tz: 'Africa/Cairo', now: new Date('2026-11-01T00:00:00Z'), minLeadMinutes: 0 });
  assert.deepEqual(slots.map((s) => s.time), ['17:00', '17:30', '18:00']);
});

test('availability: blocks covering a whole day remove all slots that day', () => {
  const rules = [{ clinicId: 'c1', weekday: 1, startTime: '09:00', endTime: '12:00', slotMinutes: 60 }];
  const block = { start: zonedToUtc('2026-11-23', '00:00', 'Africa/Cairo'), end: zonedToUtc('2026-11-24', '00:00', 'Africa/Cairo') };
  const slots = computeSlots({ rules, busy: [block], fromDate: '2026-11-22', days: 14, tz: 'Africa/Cairo', now: new Date('2026-11-20T00:00:00Z'), minLeadMinutes: 0 });
  assert.ok(slots.every((s) => s.date !== '2026-11-23'));
  assert.equal(slots.filter((s) => s.date === '2026-11-30').length, 3);
});

test('availability: overlapping rules on the same weekday are detected', () => {
  assert.equal(rulesOverlap({ weekday: 1, startTime: '17:00', endTime: '21:00' }, { weekday: 1, startTime: '20:00', endTime: '22:00' }), true);
  assert.equal(rulesOverlap({ weekday: 1, startTime: '17:00', endTime: '20:00' }, { weekday: 1, startTime: '20:00', endTime: '22:00' }), false);
  assert.equal(rulesOverlap({ weekday: 1, startTime: '17:00', endTime: '21:00' }, { weekday: 2, startTime: '17:00', endTime: '21:00' }), false);
});

const start = new Date('2026-11-22T15:00:00Z');
const base = { startsAt: start, cancelCutoffHours: 2 };

test('status: patients can cancel only before the cut-off', () => {
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'cancelled', actor: 'patient', now: new Date('2026-11-22T12:00:00Z') }), null);
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'cancelled', actor: 'patient', now: new Date('2026-11-22T13:30:00Z') }), 'appt.tooLateToCancel');
  assert.equal(checkTransition({ ...base, from: 'arrived', to: 'cancelled', actor: 'patient', now: new Date('2026-11-22T12:00:00Z') }), 'appt.cannotCancel');
});

test('status: patients cannot run the clinic', () => {
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'arrived', actor: 'patient', now: start }), 'appt.notAllowed');
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'no_show', actor: 'patient', now: new Date('2026-11-22T16:00:00Z') }), 'appt.notAllowed');
});

test('status: doctor flow and timing guards', () => {
  const now = new Date('2026-11-22T14:30:00Z');
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'arrived', actor: 'doctor', now }), null);
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'arrived', actor: 'doctor', now: new Date('2026-11-21T10:00:00Z') }), 'appt.tooEarly');
  assert.equal(checkTransition({ ...base, from: 'arrived', to: 'in_consultation', actor: 'doctor', now }), null);
  assert.equal(checkTransition({ ...base, from: 'in_consultation', to: 'completed', actor: 'doctor', now }), null);
  assert.equal(checkTransition({ ...base, from: 'confirmed', to: 'no_show', actor: 'doctor', now }), 'appt.notStartedYet');
  assert.equal(checkTransition({ ...base, from: 'completed', to: 'arrived', actor: 'doctor', now }), 'appt.notAllowed');
  assert.equal(checkTransition({ ...base, from: 'cancelled', to: 'cancelled', actor: 'doctor', now }), 'appt.cannotCancel');
  assert.equal(nextDoctorAction('confirmed'), 'arrived');
  assert.equal(nextDoctorAction('completed'), null);
});
