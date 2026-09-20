import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/backend/git/runner';
import { saveLfsPayload } from '../../src/backend/repositories/lfs-service';
import { RepositoryService } from '../../src/backend/repositories/repository-service';

const temporaryDirectories: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-lfs-'));
  temporaryDirectories.push(root);
  const repositoryPath = join(root, 'repository');
  await mkdir(repositoryPath);
  const runner = new GitRunner();
  const service = new RepositoryService({ storagePath: join(root, 'recent.json'), runner });
  const repository = await service.initialize(41, repositoryPath, false);
  return { root, repositoryPath, runner, service, repository };
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('local Git LFS inspection and retrieval', () => {
  it('identifies a committed pointer, reads the local payload, and leaves the checkout unchanged', async () => {
    const { root, repositoryPath, runner, service, repository } = await fixture();
    const payload = Buffer.alloc(32_768, 0x5a);
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${payload.byteLength}\n`;
    await writeFile(join(repositoryPath, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    await writeFile(join(repositoryPath, 'sample.bin'), pointer);
    await runner.run(['add', '--', '.gitattributes', 'sample.bin'], { cwd: repositoryPath });
    await runner.run(
      [
        '-c',
        'user.name=LFS Tester',
        '-c',
        'user.email=lfs@test.invalid',
        'commit',
        '--quiet',
        '-m',
        'LFS file',
      ],
      { cwd: repositoryPath },
    );
    const commitId = (await runner.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim();
    const objectPath = join(repository.gitDir, 'lfs', 'objects', sha256.slice(0, 2), sha256.slice(2, 4));
    await mkdir(objectPath, { recursive: true });
    await writeFile(join(objectPath, sha256), payload);

    const file = await service.getLfsFile(41, repository.id, commitId, 'sample.bin');
    expect(file).toMatchObject({
      tracked: true,
      history: {
        kind: 'lfs',
        pointer: { oid: `sha256:${sha256}`, size: payload.byteLength },
        payloadState: 'available',
        payloadByteLength: payload.byteLength,
      },
      worktree: { state: 'pointer', byteLength: Buffer.byteLength(pointer) },
    });

    const destination = join(root, 'saved.bin');
    const progress: number[] = [];
    const saved = await saveLfsPayload(
      runner,
      {
        repositoryId: repository.id,
        cwd: repositoryPath,
        worktreePath: repositoryPath,
        commitId,
        path: 'sample.bin',
      },
      destination,
      {
        signal: new AbortController().signal,
        setProgress: (value) => {
          if (value && value.percent !== null) progress.push(value.percent);
        },
      },
    );
    expect(saved).toEqual({ path: destination, byteLength: payload.byteLength, sha256 });
    expect(await readFile(destination)).toEqual(payload);
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(await readFile(join(repositoryPath, 'sample.bin'), 'utf8')).toBe(pointer);
    expect((await runner.run(['status', '--porcelain'], { cwd: repositoryPath })).stdout).toBe('');

    const cancelledDestination = join(root, 'cancelled.bin');
    const controller = new AbortController();
    await expect(
      saveLfsPayload(
        runner,
        {
          repositoryId: repository.id,
          cwd: repositoryPath,
          worktreePath: repositoryPath,
          commitId,
          path: 'sample.bin',
        },
        cancelledDestination,
        {
          signal: controller.signal,
          setProgress: (value) => {
            if (value?.percent === 0) controller.abort();
          },
        },
      ),
    ).rejects.toThrow('cancelled');
    await expect(readFile(cancelledDestination)).rejects.toThrow();
  });

  it('reports a missing local object without treating a pointer as a regular binary', async () => {
    const { repositoryPath, runner, service, repository } = await fixture();
    const payload = Buffer.from('payload that is not in the local cache');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${payload.byteLength}\n`;
    await writeFile(join(repositoryPath, '.gitattributes'), '*.bin filter=lfs\n');
    await writeFile(join(repositoryPath, 'missing.bin'), pointer);
    await runner.run(['add', '--', '.gitattributes', 'missing.bin'], { cwd: repositoryPath });
    await runner.run(
      [
        '-c',
        'user.name=LFS Tester',
        '-c',
        'user.email=lfs@test.invalid',
        'commit',
        '--quiet',
        '-m',
        'Missing LFS',
      ],
      { cwd: repositoryPath },
    );
    const commitId = (await runner.run(['rev-parse', 'HEAD'], { cwd: repositoryPath })).stdout.trim();

    await expect(service.getLfsFile(41, repository.id, commitId, 'missing.bin')).resolves.toMatchObject({
      history: { kind: 'lfs', payloadState: 'missing', payloadByteLength: null },
      worktree: { state: 'pointer' },
    });
  });
});
