import type { RepositoryIntegrationPreview } from '../../common/ipc/contracts';
import { GitCommandError } from '../git/runner';
import type { GitCommandResult, GitRunOptions } from '../git/runner';

interface Runner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitCommandResult>;
}

/** Simulate trees only: no checkout, index, branch, hooks, or sequencer is changed. */
export async function previewIntegration(
  runner: Runner,
  cwd: string,
  input: {
    readonly kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert';
    readonly head: string;
    readonly target: string;
    readonly parent?: string | undefined;
  },
): Promise<RepositoryIntegrationPreview> {
  const name =
    input.kind === 'cherry-pick' ? 'Cherry-pick' : input.kind[0]!.toUpperCase() + input.kind.slice(1);
  const unknown = {
    state: 'unknown' as const,
    message: `${name} conflicts will be checked when the operation starts.`,
  };
  const options: GitRunOptions = {
    cwd,
    timeoutMs: 8_000,
    maxOutputBytes: 2 * 1024 * 1024,
    signal: AbortSignal.timeout(8_000),
  };
  const run = async (args: string[], stdin?: string) =>
    (await runner.run(args, { ...options, ...(stdin !== undefined ? { stdin } : {}) })).stdout.trim();
  const merge = async (ours: string, theirs: string, base?: string) => {
    const output = await run([
      'merge-tree',
      '--write-tree',
      '--no-messages',
      ...(base ? [`--merge-base=${base}`] : []),
      ours,
      theirs,
    ]);
    const tree = output.split('\n')[0]!;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(tree)) throw new Error('Invalid preview tree');
    return tree;
  };
  try {
    if (input.kind === 'merge') await merge(input.head, input.target);
    else if (input.kind === 'rebase') {
      const commits = (
        await run([
          'rev-list',
          '--reverse',
          '--topo-order',
          '--max-count=51',
          `${input.target}..${input.head}`,
        ])
      )
        .split('\n')
        .filter(Boolean);
      if (commits.length > 50) return unknown;
      let onto = input.target;
      for (const commit of commits) {
        const parents = (await run(['show', '-s', '--format=%P', commit])).split(' ').filter(Boolean);
        if (parents.length !== 1) return unknown;
        const tree = await merge(onto, commit, parents[0]);
        // Rebase the next patch on the projected result. These unreachable objects have no refs.
        onto = await run(
          [
            '-c',
            'user.name=Git Workbench',
            '-c',
            'user.email=preview@git-workbench.invalid',
            '-c',
            'commit.gpgsign=false',
            'commit-tree',
            tree,
            '-p',
            onto,
          ],
          'Conflict preview\n',
        );
      }
    } else {
      if (!input.parent) return unknown;
      await merge(
        input.head,
        input.kind === 'revert' ? input.parent : input.target,
        input.kind === 'revert' ? input.target : input.parent,
      );
    }
    return { state: 'clean', message: `${name} can be done without conflicts.` };
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1)
      return { state: 'conflicts', message: `${name} will cause conflicts.` };
    return unknown;
  }
}
