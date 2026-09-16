const avatarPaletteSize = 8;

const listDateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const detailDateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'shortOffset',
});

const relativeDateFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatListDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : listDateFormat.format(date);
}

export function formatDetailDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : detailDateFormat.format(date);
}

export function formatRelativeDate(value: string, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const seconds = Math.round((date.valueOf() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeDateFormat.format(Math.round(seconds / size), unit);
  }
  return relativeDateFormat.format(seconds, 'second');
}

export function shortHash(id: string): string {
  return id.slice(0, 7);
}

export function initials(name: string, email: string): string {
  const words = (name || email.split('@')[0] || '?').split(/[\s._-]+/u).filter((word) => word.length > 0);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0]];
  return letters.join('').toLocaleUpperCase() || '?';
}

/** A stable palette slot derived from an identity; it is decoration, never an identity check. */
export function avatarColor(identity: string): number {
  let hash = 0;
  for (const character of identity.toLocaleLowerCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % avatarPaletteSize;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
