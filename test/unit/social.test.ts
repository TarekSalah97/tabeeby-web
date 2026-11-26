import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocial } from '../../src/domain/social.js';

test('social links: usernames and links become clean https links to the real site', () => {
  assert.equal(normalizeSocial('instagram', '@dr.ahmed_hassan'), 'https://www.instagram.com/dr.ahmed_hassan/');
  assert.equal(normalizeSocial('instagram', 'https://instagram.com/dr.ahmed?igsh=abc'), 'https://www.instagram.com/dr.ahmed/');
  assert.equal(normalizeSocial('tiktok', '@drahmed'), 'https://www.tiktok.com/@drahmed');
  assert.equal(normalizeSocial('tiktok', 'https://www.tiktok.com/@drahmed?lang=ar'), 'https://www.tiktok.com/@drahmed');
  assert.equal(normalizeSocial('tiktok', 'https://vm.tiktok.com/ZMabc123/'), 'https://vm.tiktok.com/ZMabc123/');
  assert.equal(normalizeSocial('facebook', 'facebook.com/DrAhmedClinic'), 'https://www.facebook.com/DrAhmedClinic');
  assert.equal(normalizeSocial('facebook', 'https://m.facebook.com/DrAhmedClinic/?ref=x'), 'https://www.facebook.com/DrAhmedClinic');
  assert.equal(normalizeSocial('facebook', 'https://www.facebook.com/profile.php?id=100012345678'), 'https://www.facebook.com/profile.php?id=100012345678');
  assert.equal(normalizeSocial('facebook', 'DrAhmedClinic'), 'https://www.facebook.com/DrAhmedClinic');
  assert.equal(normalizeSocial('facebook', '   '), null);
});

test('social links: other sites, tricks and nonsense are refused', () => {
  for (const bad of [
    'https://evil.com/facebook.com', 'https://facebook.com.evil.com/x', 'javascript:alert(1)', 'https://user@facebook.com/x',
    'https://www.facebook.com/sharer.php?u=x', 'https://www.facebook.com/', 'https://www.facebook.com/profile.php?id=abc', 'http://fb.com:8080/x',
    'drahmed"><script>', 'a b c',
  ]) assert.equal(normalizeSocial('facebook', bad), 'invalid', bad);
  assert.equal(normalizeSocial('instagram', 'https://www.tiktok.com/@x'), 'invalid');
  assert.equal(normalizeSocial('tiktok', 'https://www.tiktok.com/drahmed'), 'invalid');
  assert.equal(normalizeSocial('instagram', '@' + 'a'.repeat(40)), 'invalid');
});
