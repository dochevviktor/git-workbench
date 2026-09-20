import { useState } from 'react';
import type { RepositorySubmoduleAction } from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { SubmoduleIcon } from './Icons';
import { DialogShell } from './DialogShell';

interface SubmoduleDialogProps {
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: Extract<RepositorySubmoduleAction, { kind: 'add' }>) => void;
  readonly onClose: () => void;
}

/** Adds one submodule with explicit path, URL, and recursive-clone choices. */
export function SubmoduleDialog({ platform, busy, failure, onSubmit, onClose }: SubmoduleDialogProps) {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [branch, setBranch] = useState('');
  const [recursive, setRecursive] = useState(false);
  const validPath =
    path.trim().length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..');
  return (
    <DialogShell
      title="Add Submodule"
      subtitle="Register and initialize a child repository"
      icon={<SubmoduleIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel="Add"
      submitDisabled={!url.trim() || !validPath}
      busy={busy}
      onSubmit={() =>
        onSubmit({
          kind: 'add',
          url: url.trim(),
          path: path.trim(),
          ...(branch.trim() ? { branch: branch.trim() } : {}),
          recursive,
        })
      }
      onClose={onClose}
    >
      <dt>
        <label htmlFor="submodule-url">Repository URL:</label>
      </dt>
      <dd>
        <input
          id="submodule-url"
          className="reference-input"
          autoFocus
          value={url}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setUrl(event.target.value)}
        />
      </dd>
      <dt>
        <label htmlFor="submodule-path">Path:</label>
      </dt>
      <dd>
        <input
          id="submodule-path"
          className="reference-input"
          value={path}
          placeholder="modules/example"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
        />
        {!validPath && path.length > 0 && (
          <p className="dialog-inline-note">Use a normalized relative path.</p>
        )}
      </dd>
      <dt>
        <label htmlFor="submodule-branch">Branch:</label>
      </dt>
      <dd>
        <input
          id="submodule-branch"
          className="reference-input"
          value={branch}
          placeholder="Optional"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBranch(event.target.value)}
        />
      </dd>
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(event) => setRecursive(event.target.checked)}
          />
          <span>Initialize nested submodules recursively</span>
        </label>
      </dd>
    </DialogShell>
  );
}
