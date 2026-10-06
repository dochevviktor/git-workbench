/** Merge native environment names and canonicalize only the variables controlled by Git policy. */
export function gitEnvironment(...sources: readonly (NodeJS.ProcessEnv | undefined)[]): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const keys = new Map<string, string>();
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const identity = process.platform === 'win32' ? name.toUpperCase() : name;
      // Preserve spelling for other variables: Git's Bash hooks can use lowercase shell names.
      const key =
        process.platform === 'win32' && /^(?:GIT_|GCM_|SSH_ASKPASS(?:_|$))/u.test(identity) ? identity : name;
      const previous = keys.get(identity);
      if (previous !== undefined) delete result[previous];
      keys.set(identity, key);
      result[key] = value;
    }
  }
  return result;
}
