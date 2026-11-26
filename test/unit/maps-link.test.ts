import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapsUrl } from '../../src/domain/mapsLink.js';

test('maps links: real Google Maps links are kept as https', () => {
  assert.equal(normalizeMapsUrl(''), null);
  assert.equal(normalizeMapsUrl('https://maps.app.goo.gl/AbC123xyz'), 'https://maps.app.goo.gl/AbC123xyz');
  assert.equal(normalizeMapsUrl('maps.app.goo.gl/AbC123xyz'), 'https://maps.app.goo.gl/AbC123xyz');
  assert.equal(normalizeMapsUrl('http://www.google.com/maps/place/Nile+Pharmacy/@31.2,29.9,17z'), 'https://www.google.com/maps/place/Nile+Pharmacy/@31.2,29.9,17z');
  assert.equal(normalizeMapsUrl('https://www.google.com.eg/maps?q=31.2,29.9'), 'https://www.google.com.eg/maps?q=31.2,29.9');
  assert.equal(normalizeMapsUrl('https://maps.google.com/?q=31.2,29.9'), 'https://maps.google.com/?q=31.2,29.9');
  assert.equal(normalizeMapsUrl('https://goo.gl/maps/xyz'), 'https://goo.gl/maps/xyz');
});

test('maps links: anything else is refused', () => {
  for (const bad of [
    'javascript:alert(1)', 'https://evil.com/maps', 'https://google.com.evil.com/maps', 'https://www.google.com/search?q=x',
    'https://maps.app.goo.gl/', 'https://user:pw@maps.app.goo.gl/x', 'https://maps.app.goo.gl:8443/x', 'ftp://maps.google.com/x',
    'https://goo.gl/xyz', 'not a link at all', 'https://' + 'a'.repeat(600),
  ]) assert.equal(normalizeMapsUrl(bad), 'invalid', bad);
});
