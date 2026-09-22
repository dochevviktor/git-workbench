/** Compare decoded, unpremultiplied RGBA; missing coordinates differ even if transparent. */
export function compareImagePixels(
  before: { data: Uint8ClampedArray; width: number; height: number },
  after: { data: Uint8ClampedArray; width: number; height: number },
): { data: Uint8ClampedArray; width: number; height: number; changed: number } {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  if (width * height > 4_194_304) throw new Error('Combined image exceeds 4 megapixels.');
  const data = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const oldPresent = x < before.width && y < before.height;
      const newPresent = x < after.width && y < after.height;
      const oldIndex = (y * before.width + x) * 4;
      const newIndex = (y * after.width + x) * 4;
      const differs =
        oldPresent !== newPresent ||
        (oldPresent &&
          newPresent &&
          (before.data[oldIndex] !== after.data[newIndex] ||
            before.data[oldIndex + 1] !== after.data[newIndex + 1] ||
            before.data[oldIndex + 2] !== after.data[newIndex + 2] ||
            before.data[oldIndex + 3] !== after.data[newIndex + 3]));
      const index = (y * width + x) * 4;
      if (differs) {
        changed++;
        data.set([235, 30, 135, 255], index);
      } else if (newPresent) {
        const gray = Math.round(
          (after.data[newIndex]! + after.data[newIndex + 1]! + after.data[newIndex + 2]!) / 3,
        );
        data.set([gray, gray, gray, Math.round(after.data[newIndex + 3]! * 0.35)], index);
      }
    }
  return { data, width, height, changed };
}
