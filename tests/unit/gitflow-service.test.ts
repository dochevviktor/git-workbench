import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import {
  applyGitFlowAction,
  GitFlowSnapshotError,
  readGitFlowContext,
} from '../../src/backend/repositories/gitflow-service';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'f'.repeat(64)}`;

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
  const git = new GitRunner();
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
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('git-flow service', () => {
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
