import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ExternalMergeDraft,
  ExternalTarget,
  ExternalTool,
  ExternalToolDefinition,
} from '../../../common/ipc/external-tools';
import { externalToolDefinitionSchema } from '../../../common/ipc/external-tools';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { ExternalToolsContext as Context } from './external-tools-context';
import type { ToolContext } from './external-tools-context';
import './external-tools.css';

interface Launch {
  repositoryId: string;
  target: ExternalTarget;
  tool: ExternalTool;
  onDraft?: ((draft: ExternalMergeDraft) => void) | undefined;
}
const initial: ExternalToolDefinition = {
  kind: 'diff',
  name: 'Custom Diff Tool',
  executable: '',
  args: ['$REMOTE', '$LOCAL'],
};
const templates: Record<ExternalTool['kind'], string[]> = {
  diff: ['$REMOTE', '$LOCAL'],
  editor: ['$LOCAL'],
  merge: ['$BASE', '$REMOTE', '$LOCAL', '$MERGED'],
  terminal: [],
};
const captions = { diff: 'Diff in', editor: 'Open in', merge: 'Merge in', terminal: 'Open in' };

function Modal({
  title,
  onClose,
  children,
  embedded = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  embedded?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (embedded) return;
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [embedded]);
  if (embedded)
    return (
      <section className="external-tools-panel" aria-label={title}>
        {children}
      </section>
    );
  return (
    <dialog
      ref={ref}
      className="dialog external-tools-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-content">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

function Settings({
  embedded = false,
  tools,
  changed,
  onClose,
  loadError,
}: {
  embedded?: boolean;
  tools: ExternalTool[];
  changed(tools: ExternalTool[]): void;
  onClose(): void;
  loadError: string;
}) {
  const [selected, setSelected] = useState<ExternalTool>();
  const [definition, setDefinition] = useState(initial);
  const [args, setArgs] = useState(JSON.stringify(initial.args));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState(false);
  const select = (tool?: ExternalTool) => {
    setSelected(tool);
    setDefinition(
      tool
        ? {
            kind: tool.kind,
            name: tool.name,
            executable: tool.executable,
            args: tool.args,
            isDefault: tool.isDefault,
          }
        : initial,
    );
    setArgs(JSON.stringify(tool?.args ?? initial.args));
    setError('');
    setRemove(false);
  };
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tool settings could not be changed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      embedded={embedded}
      title="External Tools"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        Application profile · Save applies this tool; leaving this page discards unsaved edits.
      </p>
      {loadError && <p role="alert">{loadError}</p>}
      <div className="external-tools-grid">
        <aside aria-label="Configured tools">
          {(['merge', 'diff', 'editor', 'terminal'] as const).map((kind) => (
            <section key={kind}>
              <h3>
                {kind === 'merge'
                  ? 'External Merge Tools'
                  : kind === 'diff'
                    ? 'External Diff Tools'
                    : kind === 'editor'
                      ? 'Editors'
                      : 'Terminals'}
              </h3>
              {tools
                .filter((tool) => tool.kind === kind)
                .map((tool) => (
                  <button
                    className="button"
                    key={tool.id}
                    aria-pressed={selected?.id === tool.id}
                    disabled={busy}
                    onClick={() => select(tool)}
                  >
                    {tool.name}
                  </button>
                ))}
            </section>
          ))}
          <button className="button" disabled={busy} onClick={() => select()}>
            Add
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              select();
              setDefinition({
                kind: 'terminal',
                name: 'Desktop Terminal',
                executable: '/usr/bin/xdg-terminal-exec',
                args: ['--dir=$REPO'],
              });
              setArgs('["--dir=$REPO"]');
            }}
          >
            Linux terminal preset
          </button>
        </aside>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const parsed = externalToolDefinitionSchema.safeParse({
                ...definition,
                args: JSON.parse(args) as unknown,
              });
              if (!parsed.success)
                throw new Error('Enter a name, an executable path and a JSON array of arguments.');
              const next = unwrapResult(
                await window.desktop!.externalTools.save({
                  ...(selected ? { id: selected.id, revision: selected.revision } : {}),
                  definition: parsed.data,
                }),
              );
              changed(next);
              select(next.find((tool) => tool.id === selected?.id) ?? next.at(-1));
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Tool type
              <select
                value={definition.kind}
                onChange={(event) => {
                  const kind = event.target.value as ExternalTool['kind'];
                  setDefinition({ ...definition, kind });
                  setArgs(JSON.stringify(templates[kind]));
                }}
              >
                {(['diff', 'merge', 'editor', 'terminal'] as const).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={definition.name}
                maxLength={100}
                onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
              />
            </label>
            <label>
              Path
              <input
                value={definition.executable}
                onChange={(event) => setDefinition({ ...definition, executable: event.target.value })}
                placeholder="Absolute executable path"
              />
            </label>
            <button
              className="button"
              type="button"
              onClick={() =>
                void act(async () => {
                  const path = unwrapResult(await window.desktop!.externalTools.pickExecutable());
                  if (path) setDefinition({ ...definition, executable: path });
                })
              }
            >
              Browse…
            </button>
            <label>
              Arguments (JSON array)
              <textarea
                rows={3}
                spellCheck={false}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={definition.isDefault ?? false}
                onChange={(event) => setDefinition({ ...definition, isDefault: event.target.checked })}
              />
              Use as default
            </label>
            <p className="muted">
              Each array entry is one argument. Variables: {templates[definition.kind].join(', ')}
              {definition.kind === 'editor' ? ', $LINE' : ''}
              {' · $REPO is the repository folder.'}
            </p>
            <p className="muted">
              Use the tool’s wait option (for example, Code: ["--wait", "$LOCAL"]). Historical and diff files
              are temporary copies, removed when the process exits. Tools run with your permissions and stop
              after five minutes.
            </p>
            {definition.kind === 'terminal' && (
              <p className="muted">
                The Linux preset uses xdg-terminal-exec when installed. Browse to its installed path if
                needed, or configure your preferred terminal.
              </p>
            )}
            <div className="dialog-actions">
              <button className="button primary" type="submit">
                Save
              </button>
              {selected && (
                <button className="button" type="button" onClick={() => setRemove(true)}>
                  Remove…
                </button>
              )}
            </div>
            {remove && selected && (
              <div role="group" aria-label="Confirm tool removal">
                <p>Remove {selected.name}?</p>
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    void act(async () => {
                      changed(
                        unwrapResult(
                          await window.desktop!.externalTools.remove({
                            id: selected.id,
                            revision: selected.revision,
                          }),
                        ),
                      );
                      select();
                    })
                  }
                >
                  Remove Tool
                </button>
                <button type="button" className="button" onClick={() => setRemove(false)}>
                  Keep Tool
                </button>
              </div>
            )}
          </fieldset>
        </form>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function Run({ launch, onClose }: { launch: Launch; onClose(): void }) {
  const [operation, setOperation] = useState<RepositoryOperation>();
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [line, setLine] = useState('line' in launch.target ? launch.target.line : 1);
  const current = useRef(true);
  const operationId = operation?.id;
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  useEffect(() => {
    if (!operationId) return;
    let alive = true;
    const update = (next: RepositoryOperation) => {
      if (alive && next.id === operationId)
        setOperation((previous) =>
          !previous || (next.revision ?? 0) >= (previous.revision ?? 0) ? next : previous,
        );
    };
    const dispose = window.desktop!.repository.onOperationChanged(update);
    void window.desktop!.repository.listOperations().then((result) => {
      if (result.ok) result.value.forEach(update);
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [operationId]);
  const running = starting || operation?.status === 'running';
  const mustWait = starting || (launch.target.kind === 'conflict' && running);
  return (
    <Modal
      title={launch.tool.name}
      onClose={() => {
        if (!mustWait) onClose();
      }}
    >
      <p>
        {'path' in launch.target ? launch.target.path : 'Repository folder'}
        {'commitId' in launch.target ? ` · ${launch.target.commitId.slice(0, 12)}` : ''}
      </p>
      <p className="muted">
        {launch.target.kind === 'conflict'
          ? 'The tool starts from the working file in a temporary copy. Review Merge Output replaces the editor draft; Resolve writes and stages it. Wait for completion or cancel the tool before closing.'
          : launch.target.kind === 'repository'
            ? 'The terminal starts in the repository folder. Commands you enter can change the repository.'
            : launch.target.kind === 'working' && launch.tool.kind === 'editor'
              ? 'The editor opens the current working file. Changes made there affect your working tree.'
              : 'Temporary revision and diff copies never replace the working file.'}
      </p>
      <p>
        <code>{launch.tool.executable}</code>
      </p>
      <pre>{JSON.stringify(launch.tool.args)}</pre>
      {launch.tool.kind === 'editor' && (
        <label>
          Line
          <input
            type="number"
            min={1}
            max={10000000}
            disabled={!!operation || starting}
            value={line}
            onChange={(event) => setLine(Number(event.target.value))}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {operation && (
        <>
          <p role="status">{operation.message || operation.status}</p>
          <pre className="external-tool-output">{operation.output}</pre>
        </>
      )}
      <div className="dialog-actions">
        {!operation && (
          <button
            className="button primary"
            disabled={starting}
            onClick={() => {
              setStarting(true);
              setError('');
              void window
                .desktop!.externalTools.run({
                  repositoryId: launch.repositoryId,
                  tool: { id: launch.tool.id, revision: launch.tool.revision },
                  target: 'line' in launch.target ? { ...launch.target, line } : launch.target,
                })
                .then(unwrapResult)
                .then((next) => {
                  if (current.current) setOperation(next);
                })
                .catch((reason: unknown) => {
                  if (current.current)
                    setError(reason instanceof Error ? reason.message : 'The tool could not be launched.');
                })
                .finally(() => {
                  if (current.current) setStarting(false);
                });
            }}
          >
            Launch Tool
          </button>
        )}
        {operation?.status === 'running' && (
          <button
            className="button"
            onClick={() => void window.desktop!.repository.cancelOperation({ operationId: operation.id })}
          >
            Cancel Tool
          </button>
        )}
        {operation?.status === 'succeeded' && operation.result?.kind === 'external-merge' && (
          <button
            className="button primary"
            onClick={() => {
              if (operation.result?.kind === 'external-merge') launch.onDraft?.(operation.result.value);
              onClose();
            }}
          >
            Review Merge Output
          </button>
        )}
        <button className="button" disabled={mustWait} onClick={onClose}>
          {launch.target.kind === 'conflict' && operation?.result?.kind === 'external-merge'
            ? 'Discard Merge Output'
            : running
              ? 'Close (continues in Activity)'
              : 'Close'}
        </button>
      </div>
    </Modal>
  );
}

export function ExternalToolsProvider({ children }: { children: ReactNode }) {
  const [tools, setTools] = useState<ExternalTool[]>([]);
  const [settings, setSettings] = useState(false);
  const [launch, setLaunch] = useState<Launch>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => {
      void window.desktop?.externalTools.list().then((result) => {
        if (alive) {
          if (result.ok) {
            setTools(result.value);
            setLoadError('');
          } else setLoadError(result.error.message);
        }
      });
    };
    load();
    const release = window.desktop?.settings.onChanged(load);
    return () => {
      alive = false;
      release?.();
    };
  }, [settings]);
  const context: ToolContext = {
    settingsPanel: (
      <Settings embedded tools={tools} changed={setTools} loadError={loadError} onClose={() => undefined} />
    ),
    settings: () => setSettings(true),
    openDefault: (repositoryId, target, kind) => {
      const tool =
        tools.find((entry) => entry.kind === kind && entry.isDefault) ??
        tools.find((entry) => entry.kind === kind);
      if (tool) setLaunch({ repositoryId, target, tool });
      else setSettings(true);
    },
    items: (repositoryId, target, onDraft, kinds) =>
      tools
        .filter((tool) => !kinds || kinds.includes(tool.kind))
        .filter((tool) =>
          target.kind === 'repository'
            ? tool.kind === 'terminal'
            : target.kind === 'conflict'
              ? tool.kind === 'merge'
              : tool.kind === 'editor' || tool.kind === 'diff',
        )
        .map((tool) => ({
          id: `external-${tool.id}`,
          label: `${captions[tool.kind]} ${tool.name}…`,
          shortcut:
            tool.kind === 'diff' &&
            tool.id ===
              (
                tools.find((entry) => entry.kind === 'diff' && entry.isDefault) ??
                tools.find((entry) => entry.kind === 'diff')
              )?.id
              ? 'Mod+D'
              : undefined,
          run: () => setLaunch({ repositoryId, target, tool, onDraft }),
        })),
  };
  return (
    <Context.Provider value={context}>
      {children}
      {settings && (
        <Settings tools={tools} changed={setTools} loadError={loadError} onClose={() => setSettings(false)} />
      )}
      {launch && <Run launch={launch} onClose={() => setLaunch(undefined)} />}
    </Context.Provider>
  );
}
