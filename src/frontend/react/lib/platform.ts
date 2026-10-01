import type { AppInfo } from '../../../common/ipc/contracts';
import { resolveShortcut } from './shortcut-preferences';

export type Platform = AppInfo['platform'];

const modifiers = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
/** macOS lists modifier symbols as Control, Option, Shift, Command. */
const macModifierOrder = ['Ctrl', 'Alt', 'Shift', 'Mod'] as const;
/** Arrow keys are shown as arrows on every platform. */
const keyGlyphs: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};
const macSymbols: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Plus: '+',
};

/** A first guess before the backend reports its platform; it only affects chrome and labels. */
export function detectPlatform(): Platform {
  const hint = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (hint.includes('mac')) return 'darwin';
  if (hint.includes('win')) return 'win32';
  return 'linux';
}

function shortcutParts(shortcut: string) {
  const parts = shortcut.split('+');
  return {
    parts: new Set(parts),
    key: parts.find((part) => !(modifiers as readonly string[]).includes(part)),
  };
}

/**
 * Shortcuts are written as `Mod+Shift+T`, where `Mod` is Command on macOS and Control elsewhere.
 * Key names follow `KeyboardEvent.key`; `Plus` stands for the `+` character.
 */
export function formatShortcut(shortcut: string, platform: Platform): string {
  shortcut = resolveShortcut(shortcut);
  const { parts, key = '' } = shortcutParts(shortcut);
  if (platform === 'darwin') {
    const symbols = macModifierOrder
      .filter((modifier) => parts.has(modifier))
      .map((modifier) => macSymbols[modifier]);
    return `${symbols.join('')}${keyGlyphs[key] ?? macSymbols[key] ?? key}`;
  }
  return [
    ...modifiers
      .filter((modifier) => parts.has(modifier))
      .map((modifier) => (modifier === 'Mod' ? 'Ctrl' : modifier)),
    keyGlyphs[key] ?? (key === 'Plus' ? '+' : key),
  ].join('+');
}

/** The `aria-keyshortcuts` spelling, for example `Control+Shift+T`. */
export function ariaShortcut(shortcut: string, platform: Platform): string {
  shortcut = resolveShortcut(shortcut);
  const names: Readonly<Record<string, string>> = {
    Mod: platform === 'darwin' ? 'Meta' : 'Control',
    Ctrl: 'Control',
    Plus: '+',
  };
  return shortcut
    .split('+')
    .map((part) => names[part] ?? part)
    .join('+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string, platform: Platform): boolean {
  if (isTextInputEvent(event)) return false;
  shortcut = resolveShortcut(shortcut);
  const { parts, key } = shortcutParts(shortcut);
  if (!key) return false;
  const mac = platform === 'darwin';
  const wantsControl = parts.has('Ctrl') || (!mac && parts.has('Mod'));
  const wantsMeta = mac && parts.has('Mod');
  if (event.ctrlKey !== wantsControl || event.metaKey !== wantsMeta || event.altKey !== parts.has('Alt')) {
    return false;
  }
  // Shift produces a different character for punctuation keys such as `=` and `+`.
  const punctuation = key === 'Plus' || /^[^A-Za-z0-9]$/u.test(key);
  if (!punctuation && event.shiftKey !== parts.has('Shift')) return false;
  return event.key.toLowerCase() === (key === 'Plus' ? '+' : key).toLowerCase();
}

/** IME confirmation and AltGr belong to text entry, even when they resemble command shortcuts. */
export function isTextInputEvent(event: {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  getModifierState?(key: string): boolean;
}): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.getModifierState?.('AltGraph') === true;
}
