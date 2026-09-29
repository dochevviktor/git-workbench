import { crc32, deflateSync } from 'node:zlib';

export function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])));
  return Buffer.concat([header, data, checksum]);
}

/** Independently generated, lossless RGBA fixtures. No reference artwork is used. */
export function pngFixture(width = 160, height = 120, changed = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const block = x > 30 && x < 70 && y > 30 && y < 70;
      const color = block
        ? changed
          ? [225, 90, 70, 128]
          : [195, 25, 90, 255]
        : x > (changed ? width * 0.6 : width * 0.5)
          ? [240, 175, 35, 255]
          : [35, 95, 165, 255];
      rows.set(color, y * (width * 4 + 1) + 1 + x * 4);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function bmpFixture(width = 32, height = 24): Buffer {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write('BM');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) bytes.set([165, 95, 35], 54 + stride * y + x * 3);
  return bytes;
}

export function tgaFixture(rle = false): Buffer {
  const header = Buffer.alloc(18);
  header[2] = rle ? 10 : 2;
  header.writeUInt16LE(4, 12);
  header.writeUInt16LE(2, 14);
  header[16] = 32;
  header[17] = 0x28;
  return Buffer.concat([
    header,
    rle
      ? Buffer.from([0x87, 165, 95, 35, 128])
      : Buffer.from(Array.from({ length: 8 }, () => [165, 95, 35, 128]).flat()),
  ]);
}

export function gifFixture(): Buffer {
  // A separately authored 1×1 red GIF with a two-entry palette and one LZW literal.
  return Buffer.from([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2,
    0x44, 1, 0, 0x3b,
  ]);
}

export function svgFixture(color = '#235fa5'): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="${color}"/><circle cx="60" cy="60" r="20" fill="#f0af23"/></svg>`,
  );
}
