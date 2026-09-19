import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteFetchPreferenceStore } from '../../src/backend/repositories/remote-fetch-preference-store';

const temporaryDirectories: string[] = [];
const repositoryId = `repo-${'b'.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('remote fetch preference store', () => {
  it('persists remote opt-outs and follows a remote rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-workbench-fetch-preferences-'));
    temporaryDirectories.push(root);
    const path = join(root, 'preferences.json');
    const store = new RemoteFetchPreferenceStore(path);

    await store.setEnabled(repositoryId, 'origin', false);
    await store.setEnabled(repositoryId, 'backup', true);
    await store.rename(repositoryId, 'origin', 'upstream');

    const reopened = new RemoteFetchPreferenceStore(path);
    expect(await reopened.disabledRemotes(repositoryId)).toEqual(['upstream']);
    await reopened.setEnabled(repositoryId, 'upstream', true);
    expect(await reopened.disabledRemotes(repositoryId)).toEqual([]);
  });

  it('quarantines malformed persisted state without enabling a remote', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-workbench-fetch-preferences-'));
    temporaryDirectories.push(root);
    const path = join(root, 'preferences.json');
    await writeFile(path, '{not-json', 'utf8');

    const store = new RemoteFetchPreferenceStore(path);
    expect(await store.isDisabled(repositoryId, 'origin')).toBe(false);
    expect(await readdir(root)).toEqual([expect.stringMatching(/^preferences\.json\.corrupt-/u)]);
  });
});
