import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranchPhones, formatEgyptPhone, format12h } from '../../src/domain/branchPhones.js';

test('several phone numbers separated by dashes (or commas, slashes, new lines)', () => {
  assert.deepEqual(parseBranchPhones(''), []);
  assert.deepEqual(parseBranchPhones('01012345678 - 034567890'), ['+201012345678', '+2034567890']);
  assert.deepEqual(parseBranchPhones('01012345678-01112345678–0225551234'), ['+201012345678', '+201112345678', '+20225551234']);
  assert.deepEqual(parseBranchPhones('٠١٠١٢٣٤٥٦٧٨ / 034567890, 034567890'), ['+201012345678', '+2034567890']);
  assert.deepEqual(parseBranchPhones('(03) 4567890\n+20 10 1234 5678'), ['+2034567890', '+201012345678']);
  assert.equal(parseBranchPhones('01012345678 - 123'), 'invalid');
  assert.equal(parseBranchPhones('call us'), 'invalid');
  assert.equal(parseBranchPhones('034567891-034567892-034567893-034567894-034567895-034567896'), 'invalid');
});

test('phones and times read naturally', () => {
  assert.equal(formatEgyptPhone('+201012345678'), '010 1234 5678');
  assert.equal(formatEgyptPhone('+2034567890'), '03 4567890');
  assert.equal(formatEgyptPhone('+20403334444'), '040 3334444');
  assert.equal(format12h('09:00', 'en'), '9:00 AM');
  assert.equal(format12h('01:00', 'en'), '1:00 AM');
  assert.equal(format12h('13:30', 'en'), '1:30 PM');
  assert.match(format12h('21:00', 'ar'), /٩:٠٠\s?م/);
});
