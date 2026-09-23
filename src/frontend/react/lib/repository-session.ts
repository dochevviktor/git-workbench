const cleanup = new Set<(id: string) => void>();
const closed = new Set<string>();
const repositoryForKey = (key: string) => /(?:^|:)(repo-[a-f0-9]{64})(?=:|$)/u.exec(key)?.[1];

/** Session presentation survives switching tabs, and is released when its tab closes. */
export function repositorySessionMap<Value>(): Map<string, Value> {
  const values = new (class extends Map<string, Value> {
    override set(key: string, value: Value): this {
      if (!closed.has(repositoryForKey(key) ?? '')) super.set(key, value);
      return this;
    }
  })();
  cleanup.add((id) => {
    for (const key of values.keys()) if (repositoryForKey(key) === id) values.delete(key);
  });
  return values;
}

export function clearRepositorySession(id: string): void {
  closed.add(id);
  for (const release of cleanup) release(id);
  window.dispatchEvent(new CustomEvent('workbench-repository-closed', { detail: id }));
}

export function restoreRepositorySession(id: string): void {
  closed.delete(id);
}
