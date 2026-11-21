/**
 * Removes hidden metadata from JPEG and PNG photos before they are stored and shown publicly.
 * Phone photos often carry the exact GPS location and the device in EXIF; that must not end up
 * on a public profile. Only the image data itself is kept. Returns null if the file is not a
 * well-formed JPEG or PNG.
 */
export function stripImageMetadata(data: Buffer): Buffer | null {
  if (data[0] === 0xff && data[1] === 0xd8) return stripJpeg(data);
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return stripPng(data);
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stripJpeg(data: Buffer): Buffer | null {
  const out: Buffer[] = [data.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1]!;
    if (marker === 0xd9) break; // end of image
    if (marker === 0xda) {
      // Start of scan: the rest is image data up to the end.
      out.push(data.subarray(i));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(data.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = data.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > data.length) return null;
    // Drop APP1–APP15 (EXIF, XMP, Photoshop/IPTC…) and comments; keep APP0 (JFIF) and everything else.
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) out.push(data.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/** Keep only the chunks needed to draw the picture. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs']);

function stripPng(data: Buffer): Buffer | null {
  const out: Buffer[] = [PNG_SIGNATURE];
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= data.length) {
    const len = data.readUInt32BE(i);
    const type = data.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > data.length) return null;
    if (PNG_KEEP.has(type)) out.push(data.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? Buffer.concat(out) : null;
}
