import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testPlatform } from '../platform';
import { GitRunner, GitCancelledError } from '../../src/backend/git/runner';
import {
  applyGitFlowAction,
  GitFlowSnapshotError,
  readGitFlowContext,
} from '../../src/backend/repositories/gitflow-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'f'.repeat(64)}`;
let testSignal: AbortSignal;
const pending = new Set<Promise<unknown>>();
beforeEach(({ signal }) => {
  testSignal = signal;
});

function fixtureRunner(): GitRunner {
  const git = new GitRunner();
  const run = git.run.bind(git);
  git.run = (args, options) => {
    const task = run(args, {
      ...options,
      signal: options.signal ? AbortSignal.any([testSignal, options.signal]) : testSignal,
    });
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };
  return git;
}

interface Fixture {
  readonly root: string;
  readonly cwd: string;
  readonly git: GitRunner;
}

async function fixtureRepository(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-gitflow-'));
  temporaryDirectories.push(root);
  const cwd = join(root, 'repository');
  await mkdir(cwd);
  const git = fixtureRunner();
  await git.run(['init', '--quiet', '--initial-branch=main'], { cwd });
  await git.run(['config', 'user.name', 'Git-flow Author'], { cwd });
  await git.run(['config', 'user.email', 'gitflow@example.test'], { cwd });
  await writeFile(join(cwd, 'README.md'), 'baseline\n', 'utf8');
  await git.run(['add', '--', 'README.md'], { cwd });
  await git.run(['commit', '--quiet', '-m', 'baseline'], { cwd });
  return { root, cwd, git };
}

async function context(fixture: Fixture) {
  return readGitFlowContext(fixture.git, {
    repositoryId,
    cwd: fixture.cwd,
    gitDir: join(fixture.cwd, '.git'),
    worktreePath: fixture.cwd,
  });
}

async function apply(fixture: Fixture, action: Parameters<typeof applyGitFlowAction>[1]['action']) {
  return applyGitFlowAction(fixture.git, {
    repositoryId,
    cwd: fixture.cwd,
    gitDir: join(fixture.cwd, '.git'),
    worktreePath: fixture.cwd,
    action,
  });
}

async function commit(fixture: Fixture, file: string, contents: string, message: string) {
  await writeFile(join(fixture.cwd, file), contents, 'utf8');
  await fixture.git.run(['add', '--', file], { cwd: fixture.cwd });
  await fixture.git.run(['commit', '--quiet', '-m', message], { cwd: fixture.cwd });
}

async function hasRef(fixture: Fixture, fullName: string): Promise<boolean> {
  try {
    await fixture.git.run(['show-ref', '--verify', '--quiet', fullName], { cwd: fixture.cwd });
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.allSettled([...pending]);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('git-flow service', () => {
  it(
    'finishes a topic from its linked worktree and honors fast-forward, retention and production-only options',
    { timeout: testPlatform.windows ? 90000 : 5000 },
    async () => {
      const f = await fixtureRepository();
      await initializeFixture(f, 'v');
      const production = (await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout;
      const linked = join(f.root, 'topic-worktree');
      await f.git.run(['worktree', 'add', '--quiet', '-b', 'feature/linked', linked, 'develop'], {
        cwd: f.cwd,
      });
      const input = {
        repositoryId,
        cwd: linked,
        worktreePath: linked,
        gitDir: (await f.git.run(['rev-parse', '--absolute-git-dir'], { cwd: linked })).stdout.trim(),
      };
      const state = () => readGitFlowContext(f.git, input);
      await commit({ ...f, cwd: linked }, 'linked.txt', 'feature\n', 'linked feature');
      const source = (await f.git.run(['rev-parse', 'HEAD'], { cwd: linked })).stdout;
      expect(
        await applyGitFlowAction(f.git, {
          ...input,
          action: {
            kind: 'finish',
            type: 'feature',
            name: 'linked',
            snapshot: (await state()).snapshot,
            noFastForward: false,
            keepBranch: true,
            mergeIntoDevelop: true,
            tagMessage: '',
          },
        }),
      ).toMatchObject({ status: 'applied' });
      expect((await f.git.run(['rev-parse', 'main'], { cwd: linked })).stdout).toBe(production);
      expect((await f.git.run(['rev-parse', 'develop'], { cwd: linked })).stdout).toBe(source);
      expect(await hasRef(f, 'refs/heads/feature/linked')).toBe(true);
      await applyGitFlowAction(f.git, {
        ...input,
        action: { kind: 'start', type: 'release', name: '4.0', snapshot: (await state()).snapshot },
      });
      await commit({ ...f, cwd: linked }, 'VERSION', '4.0\n', 'release');
      expect((await state()).capabilities.canFinish).toBe(false);
      await f.git.run(['checkout', '--quiet', '-b', 'parking'], { cwd: f.cwd });
      expect(
        await applyGitFlowAction(f.git, {
          ...input,
          action: {
            kind: 'finish',
            type: 'release',
            name: '4.0',
            snapshot: (await state()).snapshot,
            noFastForward: false,
            keepBranch: false,
            mergeIntoDevelop: false,
            tagMessage: 'Version four',
          },
        }),
      ).toMatchObject({ status: 'applied', tag: 'refs/tags/v4.0', context: { head: { name: 'main' } } });
      expect((await f.git.run(['rev-parse', 'develop'], { cwd: f.cwd })).stdout).toBe(source);
      expect((await f.git.run(['cat-file', '-t', 'v4.0'], { cwd: f.cwd })).stdout.trim()).toBe('tag');
      expect(await hasRef(f, 'refs/heads/release/4.0')).toBe(false);
    },
  );
  it(
    'resumes a feature conflict after restarting without merging it into production',
    { timeout: testPlatform.windows ? 90000 : 5000 },
    async () => {
      const f = await fixtureRepository();
      await initializeFixture(f);
      const main = (await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout;
      await apply(f, {
        kind: 'start',
        type: 'feature',
        name: 'conflict',
        snapshot: (await context(f)).snapshot,
      });
      await commit(f, 'README.md', 'feature\n', 'feature edit');
      await f.git.run(['checkout', '--quiet', 'develop'], { cwd: f.cwd });
      await commit(f, 'README.md', 'develop\n', 'develop edit');
      await f.git.run(['checkout', '--quiet', 'feature/conflict'], { cwd: f.cwd });
      const failed = await apply(f, {
        kind: 'finish',
        type: 'feature',
        name: 'conflict',
        noFastForward: true,
        mergeIntoDevelop: true,
        keepBranch: false,
        tagMessage: '',
        snapshot: (await context(f)).snapshot,
      });
      expect(failed).toMatchObject({
        status: 'blocked',
        reason: 'conflict',
        context: { pendingFinish: { name: 'conflict' }, pendingOperation: 'merge' },
      });
      const restored = { ...f, git: fixtureRunner() };
      expect((await context(restored)).pendingFinish?.step).toContain('develop');
      await writeFile(join(f.cwd, 'README.md'), 'resolved\n');
      await f.git.run(['add', 'README.md'], { cwd: f.cwd });
      const finished = await apply(restored, {
        kind: 'continue',
        snapshot: (await context(restored)).snapshot,
      });
      expect(finished).toMatchObject({
        status: 'applied',
        context: { pendingFinish: null, pendingOperation: null, head: { name: 'develop' } },
      });
      expect((await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout).toBe(main);
      expect(await hasRef(f, 'refs/heads/feature/conflict')).toBe(false);
      expect(await readFile(join(f.cwd, 'README.md'), 'utf8')).toBe('resolved\n');
    },
  );

  it('retains production and the prefixed tag when a later release merge is stopped', async () => {
    const f = await fixtureRepository();
    await initializeFixture(f, 'v');
    await apply(f, { kind: 'start', type: 'release', name: '2.0', snapshot: (await context(f)).snapshot });
    await commit(f, 'README.md', 'release\n', 'release edit');
    await f.git.run(['checkout', '--quiet', 'develop'], { cwd: f.cwd });
    await commit(f, 'README.md', 'develop\n', 'develop edit');
    await f.git.run(['checkout', '--quiet', 'release/2.0'], { cwd: f.cwd });
    const failed = await apply(f, {
      kind: 'finish',
      type: 'release',
      name: '2.0',
      noFastForward: true,
      mergeIntoDevelop: true,
      keepBranch: false,
      tagMessage: 'Version two',
      snapshot: (await context(f)).snapshot,
    });
    expect(failed).toMatchObject({ status: 'blocked', reason: 'conflict', tag: 'refs/tags/v2.0' });
    const production = (await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout.trim();
    expect((await f.git.run(['rev-parse', 'v2.0^{commit}'], { cwd: f.cwd })).stdout.trim()).toBe(production);
    await f.git.run(['merge', '--abort'], { cwd: f.cwd });
    expect(await apply(f, { kind: 'stop', snapshot: (await context(f)).snapshot })).toMatchObject({
      status: 'applied',
      context: { pendingFinish: null },
    });
    expect((await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout.trim()).toBe(production);
    expect(await hasRef(f, 'refs/heads/release/2.0')).toBe(true);
    expect(await hasRef(f, 'refs/tags/v2.0')).toBe(true);
  });

  it('recognizes a completed merge interrupted before journaling its result and does not duplicate it', async () => {
    const f = await fixtureRepository();
    await initializeFixture(f);
    await apply(f, { kind: 'start', type: 'hotfix', name: '3.0', snapshot: (await context(f)).snapshot });
    await commit(f, 'hotfix.txt', 'fix\n', 'fix');
    const snapshot = (await context(f)).snapshot;
    let interrupted = false;
    await expect(
      applyGitFlowAction(
        {
          run: async (args, options) => {
            const result = await f.git.run(args, options);
            if (!interrupted && args[0] === 'merge') {
              interrupted = true;
              throw new GitCancelledError();
            }
            return result;
          },
        },
        {
          repositoryId,
          cwd: f.cwd,
          worktreePath: f.cwd,
          gitDir: join(f.cwd, '.git'),
          action: {
            kind: 'finish',
            type: 'hotfix',
            name: '3.0',
            snapshot,
            noFastForward: true,
            mergeIntoDevelop: true,
            keepBranch: true,
            tagMessage: '',
          },
        },
      ),
    ).rejects.toBeInstanceOf(GitCancelledError);
    const production = (await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout;
    const restarted = { ...f, git: new GitRunner() };
    expect(
      await apply(restarted, { kind: 'continue', snapshot: (await context(restarted)).snapshot }),
    ).toMatchObject({ status: 'applied', context: { pendingFinish: null } });
    expect((await f.git.run(['rev-parse', 'main'], { cwd: f.cwd })).stdout).toBe(production);
    expect(await hasRef(f, 'refs/heads/hotfix/3.0')).toBe(true);
    expect((await f.git.run(['show', 'develop:hotfix.txt'], { cwd: f.cwd })).stdout).toBe('fix\n');
  });

  it('preflights both finish destinations before writing any history when another worktree owns one', async () => {
    const f = await fixtureRepository();
    await initializeFixture(f);
    await apply(f, {
      kind: 'start',
      type: 'release',
      name: 'occupied',
      snapshot: (await context(f)).snapshot,
    });
    await commit(f, 'release.txt', 'release\n', 'release');
    const refs = (await f.git.run(['show-ref'], { cwd: f.cwd })).stdout;
    await f.git.run(['worktree', 'add', '--quiet', join(f.root, 'development'), 'develop'], { cwd: f.cwd });
    expect(
      await apply(f, {
        kind: 'finish',
        type: 'release',
        name: 'occupied',
        noFastForward: true,
        mergeIntoDevelop: true,
        keepBranch: false,
        tagMessage: '',
        snapshot: (await context(f)).snapshot,
      }),
    ).toMatchObject({ status: 'blocked' });
    expect((await f.git.run(['show-ref'], { cwd: f.cwd })).stdout).toBe(refs);
    expect((await context(f)).head.name).toBe('release/occupied');
  });
  it('initializes and completes feature, release, and hotfix lifecycles', async () => {
    const fixture = await fixtureRepository();
    const configuration = {
      productionBranch: 'main',
      developBranch: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
    } as const;

    const unconfigured = await context(fixture);
    expect(unconfigured).toMatchObject({
      status: 'unconfigured',
      capabilities: { canInitialize: true, canStart: false, canFinish: false },
    });

    const initialized = await apply(fixture, {
      kind: 'initialize',
      config: configuration,
      snapshot: unconfigured.snapshot,
    });
    expect(initialized).toMatchObject({
      status: 'applied',
      kind: 'initialize',
      createdBranch: 'refs/heads/develop',
    });
    if (initialized.status !== 'applied') throw new Error(initialized.message);
    expect(
      await fixture.git.run(['show-ref', '--verify', 'refs/heads/develop'], { cwd: fixture.cwd }),
    ).toMatchObject({
      exitCode: 0,
    });

    const startedFeature = await apply(fixture, {
      kind: 'start',
      type: 'feature',
      name: 'settings',
      snapshot: initialized.context.snapshot,
    });
    expect(startedFeature).toMatchObject({
      status: 'applied',
      createdBranch: 'refs/heads/feature/settings',
      context: { head: { name: 'feature/settings' } },
    });
    if (startedFeature.status !== 'applied') throw new Error(startedFeature.message);
    await commit(fixture, 'settings.txt', 'feature\n', 'feature settings');
    const productionBeforeFeature = (await fixture.git.run(['rev-parse', 'main'], { cwd: fixture.cwd }))
      .stdout;

    const finishedFeature = await apply(fixture, {
      kind: 'finish',
      type: 'feature',
      name: 'settings',
      snapshot: (await context(fixture)).snapshot,
      noFastForward: true,
      mergeIntoDevelop: true,
      tagMessage: '',
      keepBranch: false,
    });
    expect(finishedFeature).toMatchObject({
      status: 'applied',
      deletedBranch: 'refs/heads/feature/settings',
      context: { head: { name: 'develop' } },
    });
    expect(await hasRef(fixture, 'refs/heads/feature/settings')).toBe(false);
    expect((await fixture.git.run(['rev-parse', 'main'], { cwd: fixture.cwd })).stdout).toBe(
      productionBeforeFeature,
    );
    expect((await fixture.git.run(['show', 'develop:settings.txt'], { cwd: fixture.cwd })).stdout).toBe(
      'feature\n',
    );

    const startedRelease = await apply(fixture, {
      kind: 'start',
      type: 'release',
      name: '1.0.0',
      snapshot: (await context(fixture)).snapshot,
    });
    expect(startedRelease.status).toBe('applied');
    if (startedRelease.status !== 'applied') throw new Error(startedRelease.message);
    await commit(fixture, 'VERSION', '1.0.0\n', 'prepare 1.0.0');

    const finishedRelease = await apply(fixture, {
      kind: 'finish',
      type: 'release',
      name: '1.0.0',
      snapshot: (await context(fixture)).snapshot,
      noFastForward: true,
      mergeIntoDevelop: true,
      tagMessage: 'Release 1.0.0',
      keepBranch: false,
    });
    expect(finishedRelease).toMatchObject({
      status: 'applied',
      deletedBranch: 'refs/heads/release/1.0.0',
      tag: 'refs/tags/1.0.0',
      context: { head: { name: 'develop' } },
    });
    expect(
      (await fixture.git.run(['cat-file', '-t', 'refs/tags/1.0.0'], { cwd: fixture.cwd })).stdout.trim(),
    ).toBe('tag');

    const startedHotfix = await apply(fixture, {
      kind: 'start',
      type: 'hotfix',
      name: '1.0.1',
      snapshot: (await context(fixture)).snapshot,
    });
    expect(startedHotfix.status).toBe('applied');
    if (startedHotfix.status !== 'applied') throw new Error(startedHotfix.message);
    await commit(fixture, 'fix.txt', 'hotfix\n', 'fix production issue');

    const finishedHotfix = await apply(fixture, {
      kind: 'finish',
      type: 'hotfix',
      name: '1.0.1',
      snapshot: (await context(fixture)).snapshot,
      noFastForward: true,
      mergeIntoDevelop: true,
      tagMessage: '',
      keepBranch: false,
    });
    expect(finishedHotfix).toMatchObject({
      status: 'applied',
      deletedBranch: 'refs/heads/hotfix/1.0.1',
      tag: 'refs/tags/1.0.1',
      context: { head: { name: 'develop' } },
    });
    expect((await fixture.git.run(['show', 'refs/heads/develop:fix.txt'], { cwd: fixture.cwd })).stdout).toBe(
      'hotfix\n',
    );
  });

  it('refuses stale and dirty mutations without changing refs', async () => {
    const fixture = await fixtureRepository();
    const configuration = {
      productionBranch: 'main',
      developBranch: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
    } as const;
    const initial = await context(fixture);
    const initialized = await apply(fixture, {
      kind: 'initialize',
      config: configuration,
      snapshot: initial.snapshot,
    });
    if (initialized.status !== 'applied') throw new Error(initialized.message);
    await writeFile(join(fixture.cwd, 'local.txt'), 'unsaved\n', 'utf8');
    const dirty = await context(fixture);
    expect(dirty.capabilities.canStart).toBe(false);
    const refused = await apply(fixture, {
      kind: 'start',
      type: 'feature',
      name: 'blocked',
      snapshot: dirty.snapshot,
    });
    expect(refused).toMatchObject({ status: 'blocked', reason: 'dirty' });
    expect(await hasRef(fixture, 'refs/heads/feature/blocked')).toBe(false);

    await rm(join(fixture.cwd, 'local.txt'), { force: true });
    await fixture.git.run(['branch', 'external'], { cwd: fixture.cwd });
    await expect(
      apply(fixture, {
        kind: 'start',
        type: 'feature',
        name: 'stale',
        snapshot: initialized.context.snapshot,
      }),
    ).rejects.toBeInstanceOf(GitFlowSnapshotError);
  });
});

async function initializeFixture(f: Fixture, tagPrefix = '') {
  expect(
    await apply(f, {
      kind: 'initialize',
      config: {
        productionBranch: 'main',
        developBranch: 'develop',
        featurePrefix: 'feature/',
        releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/',
        tagPrefix,
      },
      snapshot: (await context(f)).snapshot,
    }),
  ).toMatchObject({ status: 'applied' });
}
