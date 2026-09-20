import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const rectangleSchema = z.strictObject({
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(1).max(32_768),
  height: z.number().int().min(1).max(32_768),
});
const windowStateFileSchema = z.strictObject({
  version: z.literal(1),
  bounds: rectangleSchema,
  maximized: z.boolean(),
});
export type WindowBounds = z.infer<typeof rectangleSchema>;
export type SavedWindowState = Omit<z.infer<typeof windowStateFileSchema>, 'version'>;

/** Keeps the title bar and full normal bounds reachable after a monitor or scale change. */
export function restoreWindowBounds(
  saved: SavedWindowState | undefined,
  workAreas: readonly WindowBounds[],
): SavedWindowState {
  // Ozone headless can report a 1×1 virtual display. It is not a usable window constraint.
  const usableAreas = workAreas.filter((area) => area.width >= 64 && area.height >= 64);
  const primary = usableAreas[0] ?? { x: 0, y: 0, width: 1280, height: 820 };
  const original = saved?.bounds;
  const overlap = (area: WindowBounds) =>
    original
      ? Math.max(
          0,
          Math.min(original.x + original.width, area.x + area.width) - Math.max(original.x, area.x),
        ) *
        Math.max(
          0,
          Math.min(original.y + original.height, area.y + area.height) - Math.max(original.y, area.y),
        )
      : 0;
  const area = original ? ([...usableAreas].sort((a, b) => overlap(b) - overlap(a))[0] ?? primary) : primary;
  const visible = original && overlap(area) > 0;
  const width = Math.min(area.width, Math.max(880, original?.width ?? 1280));
  const height = Math.min(area.height, Math.max(600, original?.height ?? 820));
  const x = visible
    ? Math.max(area.x, Math.min(original.x, area.x + area.width - width))
    : area.x + Math.round((area.width - width) / 2);
  const y = visible
    ? Math.max(area.y, Math.min(original.y, area.y + area.height - height))
    : area.y + Math.round((area.height - height) / 2);
  return { bounds: { x, y, width, height }, maximized: saved?.maximized ?? false };
}

/** A bounded synchronous write at close also survives Electron's immediate last-window quit. */
export class WindowStateStore {
  constructor(private readonly path: string) {}

  read(): SavedWindowState | undefined {
    try {
      if (statSync(this.path).size > 4096) throw new Error('Window state exceeds its size limit.');
      const { bounds, maximized } = windowStateFileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      return { bounds, maximized };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        try {
          renameSync(this.path, `${this.path}.invalid-${randomUUID()}`);
        } catch {
          /* Keep unreadable data untouched. */
        }
      }
      return undefined;
    }
  }

  write(state: SavedWindowState): void {
    const value = windowStateFileSchema.parse({ version: 1, ...state });
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
