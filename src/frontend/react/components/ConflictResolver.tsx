import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepositoryConflictFile, RepositoryConflictState } from '../../../common/ipc/contracts';
import { chooseConflictRegion, conflictTextRegions, hasConflictMarkers } from '../../../common/conflict-text';
import { unwrapResult } from '../../../common/ipc/result';
import { CodePreview } from './CodePreview';
import { useExternalTools } from './external-tools-context';
import { BranchIcon, CloseIcon } from './Icons';
import { stageConflictResolution } from '../lib/conflicts';

interface ConflictResolverProps {
  readonly repositoryId: string;
  readonly path: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onResolved: () => void;
}
type Choice = 'ours' | 'theirs' | 'delete' | 'working';

export function ConflictResolver({ repositoryId, path, busy, onClose, onResolved }: ConflictResolverProps) {
  const externalTools = useExternalTools();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<RepositoryConflictState>();
  const [activePath, setActivePath] = useState(path);
  const [content, setContent] = useState('');
  const [choice, setChoice] = useState<Choice>();
  const [regionIndex, setRegionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void window.desktop?.repository
      .getConflicts({ id: repositoryId, path: activePath })
      .then((result) => {
        if (!active) return;
        const next = unwrapResult(result);
        setState(next);
        setContent(next.selected?.result.content ?? '');
        setChoice(undefined);
        setRegionIndex(0);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'The conflict could not be read.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activePath, refresh, repositoryId]);

  const file = state?.selected;
  const regions = useMemo(() => conflictTextRegions(content), [content]);
  const selectedRegion = regions[Math.min(regionIndex, Math.max(0, regions.length - 1))];
  const total = file?.regions.length ?? 0;
  const textCapable = file?.kind === 'text' && file.result.state === 'text';
  const disabled = busy || saving || loading;
  const canResolve = Boolean(file && !disabled && (choice || (textCapable && !hasConflictMarkers(content))));
  const close = () => {
    dialogRef.current?.close();
  };
  const choose = (side: Choice) => {
    setChoice(side);
    if (file && (side === 'ours' || side === 'theirs') && file[side].state === 'text')
      setContent(file[side].content);
  };
  const resolve = async () => {
    if (!state || !file || !canResolve || !window.desktop) return;
    setSaving(true);
    setError(undefined);
    try {
      const common = { id: repositoryId, path: file.path, snapshot: state.snapshot };
      const next = await stageConflictResolution(
        window.desktop,
        choice ? { ...common, choice } : { ...common, content },
      );
      if (!alive.current) return;
      onResolved();
      if (!next.selected) dialogRef.current?.close();
      else {
        setState(next);
        setActivePath(next.selected.path);
        setContent(next.selected.result.content);
        setChoice(undefined);
        setRegionIndex(0);
      }
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'The resolution could not be staged.');
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const navigate = (direction: number) => {
    const next = Math.max(0, Math.min(regions.length - 1, regionIndex + direction));
    setRegionIndex(next);
    const region = regions[next];
    if (region && editorRef.current) {
      editorRef.current.focus();
      editorRef.current.setSelectionRange(region.startOffset, region.endOffset);
      editorRef.current.scrollTop = Math.max(0, region.startLine * 18 - 36);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="dialog conflict-resolver"
      aria-label={`Resolve conflict in ${activePath}`}
      aria-busy={loading || saving}
      data-testid="conflict-resolver"
      onClose={onClose}
    >
      <div className="conflict-resolver-content">
        <header className="conflict-resolver-header">
          <h2>
            Merge <span>{activePath}</span>
          </h2>
          <button type="button" className="pane-icon-button" aria-label="Close resolver" onClick={close}>
            <CloseIcon size={14} />
          </button>
        </header>
        {error && (
          <div className="inline-alert" role="alert">
            <span>{error}</span>
            <button className="button button-small" onClick={() => setRefresh((value) => value + 1)}>
              Refresh
            </button>
          </div>
        )}
        {loading ? (
          <p className="conflict-resolver-empty">Reading conflict stages…</p>
        ) : !file ? (
          <p>No conflicted file remains.</p>
        ) : (
          <>
            <div className="conflict-resolver-status" role="status">
              <span>{state?.operationLabel}</span>
              <strong className={canResolve ? 'conflict-count resolved' : 'conflict-count'}>
                {textCapable
                  ? `${choice ? total : Math.max(0, total - regions.length)}/${total} conflict regions resolved`
                  : choice
                    ? 'Resolution selected'
                    : 'Choose a resolution'}
              </strong>
              <button
                className="button button-small"
                aria-label="Previous conflict"
                disabled={disabled || regionIndex === 0}
                onClick={() => navigate(-1)}
              >
                ‹
              </button>
              <button
                className="button button-small"
                aria-label="Next conflict"
                disabled={disabled || regionIndex >= regions.length - 1}
                onClick={() => navigate(1)}
              >
                ›
              </button>
            </div>
            <div className="conflict-source-grid">
              {(['theirs', 'ours'] as const).map((side) => (
                <section
                  key={side}
                  className={`conflict-source ${side}`}
                  aria-label={side === 'ours' ? state?.oursLabel : state?.theirsLabel}
                >
                  <header>
                    <BranchIcon size={13} />
                    <strong>{side === 'ours' ? state?.oursLabel : state?.theirsLabel}</strong>
                    <button
                      className="button button-small"
                      disabled={disabled}
                      aria-pressed={choice === side}
                      onClick={() => choose(side)}
                    >
                      {side === 'ours' ? 'Use current' : 'Use incoming'}
                    </button>
                  </header>
                  {file[side].state === 'text' ? (
                    <CodePreview
                      content={file[side].content}
                      testId={`conflict-${side}`}
                      highlightedLines={sourceHighlights(file, side)}
                    />
                  ) : (
                    <div className="conflict-content-message">
                      <p>{sideDescription(file, side)}</p>
                      {file.stages[side].objectId && <code>{file.stages[side].objectId}</code>}
                    </div>
                  )}
                </section>
              ))}
            </div>
            {textCapable ? (
              <>
                <section className="conflict-result" aria-label="Editable conflict result">
                  <header>
                    <strong>Result</strong>
                    <span>Editing allowed</span>
                    <button
                      className="link-button"
                      disabled={disabled}
                      onClick={() => {
                        setContent(file.result.content);
                        setChoice(undefined);
                      }}
                    >
                      Reset choices
                    </button>
                  </header>
                  <textarea
                    ref={editorRef}
                    value={content}
                    spellCheck={false}
                    aria-label="Editable conflict result"
                    data-testid="conflict-result"
                    disabled={disabled}
                    onChange={(event) => {
                      const original = file.result.content;
                      setContent(
                        original.includes('\r\n') && !/(?<!\r)\n/u.test(original)
                          ? event.target.value.replace(/\r?\n/gu, '\r\n')
                          : event.target.value,
                      );
                      setChoice(undefined);
                    }}
                  />
                </section>
                {selectedRegion && !choice && (
                  <div className="conflict-region-actions" aria-label="Conflict region choices">
                    <span>
                      Conflict {Math.min(regionIndex + 1, regions.length)} of {regions.length} remaining
                    </span>
                    {(['theirs', 'ours', 'both'] as const).map((side) => (
                      <button
                        key={side}
                        className="button button-small"
                        disabled={disabled}
                        onClick={() => {
                          setContent((current) => chooseConflictRegion(current, selectedRegion, side));
                          setRegionIndex((index) => Math.max(0, index - 1));
                        }}
                      >
                        {side === 'both'
                          ? 'Use both'
                          : side === 'ours'
                            ? 'Use current region'
                            : 'Use incoming region'}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="conflict-resolution-summary">
                <p>
                  {choice === 'ours' || choice === 'theirs'
                    ? `${sideDescription(file, choice)} will be staged.`
                    : choice === 'delete'
                      ? 'This path will be removed from the index.'
                      : choice === 'working'
                        ? 'The current worktree result will be staged.'
                        : 'Select a source version, the working result, or deletion.'}
                </p>
                {file.kind === 'submodule' && (
                  <p className="muted">
                    Selecting a source stages its submodule commit. The checked-out submodule and its local
                    changes stay in place.
                  </p>
                )}
                <button
                  className="button button-small"
                  disabled={
                    disabled ||
                    (file.kind === 'submodule' && !file.workingCommitId) ||
                    (file.kind !== 'submodule' && !['text', 'binary'].includes(file.result.state))
                  }
                  onClick={() => choose('working')}
                  aria-pressed={choice === 'working'}
                >
                  {file.kind === 'submodule'
                    ? `Use checked-out commit ${file.workingCommitId?.slice(0, 7) ?? '(unavailable)'}`
                    : 'Use working file'}
                </button>
                <button
                  className="button button-small"
                  disabled={disabled}
                  onClick={() => choose('delete')}
                  aria-pressed={choice === 'delete'}
                >
                  Delete file
                </button>
              </div>
            )}
            <footer className="conflict-resolver-actions">
              <div className="conflict-external-actions">
                {file.kind === 'binary' &&
                  externalTools
                    .items(
                      repositoryId,
                      { kind: 'working', path: file.path, area: 'unstaged', line: 1 },
                      undefined,
                      ['editor'],
                    )
                    .map(
                      (item) =>
                        item.type !== 'separator' && (
                          <button
                            key={item.id}
                            className="button button-small"
                            disabled={disabled}
                            onClick={item.run}
                          >
                            {item.label}
                          </button>
                        ),
                    )}
                {textCapable &&
                  externalTools
                    .items(
                      repositoryId,
                      { kind: 'conflict', path: file.path, snapshot: state!.snapshot },
                      (draft) => {
                        if (alive.current && draft.path === file.path && draft.snapshot === state?.snapshot) {
                          setContent(draft.content);
                          setChoice(undefined);
                        }
                      },
                    )
                    .map(
                      (item) =>
                        item.type !== 'separator' && (
                          <button
                            key={item.id}
                            className="button button-small"
                            disabled={disabled}
                            onClick={item.run}
                          >
                            {item.label}
                          </button>
                        ),
                    )}
                <button
                  className="button button-small"
                  disabled={disabled}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Refresh file
                </button>
                <button className="button button-small" disabled={disabled} onClick={externalTools.settings}>
                  External tools…
                </button>
                <span className="muted">
                  {state?.conflictedCount} file{state?.conflictedCount === 1 ? '' : 's'} remaining
                </span>
              </div>
              <div className="dialog-actions">
                <button className="button primary" disabled={!canResolve} onClick={() => void resolve()}>
                  {saving ? 'Staging…' : 'Resolve and Stage'}
                </button>
                <button className="button" onClick={close}>
                  {saving ? 'Close' : 'Cancel'}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}

function sideDescription(file: RepositoryConflictFile, side: 'ours' | 'theirs') {
  if (!file.stages[side].objectId) return 'Deleted';
  if (file.stages[side].mode === '160000') return 'Submodule commit';
  if (file.stages[side].mode === '120000') return 'Symbolic link';
  if (file[side].state === 'binary') return `Binary file · ${file[side].byteLength ?? 0} bytes`;
  if (file[side].state === 'too-large') return `Large file · ${file[side].byteLength ?? 0} bytes`;
  return 'Modified file';
}

function sourceHighlights(file: RepositoryConflictFile, side: 'ours' | 'theirs'): number[] {
  const lines: number[] = [];
  let offset = 0;
  let line = 1;
  for (const region of file.regions) {
    const fragment = region[side];
    if (!fragment) continue;
    const found = file[side].content.indexOf(fragment, offset);
    if (found < 0) continue;
    line += file[side].content.slice(offset, found).split('\n').length - 1;
    const count = fragment.split('\n').length - (fragment.endsWith('\n') ? 1 : 0);
    for (let i = 0; i < count && lines.length < 5_000; i += 1) lines.push(line + i);
    line += fragment.split('\n').length - 1;
    offset = found + fragment.length;
  }
  return lines;
}
