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
