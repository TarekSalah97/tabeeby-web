import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { cleanTimes, dueBetween, dosesOn, durationDays, isOngoing, suggestedTimes } from '../../src/domain/medReminders.js';
import { encryptPayload, isAllowedEndpoint, validSubscription, vapidAuthorization } from '../../src/services/webPush.js';
import { reminderCalendar, type MedicineReminder } from '../../src/services/medReminders.js';

const TZ = 'Africa/Cairo';

test('suggested times follow the doctor\'s frequency', () => {
  assert.deepEqual(suggestedTimes('three_daily', 'after_meals'), ['08:00', '14:00', '20:00']);
  assert.deepEqual(suggestedTimes('once_daily', 'bedtime'), ['22:00']);
  assert.deepEqual(suggestedTimes('once_daily', 'empty_stomach'), ['08:00']);
  assert.deepEqual(suggestedTimes('every_8h', null), ['06:00', '14:00', '22:00']);
  assert.equal(suggestedTimes('as_needed', null), null);
  assert.equal(suggestedTimes('single_dose', null), null);
});

test('course length is read from the doctor\'s text in English or Arabic', () => {
  assert.equal(durationDays('7 days'), 7);
  assert.equal(durationDays('٧ أيام'), 7);
  assert.equal(durationDays('10 يوم'), 10);
  assert.equal(durationDays('أسبوعين'), 14);
  assert.equal(durationDays('2 weeks'), 14);
  assert.equal(durationDays('شهر'), 30);
  assert.equal(durationDays('3 months'), 90);
  assert.equal(durationDays('5'), 5);
  assert.equal(durationDays('until better'), null);
  assert.equal(durationDays('0 days'), null);
  assert.equal(durationDays('900 days'), null);
  assert.equal(durationDays(null), null);
  assert.ok(isOngoing('Long term'));
  assert.ok(isOngoing('مستمر'));
  assert.ok(isOngoing('مدى الحياة'));
  assert.ok(!isOngoing('7 days'));
});

test('times are cleaned: valid, unique, sorted, at most 8', () => {
  assert.deepEqual(cleanTimes(['20:00', '08:00', '08:00', '25:00', '', 'x']), ['08:00', '20:00']);
  assert.equal(cleanTimes(['', 'nope']), null);
  assert.equal(cleanTimes(Array.from({ length: 9 }, (_, i) => `0${i}:00`)), null);
});

test('due doses: only inside the window, only on course days, in Cairo time', () => {
  const s = { times: ['09:00', '21:00'], weekday: null, startDate: '2026-11-26', endDate: '2026-11-27' };
  // 09:00 Cairo on 26 Nov (UTC+2) is 07:00 UTC.
  assert.deepEqual(dueBetween(s, new Date('2026-11-26T06:50:00Z'), new Date('2026-11-26T07:00:00Z'), TZ).map((d) => d.toISOString()), ['2026-11-26T07:00:00.000Z']);
  assert.equal(dueBetween(s, new Date('2026-11-26T07:00:00Z'), new Date('2026-11-26T07:10:00Z'), TZ).length, 0, 'window start is exclusive');
  assert.equal(dueBetween(s, new Date('2026-11-25T06:50:00Z'), new Date('2026-11-25T07:00:00Z'), TZ).length, 0, 'before the course');
  assert.equal(dueBetween(s, new Date('2026-11-28T06:50:00Z'), new Date('2026-11-28T07:00:00Z'), TZ).length, 0, 'after the course');
  assert.equal(dosesOn(s, '2026-11-27', TZ).length, 2);
  // Weekly on Friday (5).
  const w = { times: ['09:00'], weekday: 5, startDate: '2026-11-26', endDate: null };
  assert.equal(dosesOn(w, '2026-11-26', TZ).length, 0);
  assert.equal(dosesOn(w, '2026-11-27', TZ).length, 1);
  // Summer time in Egypt (UTC+3): 09:00 is 06:00 UTC.
  assert.equal(dosesOn({ ...s, startDate: '2026-07-01', endDate: null }, '2026-07-01', TZ)[0]!.toISOString(), '2026-07-01T06:00:00.000Z');
});

test('Web Push encryption matches the worked example in RFC 8291', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.setPrivateKey(Buffer.from('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', 'base64url'));
  const as = crypto.createECDH('prime256v1');
  as.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const body = encryptPayload(
    { p256dh: ua.getPublicKey().toString('base64url'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    Buffer.from('When I grow up, I want to be a watermelon'),
    Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
    as,
  );
  assert.equal(ua.getPublicKey().toString('base64url'), 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
  assert.equal(
    body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('VAPID token is a valid ES256 signature for the push service origin', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: raw, privateKey }, 'https://tabeeby.example', new Date('2026-11-26T00:00:00Z'));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  assert.ok(m);
  assert.equal(m[4], raw);
  const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://tabeeby.example');
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3]!, 'base64url')));
});

test('only the browsers\' own push services are accepted (no SSRF)', () => {
  assert.ok(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isAllowedEndpoint('https://web.push.apple.com/QGx'));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com.evil.com/x'));
  assert.ok(!isAllowedEndpoint('https://127.0.0.1/x'));
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com:8443/x'));
  assert.ok(!isAllowedEndpoint('https://user:pw@fcm.googleapis.com/x'));
  assert.ok(!isAllowedEndpoint('not a url'));
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  assert.ok(validSubscription(good));
  assert.ok(!validSubscription({ ...good, auth: 'short' }));
  assert.ok(!validSubscription({ ...good, p256dh: Buffer.alloc(65, 4).toString('base64url') }), 'not a point on the curve');
});

test('calendar file: one repeating event per time, with an alarm, folded lines', () => {
  const r: MedicineReminder = {
    id: '11111111-1111-1111-1111-111111111111', prescriptionId: 'x', position: 1, times: ['08:00', '20:00'], weekday: null,
    startDate: '2026-11-26', endDate: '2026-12-02', isActive: true, doctorName: 'Dr. Ahmed Hassan',
    item: { position: 1, medicine: 'Augmentin 1g, tablets; "film coated"', form: 'tablet', dose: '1 tablet', frequency: 'twice_daily', timing: 'after_meals', duration: '7 days', instructions: 'After food' },
  };
  const ics = reminderCalendar([r], (k, v) => `${k}${v ? JSON.stringify(v) : ''}`, new Date('2026-11-26T10:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /DTSTART:20261126T080000\r\n/);
  assert.match(ics, /RRULE:FREQ=DAILY;UNTIL=20261202T235900\r\n/);
  assert.match(ics, /SUMMARY:Augmentin 1g\\, tablets\\; "film coated" — 1 tablet/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
});
