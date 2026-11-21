import zlib from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A 1×1 PNG with a text chunk holding fake GPS data. */
export function pngWithGps(): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('GPS\u000031.2001N 29.9187E', 'latin1')),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A minimal JPEG structure with an EXIF (APP1) segment holding fake GPS data. */
export function jpegWithGps(): Buffer {
  const seg = (marker: number, body: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([h, body]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\u0000\u0001\u0001\u0000\u0000\u0001\u0000\u0001\u0000\u0000', 'latin1')),
    seg(0xe1, Buffer.from('Exif\u0000\u0000GPSLatitude=31.2001', 'latin1')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0xd9]),
  ]);
}
