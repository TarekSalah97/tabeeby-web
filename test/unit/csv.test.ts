import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../src/services/payments.js';

test('CSV quotes every cell, escapes quotes, and neutralises spreadsheet formulas', () => {
  const out = toCsv([
    ['Name', 'Amount'],
    ['=HYPERLINK("http://evil","x")', 400],
    ['+1', '-2'],
    ['@cmd', 'سارة "س"'],
  ]);
  assert.ok(out.startsWith('﻿'), 'BOM for Excel');
  const lines = out.slice(1).trim().split('\r\n');
  assert.equal(lines[0], '"Name","Amount"');
  assert.equal(lines[1], `"'=HYPERLINK(""http://evil"",""x"")","400"`);
  assert.equal(lines[2], `"'+1","'-2"`);
  assert.equal(lines[3], `"'@cmd","سارة ""س"""`);
});
