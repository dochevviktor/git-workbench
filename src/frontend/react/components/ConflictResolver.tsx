import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepositoryConflictFile, RepositoryConflictState } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { CodePreview } from './CodePreview';
import { useExternalTools } from './external-tools-context';

interface ConflictResolverProps {
  readonly repositoryId: string;
  readonly path: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onResolved: () => void;
}

interface EditableRegion {
  readonly startLine: number;
  readonly endLine: number;
  readonly ours: string;
  readonly theirs: string;
}

function markerRegions(content: string): EditableRegion[] {
  const lines = content.split('\n');
  const regions: EditableRegion[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (!/^<{7}(?: .*)?$/u.test(lines[cursor] ?? '')) {
      cursor += 1;
      continue;
    }
    const startLine = cursor;
    cursor += 1;
    const oursStart = cursor;
    while (
      cursor < lines.length &&
      !/^\|{7}(?: .*)?$/u.test(lines[cursor] ?? '') &&
      lines[cursor] !== '======='
    ) {
      cursor += 1;
    }
    const ours = lines.slice(oursStart, cursor).join('\n');
    if (/^\|{7}(?: .*)?$/u.test(lines[cursor] ?? '')) {
      cursor += 1;
      while (cursor < lines.length && lines[cursor] !== '=======') cursor += 1;
    }
    if (lines[cursor] !== '=======') break;
    cursor += 1;
    const theirsStart = cursor;
    while (cursor < lines.length && !/^>{7}(?: .*)?$/u.test(lines[cursor] ?? '')) cursor += 1;
    if (!/^>{7}(?: .*)?$/u.test(lines[cursor] ?? '')) break;
    regions.push({
      startLine,
      endLine: cursor + 1,
      ours,
      theirs: lines.slice(theirsStart, cursor).join('\n'),
    });
    cursor += 1;
  }
  return regions;
}

function conflictMarkerCount(content: string): number {
  return markerRegions(content).length;
}

function contentText(content: RepositoryConflictFile['base']): string {
  return content.state === 'text' ? content.content : '';
}

function contentMessage(content: RepositoryConflictFile['base']): string | undefined {
  return content.state === 'text' ? undefined : (content.message ?? 'This side is unavailable.');
}

function replaceRegion(content: string, region: EditableRegion, replacement: string): string {
  const lines = content.split('\n');
  return [
    ...lines.slice(0, region.startLine),
    ...replacement.split('\n'),
    ...lines.slice(region.endLine),
  ].join('\n');
}

function displayResolution(
  file: RepositoryConflictFile,
  content: string,
): { resolved: number; total: number } {
  const total = Math.max(file.regions.length, markerRegions(file.result.content).length);
  return { resolved: Math.max(0, total - conflictMarkerCount(content)), total };
}

export function ConflictResolver({ repositoryId, path, busy, onClose, onResolved }: ConflictResolverProps) {
  const externalTools = useExternalTools();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<RepositoryConflictState>();
  const [activePath, setActivePath] = useState(path);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setActivePath(path);
    setLoading(true);
    setError(undefined);
    void window.desktop?.repository
      .getConflicts({ id: repositoryId, path })
      .then((result) => {
        if (!active) return;
        const next = unwrapResult(result);
        setState(next);
        setContent(next.selected?.result.content ?? '');
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'The conflict could not be inspected.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, repositoryId]);

  const file = state?.selected;
  const regions = useMemo(() => markerRegions(content), [content]);
  const resolution = file ? displayResolution(file, content) : { resolved: 0, total: 0 };
  const textCapable = file?.kind === 'text' && file.result.state === 'text';
  const canResolve = Boolean(textCapable && !busy && !saving && !loading && regions.length === 0);

  const close = () => {
    if (!saving) dialogRef.current?.close();
  };

  const chooseWholeSide = (side: 'ours' | 'theirs') => {
    if (!file || file[side].state !== 'text') return;
    setContent(file[side].content);
  };

  const chooseRegion = (region: EditableRegion, side: 'ours' | 'theirs') => {
    setContent((current) => replaceRegion(current, region, side === 'ours' ? region.ours : region.theirs));
  };

  const resolve = async () => {
    const api = window.desktop;
    if (!api || !state || !file || !canResolve) return;
    setSaving(true);
    setError(undefined);
    try {
      const next = unwrapResult(
        await api.repository.resolveConflict({
          id: repositoryId,
          path: file.path,
          snapshot: state.snapshot,
          content,
        }),
      );
      setState(next);
      if (next.conflictedCount === 0) {
        dialogRef.current?.close();
        onResolved();
      } else {
        const nextFile = next.selected;
        if (nextFile) setActivePath(nextFile.path);
        setContent(nextFile?.result.content ?? '');
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The conflict could not be staged.');
    } finally {
      setSaving(false);
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
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && saving) event.preventDefault();
      }}
    >
      <div className="conflict-resolver-content">
        <header className="conflict-resolver-header">
          <div>
            <h2>Resolve conflict</h2>
            <p className="muted">
              {state?.operationLabel ?? 'Inspecting the unfinished Git operation'} · {activePath}
            </p>
          </div>
          <button type="button" className="button button-small" onClick={close} disabled={saving}>
            Cancel
          </button>
        </header>
        {state && file && textCapable && (
          <div className="dialog-actions">
            {externalTools
              .items(
                repositoryId,
                { kind: 'conflict', path: file.path, snapshot: state.snapshot },
                (draft) => {
                  if (draft.path === file.path && draft.snapshot === state.snapshot)
                    setContent(draft.content);
                },
              )
              .map(
                (item) =>
                  item.type !== 'separator' && (
                    <button
                      key={item.id}
                      type="button"
                      className="button"
                      disabled={busy || saving || loading}
                      onClick={item.run}
                    >
                      {item.label}
                    </button>
                  ),
              )}
          </div>
        )}
        {error && (
          <div className="inline-alert" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setError(undefined);
                void window.desktop?.repository
                  .getConflicts({ id: repositoryId, path: activePath })
                  .then((result) => {
                    if (!result.ok) {
                      setError(result.error.message);
                      return;
                    }
                    setState(result.value);
                    setContent(result.value.selected?.result.content ?? '');
                  });
              }}
            >
              Refresh
            </button>
          </div>
        )}
        {loading ? (
          <p className="conflict-resolver-empty">Reading conflict stages…</p>
        ) : !file ? (
          <p className="conflict-resolver-empty">This file is no longer conflicted.</p>
        ) : (
          <>
            <div className="conflict-resolver-status" role="status">
              <strong>
                {resolution.resolved}/{resolution.total} conflict regions resolved
              </strong>
              <span>
                {state?.conflictedCount ?? 0} conflicted file{state?.conflictedCount === 1 ? '' : 's'} remain
                in the index.
              </span>
            </div>
            {file.kind !== 'text' && (
              <div className="conflict-resolver-limitation" role="alert">
                {file.kind === 'binary'
                  ? 'Binary conflict content is shown as metadata only. Resolve it with an external tool, then stage it in Local Changes.'
                  : file.kind === 'submodule'
                    ? 'Submodule conflicts are represented as gitlink stages. Resolve them outside the built-in text helper, then stage the selected commit.'
                    : 'This conflict shape is not a bounded text file. Resolve it with an external tool, then stage it in Local Changes.'}
              </div>
            )}
            <div className="conflict-source-grid">
              <section className="conflict-source" aria-label={state?.oursLabel}>
                <header>
                  <strong>{state?.oursLabel ?? 'Current'}</strong>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={!textCapable || file.ours.state !== 'text' || saving || busy}
                    onClick={() => chooseWholeSide('ours')}
                  >
                    Use current
                  </button>
                </header>
                {contentMessage(file.ours) ? (
                  <p className="conflict-content-message">{contentMessage(file.ours)}</p>
                ) : (
                  <CodePreview content={contentText(file.ours)} testId="conflict-ours" />
                )}
              </section>
              <section className="conflict-source" aria-label={state?.theirsLabel}>
                <header>
                  <strong>{state?.theirsLabel ?? 'Incoming'}</strong>
                  <button
                    type="button"
                    className="button button-small"
                    disabled={!textCapable || file.theirs.state !== 'text' || saving || busy}
                    onClick={() => chooseWholeSide('theirs')}
                  >
                    Use incoming
                  </button>
                </header>
                {contentMessage(file.theirs) ? (
                  <p className="conflict-content-message">{contentMessage(file.theirs)}</p>
                ) : (
                  <CodePreview content={contentText(file.theirs)} testId="conflict-theirs" />
                )}
              </section>
            </div>
            <section className="conflict-result" aria-label="Editable conflict result">
              <header>
                <strong>Result — edit and stage</strong>
                {regions.length > 0 && (
                  <span className="conflict-unresolved">{regions.length} unresolved</span>
                )}
              </header>
              <textarea
                value={content}
                readOnly={!textCapable}
                spellCheck={false}
                aria-label="Editable conflict result"
                data-testid="conflict-result"
                onChange={(event) => setContent(event.target.value)}
              />
            </section>
            {regions.length > 0 && textCapable && (
              <div className="conflict-region-actions" aria-label="Conflict region choices">
                {regions.map((region, index) => (
                  <div className="conflict-region-action" key={`${region.startLine}:${region.endLine}`}>
                    <span>Conflict {index + 1}</span>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={saving || busy}
                      onClick={() => chooseRegion(region, 'ours')}
                    >
                      Use current
                    </button>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={saving || busy}
                      onClick={() => chooseRegion(region, 'theirs')}
                    >
                      Use incoming
                    </button>
                  </div>
                ))}
              </div>
            )}
            <footer className="conflict-resolver-actions">
              <span className="muted">Resolve writes this result to the worktree and stages it.</span>
              <button
                type="button"
                className="button primary"
                disabled={!canResolve}
                onClick={() => void resolve()}
              >
                {saving ? 'Staging…' : 'Resolve and Stage'}
              </button>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
