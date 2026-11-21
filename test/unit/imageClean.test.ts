import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripImageMetadata } from '../../src/storage/imageClean.js';
import { jpegWithGps, pngWithGps } from '../fixtures/images.js';

test('JPEG: the EXIF/GPS segment is removed, the picture data is kept', () => {
  const src = jpegWithGps();
  const out = stripImageMetadata(src)!;
  assert.ok(out);
  assert.ok(src.includes('GPSLatitude'));
  assert.ok(!out.includes('GPSLatitude'));
  assert.ok(out.includes('JFIF'));
  assert.deepEqual([...out.subarray(-4)], [0x12, 0x34, 0xff, 0xd9]);
});

test('PNG: text chunks are removed, image chunks kept', () => {
  const out = stripImageMetadata(pngWithGps())!;
  assert.ok(out);
  assert.ok(!out.includes('31.2001N'));
  for (const c of ['IHDR', 'IDAT', 'IEND']) assert.ok(out.includes(c), c);
});

test('broken or other files are refused', () => {
  assert.equal(stripImageMetadata(Buffer.from('%PDF-1.4')), null);
  assert.equal(stripImageMetadata(jpegWithGps().subarray(0, 30)), null);
  assert.equal(stripImageMetadata(pngWithGps().subarray(0, 40)), null);
});
