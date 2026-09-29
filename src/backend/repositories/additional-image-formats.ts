import { crc32, deflateSync } from 'node:zlib';
import type { RepositoryImageSide } from '../../common/ipc/contracts';

const withinBounds = (width: number, height: number) =>
  width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 4_194_304;
function ready(
  bytes: Buffer,
  mime: Extract<RepositoryImageSide, { state: 'ready' }>['mime'],
  width: number,
  height: number,
): RepositoryImageSide {
  return withinBounds(width, height)
    ? { state: 'ready', mime, width, height, base64: bytes.toString('base64') }
    : { state: 'too-large' };
}

/** Codec envelopes are checked before Chromium sees bytes. Unknown variants stay metadata. */
export function additionalImage(bytes: Buffer, path: string): RepositoryImageSide {
  if (/^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))) {
    if (bytes.length < 14) return { state: 'unavailable' };
    const width = bytes.readUInt16LE(6),
      height = bytes.readUInt16LE(8);
    if (!withinBounds(width, height)) return { state: 'too-large' };
    let offset = 13 + (bytes[10]! & 128 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0);
    const parts = [bytes.subarray(0, offset)];
    const subblocks = () => {
      while (offset < bytes.length) {
        const size = bytes[offset++]!;
        if (size === 0) return true;
        offset += size;
      }
      return false;
    };
    while (offset < bytes.length) {
      const start = offset;
      const type = bytes[offset++];
      if (type === 0x21) {
        const extension = bytes[offset++];
        if (!subblocks()) return { state: 'unavailable' };
        // Preserve transparency/disposal, remove application, comment and plain-text extensions.
        if (extension === 0xf9) {
          if (offset - start !== 8 || bytes[start + 2] !== 4) return { state: 'unavailable' };
          parts.push(bytes.subarray(start, offset));
        }
      } else if (type === 0x2c) {
        if (offset + 9 > bytes.length) return { state: 'unavailable' };
        const x = bytes.readUInt16LE(offset),
          y = bytes.readUInt16LE(offset + 2);
        const w = bytes.readUInt16LE(offset + 4),
          h = bytes.readUInt16LE(offset + 6);
        if (!w || !h || x + w > width || y + h > height) return { state: 'unavailable' };
        const packed = bytes[offset + 8]!;
        offset += 9;
        if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
        const codeSize = bytes[offset++];
        if (codeSize === undefined || codeSize < 2 || codeSize > 8 || !subblocks())
          return { state: 'unavailable' };
        // Image comparison has a stable first-frame policy; no timers/animated decoding.
        parts.push(bytes.subarray(start, offset), Buffer.from([0x3b]));
        return ready(Buffer.concat(parts), 'image/gif', width, height);
      } else return { state: 'unavailable' };
    }
    return { state: 'unavailable' };
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) return { state: 'unavailable' };
    const chunks: Buffer[] = [];
    let width = 0,
      height = 0,
      frames = 0;
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) return { state: 'unavailable' };
      const type = bytes.toString('ascii', offset, offset + 4),
        size = bytes.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) return { state: 'unavailable' };
      const data = offset + 8;
      if (type === 'ANIM' || type === 'ANMF') return { state: 'unsupported' };
      if (type === 'VP8X') {
        if (size !== 10 || offset !== 12 || bytes[data]! & 2) return { state: 'unsupported' };
        width = bytes.readUIntLE(data + 4, 3) + 1;
        height = bytes.readUIntLE(data + 7, 3) + 1;
        const header = Buffer.from(bytes.subarray(offset, end));
        header[8] = header[8]! & 16;
        chunks.push(header);
      } else if (type === 'VP8 ' || type === 'VP8L') {
        if (++frames !== 1) return { state: 'unavailable' };
        let w, h;
        if (type === 'VP8 ') {
          if (size < 10 || !bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 1, 0x2a])))
            return { state: 'unavailable' };
          w = bytes.readUInt16LE(data + 6) & 0x3fff;
          h = bytes.readUInt16LE(data + 8) & 0x3fff;
        } else {
          if (size < 5 || bytes[data] !== 0x2f) return { state: 'unavailable' };
          const bits = bytes.readUInt32LE(data + 1);
          w = (bits & 0x3fff) + 1;
          h = ((bits >>> 14) & 0x3fff) + 1;
        }
        if (width && (width !== w || height !== h)) return { state: 'unavailable' };
        width = w;
        height = h;
        chunks.push(bytes.subarray(offset, end));
      } else if (type === 'ALPH') chunks.push(bytes.subarray(offset, end));
      offset = end;
    }
    if (frames !== 1) return { state: 'unavailable' };
    const header = Buffer.from(bytes.subarray(0, 12));
    header.writeUInt32LE(4 + chunks.reduce((sum, part) => sum + part.length, 0), 4);
    return ready(Buffer.concat([header, ...chunks]), 'image/webp', width, height);
  }
  if (bytes.toString('ascii', 0, 2) === 'BM') {
    if (bytes.length < 54) return { state: 'unavailable' };
    const headerSize = bytes.readUInt32LE(14),
      width = bytes.readInt32LE(18),
      height = Math.abs(bytes.readInt32LE(22));
    const depth = bytes.readUInt16LE(28),
      compression = bytes.readUInt32LE(30);
    if (
      ![40, 108, 124].includes(headerSize) ||
      bytes.readUInt16LE(26) !== 1 ||
      ![24, 32].includes(depth) ||
      compression !== 0
    )
      return { state: 'unsupported' };
    if (!withinBounds(width, height)) return { state: 'too-large' };
    const start = bytes.readUInt32LE(10),
      size = Math.ceil((width * depth) / 32) * 4 * height;
    if (start < 14 + headerSize || start + size > bytes.length) return { state: 'unavailable' };
    // Only the conventional DIB/pixels are retained; do not retain optional profile references.
    const header = Buffer.from(bytes.subarray(0, 54));
    header.writeUInt32LE(40, 14);
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(54 + size, 2);
    return ready(Buffer.concat([header, bytes.subarray(start, start + size)]), 'image/bmp', width, height);
  }
  if (/\.tga$/iu.test(path)) return tga(bytes);
  const svg = bytes.toString('utf8');
  if (/^(?:\s*<\?xml[^?]*\?>)?\s*<svg[\s>]/u.test(svg)) {
    // SVG is decoded only in secure image mode after the renderer's DOM allowlist check.
    if (bytes.length > 1024 * 1024 || (svg.match(/</gu)?.length ?? 0) > 20000) return { state: 'too-large' };
    if (
      /<!(?:DOCTYPE|ENTITY)|<\?(?!xml)|\bon\w+\s*=|<(?:script|foreignObject|image|use|style|animate|set|filter|pattern)\b/iu.test(
        svg,
      )
    )
      return { state: 'unsupported' };
    const root = svg.match(/<svg\b[^>]*>/u)?.[0] ?? '';
    const dimension = (name: string) =>
      Number(root.match(new RegExp(`\\s${name}=["']([0-9.]+)(?:px)?["']`, 'u'))?.[1] ?? 0);
    const viewBox = root
      .match(/\sviewBox=["']([^"']+)["']/u)?.[1]
      ?.trim()
      .split(/[ ,]+/u)
      .map(Number);
    const width = Math.ceil(dimension('width') || viewBox?.[2] || 0),
      height = Math.ceil(dimension('height') || viewBox?.[3] || 0);
    if (!width || !height) return { state: 'unsupported' };
    return ready(bytes, 'image/svg+xml', width, height);
  }
  return { state: 'unsupported' };
}

function pngChunk(name: string, bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(bytes.length);
  header.write(name, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), bytes])));
  return Buffer.concat([header, bytes, checksum]);
}

/** TGA true-color/grayscale, raw or RLE, normalized to inert PNG with both origin bits honored. */
function tga(bytes: Buffer): RepositoryImageSide {
  if (bytes.length < 18 || bytes[1] !== 0 || ![2, 3, 10, 11].includes(bytes[2]!))
    return { state: 'unsupported' };
  const width = bytes.readUInt16LE(12),
    height = bytes.readUInt16LE(14),
    depth = bytes[16]!,
    descriptor = bytes[17]!;
  if (!withinBounds(width, height)) return { state: 'too-large' };
  const gray = [3, 11].includes(bytes[2]!);
  const rle = bytes[2]! >= 10;
  if (!(gray ? [8, 16] : [24, 32]).includes(depth) || descriptor & 0xc0) return { state: 'unsupported' };
  const stride = width * 4 + 1,
    rows = Buffer.alloc(stride * height);
  let offset = 18 + bytes[0]!,
    pixel = 0;
  const emit = (color: Buffer) => {
    const x = descriptor & 16 ? width - 1 - (pixel % width) : pixel % width;
    const y = descriptor & 32 ? Math.floor(pixel / width) : height - 1 - Math.floor(pixel / width);
    const at = y * stride + 1 + x * 4;
    rows[at] = gray ? color[0]! : color[2]!;
    rows[at + 1] = gray ? color[0]! : color[1]!;
    rows[at + 2] = color[0]!;
    rows[at + 3] = descriptor & 15 && (gray ? depth === 16 : depth === 32) ? color[color.length - 1]! : 255;
    pixel++;
  };
  while (pixel < width * height) {
    if (offset >= bytes.length) return { state: 'unavailable' };
    const packet = rle ? bytes[offset++]! : 0;
    const count = rle ? (packet & 127) + 1 : 1;
    if (pixel + count > width * height) return { state: 'unavailable' };
    for (let i = 0; i < count; i++) {
      if (offset + depth / 8 > bytes.length) return { state: 'unavailable' };
      emit(bytes.subarray(offset, offset + depth / 8));
      if (!(packet & 128) || i === count - 1) offset += depth / 8;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const output = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return output.length > 4 * 1024 * 1024 ? { state: 'too-large' } : ready(output, 'image/png', width, height);
}
