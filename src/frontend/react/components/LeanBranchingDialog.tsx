import { useEffect, useRef, useState } from 'react';
import type { RepositoryLeanAction, RepositoryLeanContext } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';
import type { Platform } from '../lib/platform';
import { BranchIcon } from './Icons';
import { DialogShell } from './DialogShell';

export function LeanBranchingDialog({
  id,
  kind,
  initialBase,
  onBaseChange,
  platform,
  repositoryBusy,
  onClose,
  onChanged,
}: {
  readonly id: string;
  readonly kind: RepositoryLeanAction['kind'];
  readonly initialBase: string | undefined;
  readonly onBaseChange: (base: string) => void;
  readonly platform: Platform;
  readonly repositoryBusy: boolean;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const [base, setBase] = useState<string | undefined>(initialBase);
  const [context, setContext] = useState<RepositoryLeanContext>();
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    setContext(undefined);
    setFailure(undefined);
    void window
      .desktop!.repository.getLean({ id, ...(base ? { base } : {}) })
      .then(unwrapResult)
      .then((value) => {
        if (!disposed) setContext(value);
      })
      .catch((error: unknown) => {
        if (!disposed) setFailure(error instanceof Error ? error.message : 'Could not read branch state.');
      });
    return () => {
      disposed = true;
    };
  }, [id, base, revision]);
  const label = kind === 'start' ? 'Start Branch' : kind === 'sync' ? 'Sync Branch' : 'Finish Branch';
  const blocked = context?.[`${kind}Reason`];
  const submit = async () => {
    if (!context?.base || blocked || busy || repositoryBusy) return;
    onBaseChange(context.base);
    setBusy(true);
    setFailure(undefined);
    try {
      const api = window.desktop!;
      const operation = unwrapResult(
        await api.repository.startLean({
          id,
          kind,
          base: context.base,
          snapshot: context.snapshot,
          ...(kind === 'start' ? { name: name.trim() } : {}),
        }),
      );
      const result = await waitForOperation(api, operation);
      if (!mounted.current) return;
      onChanged();
      if (result.status === 'succeeded') onClose();
      else setFailure(`${result.message} Review Activity or Recovery, then refresh before retrying.`);
    } catch (error) {
      if (mounted.current) setFailure(error instanceof Error ? error.message : 'The operation failed.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <DialogShell
      title={label}
      subtitle="Lean Branching"
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={failure ?? blocked ?? null}
      submitLabel={label}
      submitDisabled={
        !context ||
        Boolean(blocked) ||
        Boolean(failure) ||
        repositoryBusy ||
        (kind === 'start' && !name.trim())
      }
      busy={busy}
      onSubmit={() => {
        void submit();
      }}
      onClose={onClose}
    >
      <dt>Current branch:</dt>
      <dd>{context?.current ?? 'Reading…'}</dd>
      <dt>
        <label htmlFor="lean-base">Base branch:</label>
      </dt>
      <dd>
        <select
          id="lean-base"
          className="reference-input"
          value={context?.base ?? base ?? ''}
          disabled={!context || busy}
          onChange={(event) => {
            setBase(event.target.value);
            onBaseChange(event.target.value);
          }}
        >
          {!context?.base && <option value="">Select a base</option>}
          {context?.branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
      </dd>
      {kind === 'start' && (
        <>
          <dt>
            <label htmlFor="lean-name">New branch:</label>
          </dt>
          <dd>
            <input
              id="lean-name"
              className="reference-input"
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </dd>
        </>
      )}
      <dt>Action:</dt>
      <dd>
        {kind === 'start'
          ? `Create and check out a branch at ${context?.startTarget?.slice(0, 12) ?? 'the newer base or upstream commit'}.`
          : kind === 'sync'
            ? 'Rebase on the current upstream when needed, then on the newer base. Conflicts stop Sync; continue or abort in Recovery, then run Sync again.'
            : `Check out the base and ${context?.commitCount === 1 ? 'fast-forward 1 commit' : `merge ${context?.commitCount ?? 0} commits with a merge commit`}. Keep the topic branch.`}
      </dd>
      <dt>Remote:</dt>
      <dd>
        Uses existing refs. Fetch and push are separate actions.
        {kind === 'sync' && ' Rebase can rewrite published commits; review any later push.'}
      </dd>
      <dt>Review:</dt>
      <dd>
        <button
          type="button"
          className="button"
          disabled={busy || repositoryBusy}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh branch state
        </button>
      </dd>
    </DialogShell>
  );
}
