import { opendir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

export type DiscoveredRepositoryKind = 'worktree' | 'bare';
export type SourceScanWarningCode = 'unreadable' | 'scan-limit' | 'depth-limit' | 'symlink-skipped';

export interface SourceScanRepository {
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
  readonly kind: DiscoveredRepositoryKind;
}

export interface SourceScanWarning {
  readonly code: SourceScanWarningCode;
  readonly path: string;
  readonly message: string;
}

export interface SourceScanResult {
  readonly repositories: readonly SourceScanRepository[];
  readonly warnings: readonly SourceScanWarning[];
  readonly scannedEntries: number;
  readonly truncated: boolean;
  readonly rootReadable: boolean;
}

export interface SourceScanOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxRepositories?: number;
  readonly maxWarnings?: number;
}

const defaultOptions: Required<SourceScanOptions> = {
  maxDepth: 12,
  maxEntries: 25_000,
  maxRepositories: 2_000,
  maxWarnings: 100,
};

/**
 * Finds repository roots using filesystem markers. It never executes Git, follows directory
 * symlinks, or descends into a discovered repository's private data.
 */
export async function scanSourceDirectory(
  sourcePath: string,
  options: SourceScanOptions = {},
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  const limits = { ...defaultOptions, ...options };
  const repositories: SourceScanRepository[] = [];
  const warnings: SourceScanWarning[] = [];
  let scannedEntries = 0;
  let truncated = false;
  let rootReadable = true;
  let repositoryLimitReported = false;

  const addWarning = (warning: SourceScanWarning): void => {
    if (warnings.length < limits.maxWarnings) warnings.push(warning);
  };

  const markLimit = (path: string, message: string): void => {
    truncated = true;
    addWarning({ code: 'scan-limit', path, message });
  };

  const markRepositoryLimit = (path: string): void => {
    if (repositoryLimitReported) return;
    repositoryLimitReported = true;
    markLimit(path, 'The source scan reached its repository limit.');
  };

  const visit = async (directory: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    const entries: Dirent[] = [];
    try {
      const stream = await opendir(directory);
      for await (const entry of stream) {
        signal?.throwIfAborted();
        if (entries.length >= limits.maxEntries - scannedEntries) {
          markLimit(directory, 'The source scan reached its entry limit.');
          break;
        }
        entries.push(entry);
      }
    } catch {
      signal?.throwIfAborted();
      if (directory === sourcePath) rootReadable = false;
      addWarning({
        code: 'unreadable',
        path: directory,
        message: 'This folder could not be read; the source scan may be incomplete.',
      });
      return;
    }

    const repositoryKind = classifyRepository(entries);
    if (repositoryKind) {
      if (repositories.length >= limits.maxRepositories) {
        markRepositoryLimit(directory);
        return;
      }
      repositories.push({
        name: basenameFromPath(directory),
        path: directory,
        relativePath: relativePathFor(sourcePath, directory),
        kind: repositoryKind,
      });
      if (repositories.length >= limits.maxRepositories) markRepositoryLimit(directory);
      return;
    }

    if (depth >= limits.maxDepth) {
      if (entries.some((entry) => entry.isDirectory())) {
        truncated = true;
        addWarning({
          code: 'depth-limit',
          path: directory,
          message: 'Some nested folders were not scanned because the depth limit was reached.',
        });
      }
      return;
    }

    for (const entry of sortEntries(entries)) {
      signal?.throwIfAborted();
      if (scannedEntries >= limits.maxEntries) {
        markLimit(directory, 'The source scan reached its safety limit.');
        return;
      }
      scannedEntries += 1;

      if (entry.name === '.git') continue;
      if (entry.isSymbolicLink()) {
        addWarning({
          code: 'symlink-skipped',
          path: join(directory, entry.name),
          message: 'Symbolic-link entries are skipped to keep the scan inside the selected source folder.',
        });
        continue;
      }
      if (!entry.isDirectory()) continue;
      await visit(join(directory, entry.name), depth + 1);
      if (scannedEntries >= limits.maxEntries && !truncated) {
        markLimit(directory, 'The source scan reached its safety limit.');
      }
      if (repositories.length >= limits.maxRepositories) return;
    }
  };

  await visit(sourcePath, 0);
  return { repositories, warnings, scannedEntries, truncated, rootReadable };
}

function classifyRepository(entries: readonly Dirent[]): DiscoveredRepositoryKind | null {
  const gitMarker = entries.find((entry) => entry.name === '.git');
  if (gitMarker && (gitMarker.isDirectory() || gitMarker.isFile() || gitMarker.isSymbolicLink())) {
    return 'worktree';
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const head = byName.get('HEAD');
  const config = byName.get('config');
  const objects = byName.get('objects');
  const refs = byName.get('refs');
  if (head?.isFile() && config?.isFile() && objects?.isDirectory() && refs?.isDirectory()) {
    return 'bare';
  }
  return null;
}

function sortEntries(entries: readonly Dirent[]): Dirent[] {
  return [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'variant' }),
  );
}

function relativePathFor(sourcePath: string, repositoryPath: string): string {
  const value = relative(sourcePath, repositoryPath);
  return value ? value.split(sep).join('/') : '';
}

function basenameFromPath(path: string): string {
  const normalized = path.endsWith(sep) && path.length > sep.length ? path.slice(0, -1) : path;
  const separator = normalized.lastIndexOf(sep);
  return separator >= 0 ? normalized.slice(separator + 1) || normalized : normalized;
}
