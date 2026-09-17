export interface PathTreeNode<Item> {
  /**
   * Folder keys are derived from their encoded path; file keys come from the caller. Keys become element
   * IDs, so callers should also encode paths, which may contain spaces or line breaks.
   */
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly item: Item | undefined;
  readonly children: readonly PathTreeNode<Item>[];
}

export interface PathTreeRow<Item> {
  readonly node: PathTreeNode<Item>;
  readonly level: number;
  readonly parentKey: string | null;
  readonly expanded: boolean;
}

interface MutableNode<Item> {
  key: string;
  name: string;
  path: string;
  item: Item | undefined;
  children: MutableNode<Item>[];
  folders: Map<string, MutableNode<Item>>;
}

/** Groups slash-separated paths into folders; folders sort before files, both by name. */
export function buildPathTree<Item>(
  items: readonly Item[],
  pathOf: (item: Item) => string,
  keyOf: (item: Item) => string,
): PathTreeNode<Item>[] {
  const root: MutableNode<Item> = {
    key: '',
    name: '',
    path: '',
    item: undefined,
    children: [],
    folders: new Map(),
  };
  for (const item of items) {
    const { name, folders } = pathParts(pathOf(item));
    let parent = root;
    for (const [index, part] of [...folders, name].entries()) {
      if (index === folders.length) {
        parent.children.push({
          key: keyOf(item),
          name: part,
          path: pathOf(item),
          item,
          children: [],
          folders: new Map(),
        });
        continue;
      }
      let folder = parent.folders.get(part);
      if (!folder) {
        const path = parent.path ? `${parent.path}/${part}` : part;
        folder = {
          key: `folder:${encodeURIComponent(path)}`,
          name: part,
          path,
          item: undefined,
          children: [],
          folders: new Map(),
        };
        parent.folders.set(part, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
  }

  const freeze = (nodes: readonly MutableNode<Item>[]): PathTreeNode<Item>[] =>
    [...nodes]
      .sort((left, right) => {
        const leftFolder = left.item === undefined;
        const rightFolder = right.item === undefined;
        if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .map((node) => ({
        key: node.key,
        name: node.name,
        path: node.path,
        item: node.item,
        children: freeze(node.children),
      }));
  return freeze(root.children);
}

/** Lists the visible rows of a tree; folders are expanded unless their key is in `collapsed`. */
export function flattenPathTree<Item>(
  nodes: readonly PathTreeNode<Item>[],
  collapsed: ReadonlySet<string>,
): PathTreeRow<Item>[] {
  const rows: PathTreeRow<Item>[] = [];
  const visit = (children: readonly PathTreeNode<Item>[], level: number, parentKey: string | null) => {
    for (const node of children) {
      const folder = node.item === undefined;
      const expanded = folder && !collapsed.has(node.key);
      rows.push({ node, level, parentKey, expanded });
      if (expanded) visit(node.children, level + 1, node.key);
    }
  };
  visit(nodes, 1, null);
  return rows;
}

/**
 * Splits a repository path into its containing folders and its own name. Git reports some directories,
 * such as ignored ones, with a trailing slash; they keep it in their name instead of gaining an empty child.
 */
function pathParts(path: string): { readonly name: string; readonly folders: string[] } {
  const directory = path.endsWith('/') && path.length > 1;
  const parts = (directory ? path.slice(0, -1) : path).split('/');
  const last = parts.pop() ?? '';
  return { name: directory ? `${last}/` : last, folders: parts };
}

/** Splits a repository path into its file name and containing folder for list views. */
export function splitPath(path: string): { readonly name: string; readonly location: string } {
  const { name, folders } = pathParts(path);
  return { name, location: folders.join('/') };
}
