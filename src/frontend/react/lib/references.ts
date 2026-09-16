import type { RepositoryHistoryDecoration, RepositoryHistoryReference } from '../../../common/ipc/contracts';

export interface ReferenceChip {
  readonly key: string;
  readonly kind: RepositoryHistoryDecoration['kind'];
  readonly label: string;
  readonly current: boolean;
  /** The label also represents a remote-tracking branch at the same commit. */
  readonly tracksRemote: boolean;
  readonly title: string;
}

const chipOrder: Record<RepositoryHistoryDecoration['kind'], number> = {
  head: 0,
  branch: 1,
  remote: 2,
  tag: 3,
  stash: 4,
  other: 5,
};

/** Symbolic remote HEAD aliases repeat the branch they point to, so labels and trees omit them. */
export function isRemoteHeadAlias(reference: Pick<RepositoryHistoryDecoration, 'kind' | 'name'>): boolean {
  return reference.kind === 'remote' && reference.name.endsWith('/HEAD');
}

/**
 * Builds commit-row labels. A local branch absorbs its configured upstream when both point at the
 * same commit, so an up-to-date branch reads as one label with a remote marker.
 */
export function referenceChips(
  decorations: readonly RepositoryHistoryDecoration[],
  referencesByName: ReadonlyMap<string, RepositoryHistoryReference>,
): ReferenceChip[] {
  const visible = decorations.filter((decoration) => !isRemoteHeadAlias(decoration));
  const remoteNames = new Set(
    visible.filter((decoration) => decoration.kind === 'remote').map((decoration) => decoration.name),
  );
  const absorbed = new Set<string>();
  const chips: ReferenceChip[] = [];

  for (const decoration of visible) {
    if (decoration.kind !== 'branch') continue;
    const upstream = referencesByName.get(decoration.fullName)?.upstream ?? null;
    const tracksRemote = upstream !== null && remoteNames.has(upstream);
    if (tracksRemote) absorbed.add(upstream);
    chips.push({
      key: decoration.fullName,
      kind: 'branch',
      label: decoration.name,
      current: decoration.isHead,
      tracksRemote,
      title: tracksRemote ? `${decoration.fullName} and ${upstream}` : decoration.fullName,
    });
  }
  for (const decoration of visible) {
    if (decoration.kind === 'branch' || (decoration.kind === 'remote' && absorbed.has(decoration.name))) {
      continue;
    }
    chips.push({
      key: decoration.fullName,
      kind: decoration.kind,
      label: decoration.kind === 'head' ? 'HEAD' : decoration.name,
      current: decoration.kind === 'head',
      tracksRemote: false,
      title: decoration.fullName,
    });
  }

  return chips.sort(
    (left, right) =>
      Number(right.current) - Number(left.current) ||
      chipOrder[left.kind] - chipOrder[right.kind] ||
      left.label.localeCompare(right.label),
  );
}

export interface ReferenceTreeFolder {
  readonly type: 'folder';
  readonly key: string;
  readonly name: string;
  readonly children: readonly ReferenceTreeNode[];
}

export interface ReferenceTreeLeaf {
  readonly type: 'reference';
  readonly key: string;
  readonly name: string;
  readonly reference: RepositoryHistoryReference;
}

export type ReferenceTreeNode = ReferenceTreeFolder | ReferenceTreeLeaf;

export interface ReferenceSections {
  readonly branches: readonly ReferenceTreeNode[];
  readonly remotes: readonly ReferenceTreeNode[];
  readonly tags: readonly ReferenceTreeNode[];
  readonly stashes: readonly ReferenceTreeNode[];
  readonly counts: {
    readonly branches: number;
    readonly remotes: number;
    readonly tags: number;
    readonly stashes: number;
  };
}

interface MutableFolder {
  readonly folders: Map<string, MutableFolder>;
  readonly leaves: ReferenceTreeLeaf[];
}

function emptyFolder(): MutableFolder {
  return { folders: new Map(), leaves: [] };
}

function insert(root: MutableFolder, path: readonly string[], reference: RepositoryHistoryReference): void {
  let folder = root;
  for (const segment of path.slice(0, -1)) {
    let next = folder.folders.get(segment);
    if (!next) {
      next = emptyFolder();
      folder.folders.set(segment, next);
    }
    folder = next;
  }
  folder.leaves.push({
    type: 'reference',
    key: reference.fullName,
    name: path[path.length - 1] ?? reference.name,
    reference,
  });
}

function freeze(folder: MutableFolder, keyPrefix: string): ReferenceTreeNode[] {
  const folders = [...folder.folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, child]): ReferenceTreeFolder => ({
      type: 'folder',
      key: `${keyPrefix}/${name}`,
      name,
      children: freeze(child, `${keyPrefix}/${name}`),
    }));
  const leaves = [...folder.leaves].sort((left, right) => left.name.localeCompare(right.name));
  return [...folders, ...leaves];
}

function matches(reference: RepositoryHistoryReference, filter: string): boolean {
  return filter.length === 0 || reference.name.toLocaleLowerCase().includes(filter);
}

/** Groups references into Fork-style sidebar sections, splitting names into folders at `/`. */
export function referenceSections(
  references: readonly RepositoryHistoryReference[],
  rawFilter: string,
): ReferenceSections {
  const filter = rawFilter.trim().toLocaleLowerCase();
  const branches = emptyFolder();
  const remotes = emptyFolder();
  const tags = emptyFolder();
  const stashes = emptyFolder();
  const counts = { branches: 0, remotes: 0, tags: 0, stashes: 0 };

  for (const reference of references) {
    if (isRemoteHeadAlias(reference) || !matches(reference, filter)) continue;
    const segments = reference.name.split('/').filter((segment) => segment.length > 0);
    switch (reference.kind) {
      case 'branch':
        insert(branches, segments, reference);
        counts.branches += 1;
        break;
      case 'remote':
        insert(remotes, segments, reference);
        counts.remotes += 1;
        break;
      case 'tag':
        insert(tags, segments, reference);
        counts.tags += 1;
        break;
      case 'stash':
        insert(stashes, [reference.name], reference);
        counts.stashes += 1;
        break;
      case 'head':
      case 'other':
        break;
    }
  }

  return {
    branches: freeze(branches, 'branches'),
    remotes: freeze(remotes, 'remotes'),
    tags: freeze(tags, 'tags'),
    stashes: freeze(stashes, 'stashes'),
    counts,
  };
}
