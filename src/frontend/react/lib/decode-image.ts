import type { RepositoryImageSide } from '../../../common/ipc/contracts';

const svgElements = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
]);
const svgAttributes = new Set([
  'xmlns',
  'id',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'version',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'transform',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
]);

/** SVG never becomes a document or DOM subtree. Only an allowlisted image enters Chromium's secure image mode. */
export async function decodeRepositoryImage(
  side: Extract<RepositoryImageSide, { state: 'ready' }>,
): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(side.base64), (character) => character.charCodeAt(0));
  if (side.mime !== 'image/svg+xml')
    return createImageBitmap(new Blob([bytes], { type: side.mime }), { imageOrientation: 'none' });
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.includes('<!') && /<!(?:DOCTYPE|ENTITY)/iu.test(source))
    throw new Error('SVG declarations are not supported.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
  if (root.localName !== 'svg' || nodes.length > 10000 || doc.querySelector('parsererror'))
    throw new Error('Invalid SVG.');
  for (const node of nodes) {
    if (node.namespaceURI !== 'http://www.w3.org/2000/svg' || !svgElements.has(node.localName))
      throw new Error('Unsupported SVG element.');
    for (const attribute of Array.from(node.attributes)) {
      if (
        !svgAttributes.has(attribute.name) ||
        (attribute.name === 'xmlns' && attribute.value !== 'http://www.w3.org/2000/svg')
      )
        throw new Error('Unsupported SVG attribute.');
      if (/url\s*\(/iu.test(attribute.value) && !/^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/u.test(attribute.value))
        throw new Error('External SVG resources are not supported.');
    }
  }
  root.setAttribute('width', String(side.width));
  root.setAttribute('height', String(side.height));
  const sanitized = new XMLSerializer().serializeToString(root);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SVG decode timed out.')), 5000);
      }),
    ]);
    return await createImageBitmap(image);
  } finally {
    clearTimeout(timer);
    image.src = '';
  }
}
