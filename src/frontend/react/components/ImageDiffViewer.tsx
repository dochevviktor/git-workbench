import { useEffect, useRef, useState } from 'react';
import type { RepositoryDiff, RepositoryImageSide } from '../../../common/ipc/contracts';
import { compareImagePixels } from '../lib/image-comparison';
import './image-diff.css';

type Mode = 'Side-by-Side' | 'Swipe' | 'Onion Skin' | 'Pixel';
type Decoded = { before: ImageBitmap | null; after: ImageBitmap | null; failures: string[] };
const modes: Mode[] = ['Side-by-Side', 'Swipe', 'Onion Skin', 'Pixel'];

function description(side: RepositoryImageSide | undefined): string {
  switch (side?.state) {
    case 'ready':
      return `${side.width} × ${side.height} px`;
    case 'missing':
      return 'Not present';
    case 'too-large':
      return 'Preview exceeds 4 MiB, 4 megapixels, or 8192 px per edge.';
    case 'unavailable':
      return 'Preview unavailable. Refresh to retry.';
    default:
      return 'No preview. Supported: static PNG and JPEG.';
  }
}

function Raster({ bitmap, label }: { bitmap: ImageBitmap; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} className="image-raster" role="img" aria-label={label} />;
}

function Combined({
  decoded,
  mode,
  amount,
  onAmount,
}: {
  decoded: Decoded;
  mode: Mode;
  amount: number;
  onAmount: (amount: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [changed, setChanged] = useState<number>();
  const width = Math.max(decoded.before?.width ?? 0, decoded.after?.width ?? 0);
  const height = Math.max(decoded.before?.height ?? 0, decoded.after?.height ?? 0);
  const tooLarge = width * height > 4_194_304;
  useEffect(() => {
    if (tooLarge || !canvas.current) return;
    const target = canvas.current;
    target.width = width;
    target.height = height;
    const context = target.getContext('2d');
    if (!context) return;
    if (mode === 'Pixel') {
      const pixels = (bitmap: ImageBitmap | null) => {
        if (!bitmap) return { width: 0, height: 0, data: new Uint8ClampedArray() };
        const buffer = document.createElement('canvas');
        buffer.width = bitmap.width;
        buffer.height = bitmap.height;
        const ctx = buffer.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, buffer.width, buffer.height);
        buffer.width = 0;
        buffer.height = 0;
        return data;
      };
      const diff = compareImagePixels(pixels(decoded.before), pixels(decoded.after));
      context.putImageData(new ImageData(new Uint8ClampedArray(diff.data), width, height), 0, 0);
      setChanged(diff.changed);
    } else if (mode === 'Swipe') {
      context.save();
      context.beginPath();
      context.rect(0, 0, (width * amount) / 100, height);
      context.clip();
      if (decoded.before) context.drawImage(decoded.before, 0, 0);
      context.restore();
      context.save();
      context.beginPath();
      context.rect((width * amount) / 100, 0, width, height);
      context.clip();
      if (decoded.after) context.drawImage(decoded.after, 0, 0);
      context.restore();
    } else {
      context.globalAlpha = 1 - amount / 100;
      if (decoded.before) context.drawImage(decoded.before, 0, 0);
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = amount / 100;
      if (decoded.after) context.drawImage(decoded.after, 0, 0);
    }
    return () => {
      target.width = 0;
      target.height = 0;
    };
  }, [decoded, mode, amount, width, height, tooLarge]);
  if (tooLarge) return <p role="status">Combined canvas exceeds 4 megapixels. Use Side-by-Side.</p>;
  const drag = (clientX: number) => {
    const bounds = frame.current?.getBoundingClientRect();
    if (bounds?.width) onAmount(Math.max(0, Math.min(100, (100 * (clientX - bounds.left)) / bounds.width)));
  };
  return (
    <div className="image-combined">
      <div className="image-side-labels">
        <span>old</span>
        <span>new</span>
      </div>
      <div className="image-composite-frame" ref={frame} style={{ width }}>
        <canvas ref={canvas} className="image-raster" role="img" aria-label={`${mode} image comparison`} />
        {mode === 'Swipe' && (
          <button
            type="button"
            className="image-swipe-divider"
            aria-label="Drag swipe divider"
            style={{ left: `${amount}%` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag(event.clientX);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event.clientX);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                onAmount(
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 100
                      : Math.max(0, Math.min(100, amount + (event.key === 'ArrowRight' ? 1 : -1))),
                );
              }
            }}
          />
        )}
      </div>
      {mode !== 'Pixel' ? (
        <label className="image-blend-control">
          {mode === 'Swipe' ? 'Divider' : 'New image opacity'}
          <input
            type="range"
            min="0"
            max="100"
            value={amount}
            onChange={(event) => onAmount(Number(event.target.value))}
          />
          <output>{Math.round(amount)}%</output>
        </label>
      ) : (
        <p className="image-pixel-summary" role="status">
          {changed?.toLocaleString() ?? '…'} changed pixels · magenta marks changes, including alpha and
          dimensions.
        </p>
      )}
    </div>
  );
}

/** Receives bytes only, never repository URLs. Chromium decodes inside the sandboxed renderer. */
export function ImageDiffViewer({ value }: { value: RepositoryDiff }) {
  const [mode, setMode] = useState<Mode>('Side-by-Side');
  const [amount, setAmount] = useState(50);
  const [decoded, setDecoded] = useState<Decoded>();
  const images = value.images;
  useEffect(() => {
    let disposed = false;
    const bitmaps: ImageBitmap[] = [];
    const failures: string[] = [];
    setDecoded(undefined);
    const decode = async (side: RepositoryImageSide | undefined, label: string) => {
      if (side?.state !== 'ready') return null;
      try {
        const bytes = Uint8Array.from(atob(side.base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: side.mime }), {
          imageOrientation: 'none',
        });
        if (disposed || bitmap.width !== side.width || bitmap.height !== side.height) {
          bitmap.close();
          if (!disposed) failures.push(`${label}: invalid image dimensions.`);
          return null;
        }
        bitmaps.push(bitmap);
        return bitmap;
      } catch {
        failures.push(`${label}: image could not be decoded.`);
        return null;
      }
    };
    void Promise.all([decode(images?.before, 'Old'), decode(images?.after, 'New')]).then(
      ([before, after]) => {
        if (!disposed) setDecoded({ before, after, failures });
      },
    );
    return () => {
      disposed = true;
      bitmaps.forEach((bitmap) => bitmap.close());
    };
  }, [images]);
  const canCompare =
    !!decoded &&
    decoded.failures.length === 0 &&
    (decoded.before !== null || decoded.after !== null) &&
    [images?.before, images?.after].every((side) => side?.state === 'ready' || side?.state === 'missing');
  const selected = canCompare ? mode : 'Side-by-Side';
  return (
    <div className="image-diff-viewer" data-testid="image-diff-viewer">
      <div className="image-diff-content">
        {selected === 'Side-by-Side' ? (
          <div className="image-diff-pair">
            {(['before', 'after'] as const).map((side) => {
              const path =
                side === 'before' ? (value.target.previousPath ?? value.target.path) : value.target.path;
              const size = value.binaryMetadata?.[side === 'before' ? 'beforeBytes' : 'afterBytes'];
              const bitmap = decoded?.[side];
              return (
                <section className={`image-diff-side ${side}`} key={side}>
                  <strong>{side === 'before' ? 'old' : 'new'}</strong>
                  {bitmap ? (
                    <Raster bitmap={bitmap} label={`${side === 'before' ? 'Old' : 'New'} image`} />
                  ) : (
                    <div className="image-file-card">
                      <span>{path.match(/\.[^./]+$/u)?.[0] ?? 'File'}</span>
                    </div>
                  )}
                  <span>{description(images?.[side])}</span>
                  <span>
                    {size == null
                      ? 'Size unavailable'
                      : `${size.toLocaleString()} bytes (${size.toLocaleString()} B)`}
                  </span>
                  <span className="image-path" title={path}>
                    {path}
                  </span>
                </section>
              );
            })}
          </div>
        ) : (
          decoded && <Combined decoded={decoded} mode={selected} amount={amount} onAmount={setAmount} />
        )}
        {!decoded && <p role="status">Decoding images…</p>}
        {decoded?.failures.map((failure) => (
          <p role="alert" key={failure}>
            {failure}
          </p>
        ))}
      </div>
      <div className="image-diff-modes" role="group" aria-label="Image comparison mode">
        {modes.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={selected === item}
            disabled={item !== 'Side-by-Side' && !canCompare}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
