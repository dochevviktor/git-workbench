import { useEffect, useRef, useState } from 'react';
import type {
  CustomCommand,
  CustomContext,
  CustomDefinition,
  CustomPreview,
} from '../../../common/ipc/custom-commands';
import { customDefinitionSchema } from '../../../common/ipc/custom-commands';
import type { RepositoryOperation } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import './custom-commands.css';

const blank = (): CustomDefinition => ({
  name: 'Custom Command',
  target: 'repository',
  action: { kind: 'bash', script: 'git status --short --branch' },
  fields: [],
});
const api = () => window.desktop!.customCommands;
const message = (error: unknown) => (error instanceof Error ? error.message : 'The command request failed.');

function useCommandDialog(embedded = false) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (embedded)
      return () => {
        alive.current = false;
      };
    const focus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [embedded]);
  return { dialog, alive };
}

export function CustomCommandsDialog({
  embedded = false,
  commands,
  onChanged,
  onClose,
}: {
  readonly embedded?: boolean;
  readonly commands: CustomCommand[];
  readonly onChanged: (commands: CustomCommand[]) => void;
  readonly onClose: () => void;
}) {
  const { dialog, alive } = useCommandDialog(embedded);
  const Container = embedded ? 'section' : 'dialog';
  const [selected, setSelected] = useState<CustomCommand>();
  const [draft, setDraft] = useState<CustomDefinition>();
  const [enabled, setEnabled] = useState(false);
  const [argsText, setArgsText] = useState('[]');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true);
    void api()
      .list()
      .then(unwrapResult)
      .then((result) => {
        if (current) onChanged(result);
      })
      .catch((reason: unknown) => {
        if (current) setError(message(reason));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [onChanged]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      if (alive.current) setError(message(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const select = (command?: CustomCommand) => {
    setSelected(command);
    setDraft(
      command
        ? {
            name: command.name,
            target: command.target,
            action: command.action,
            fields: command.fields,
            waitForExit: command.waitForExit,
            showOutput: command.showOutput,
          }
        : blank(),
    );
    setEnabled(command?.enabled ?? false);
    setRemoving(false);
    setError('');
    setArgsText(command?.action.kind === 'process' ? JSON.stringify(command.action.args, null, 2) : '[]');
  };
  const save = () =>
    run(async () => {
      if (!draft) return;
      const definition = customDefinitionSchema.safeParse({
        ...draft,
        action:
          draft.action.kind === 'process'
            ? { ...draft.action, args: JSON.parse(argsText) as unknown }
            : draft.action,
      });
      if (!definition.success)
        throw new Error(
          'Check the name, action, arguments and input fields. Each field needs a label; at most 8 fields and 64 arguments are allowed.',
        );
      const result = unwrapResult(
        await api().save({
          ...(selected ? { id: selected.id, revision: selected.revision } : {}),
          definition: definition.data,
          enabled,
        }),
      );
      if (!alive.current) return;
      onChanged(result);
      setDraft(undefined);
      setSelected(undefined);
    });
  return (
    <Container
      ref={(node) => {
        if (node instanceof HTMLDialogElement) dialog.current = node;
      }}
      className={embedded ? 'custom-commands-panel' : 'dialog custom-commands-dialog'}
      aria-label="Custom Commands"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        {!embedded && <h2>Custom Commands</h2>}
        <div className="custom-command-layout">
          <aside className="custom-command-list" aria-label="Saved commands">
            <div className="custom-command-entries">
              {commands.length === 0 && <p className="muted">No custom commands yet.</p>}
              {commands.map((command) => (
                <button
                  type="button"
                  key={command.id}
                  className={selected?.id === command.id ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => select(command)}
                >
                  <strong>{command.name}</strong>
                  <span>
                    {command.target} · {command.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>
              ))}
            </div>
            <div className="custom-command-tools">
              <button
                type="button"
                className="button"
                disabled={busy || commands.length >= 100}
                onClick={() => select()}
              >
                Add
              </button>
              <button
                type="button"
                className="button"
                disabled={busy || !selected}
                onClick={() => setRemoving(true)}
              >
                Remove
              </button>
            </div>
          </aside>
          {draft ? (
            <div className="custom-command-editor">
              <label>
                Target
                <select
                  aria-label="Target"
                  value={draft.target}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, target: event.target.value as CustomDefinition['target'] })
                  }
                >
                  {['repository', 'commit', 'branch', 'file', 'submodule'].map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input
                  value={draft.name}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                Action
                <select
                  aria-label="Action"
                  value={draft.action.kind}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      action:
                        event.target.value === 'bash'
                          ? { kind: 'bash', script: 'git status --short --branch' }
                          : event.target.value === 'process'
                            ? { kind: 'process', executable: 'git', args: [] }
                            : { kind: 'url', url: 'https://' },
                    })
                  }
                >
                  <option value="bash">Bash Command</option>
                  <option value="process">Start Process</option>
                  <option value="url">Open URL</option>
                </select>
              </label>
              {draft.action.kind === 'bash' && (
                <label>
                  Script
                  <textarea
                    aria-label="Script"
                    rows={7}
                    spellCheck={false}
                    maxLength={16384}
                    value={draft.action.script}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, action: { kind: 'bash', script: event.target.value } })
                    }
                  />
                </label>
              )}
              {draft.action.kind === 'process' && (
                <>
                  <label>
                    Executable
                    <input
                      value={draft.action.executable}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          action: { kind: 'process', executable: event.target.value, args: [] },
                        })
                      }
                    />
                  </label>
                  <label>
                    Arguments (JSON array)
                    <textarea
                      aria-label="Arguments (JSON array)"
                      rows={4}
                      spellCheck={false}
                      value={argsText}
                      disabled={busy}
                      onChange={(event) => setArgsText(event.target.value)}
                    />
                  </label>
                </>
              )}
              {draft.action.kind === 'url' && (
                <label>
                  URL
                  <input
                    value={draft.action.url}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, action: { kind: 'url', url: event.target.value } })
                    }
                  />
                </label>
              )}
              <fieldset disabled={busy}>
                <legend>Input form</legend>
                {draft.fields.map((field, index) => (
                  <div className="custom-field" key={index}>
                    <label>
                      Input {index + 1}
                      <input
                        aria-label={`Input ${index + 1} label`}
                        value={field.label}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.map((value, i) =>
                              i === index ? { ...value, label: event.target.value } : value,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Type
                      <select
                        aria-label={`Input ${index + 1} type`}
                        value={field.kind}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.map((value, i) =>
                              i === index
                                ? { ...value, kind: event.target.value as typeof field.kind }
                                : value,
                            ),
                          })
                        }
                      >
                        <option value="text">Text</option>
                        <option value="branch">Branch</option>
                        <option value="file">File</option>
                      </select>
                    </label>
                    <label>
                      Default
                      <input
                        value={field.initial}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.map((value, i) =>
                              i === index ? { ...value, initial: event.target.value } : value,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="custom-checkbox">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fields: draft.fields.map((value, i) =>
                              i === index ? { ...value, required: event.target.checked } : value,
                            ),
                          })
                        }
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Remove input ${index + 1}`}
                      onClick={() =>
                        setDraft({ ...draft, fields: draft.fields.filter((_value, i) => i !== index) })
                      }
                    >
                      −
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button"
                  disabled={draft.fields.length >= 8}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      fields: [
                        ...draft.fields,
                        {
                          label: `Input ${draft.fields.length + 1}`,
                          kind: 'text',
                          required: true,
                          initial: '',
                        },
                      ],
                    })
                  }
                >
                  Add Input
                </button>
              </fieldset>
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.waitForExit ?? true}
                  onChange={(event) => setDraft({ ...draft, waitForExit: event.target.checked })}
                />
                Wait for Exit
              </label>
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.showOutput !== 'on-error'}
                  onChange={(event) =>
                    setDraft({ ...draft, showOutput: event.target.checked ? 'always' : 'on-error' })
                  }
                />
                Always Show Output
              </label>
              <label className="custom-checkbox">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Enable this command
              </label>
              <p className="muted">
                Commands run with your user permissions. Review imported actions before enabling them. Save
                does not execute.
              </p>
            </div>
          ) : (
            <p className="muted">
              Select a command or add one. Imported commands remain disabled until you review and enable each
              one.
            </p>
          )}
          <aside className="custom-command-help">
            <strong>Available variables</strong>
            <p>
              Process arguments use <code>{'${repo:path}'}</code>, <code>{'${repo:name}'}</code>,{' '}
              <code>{'${git}'}</code> and <code>{'${input:1}'}</code>.
            </p>
            <p>
              Commit / branch: <code>{'${sha}'}</code>, <code>{'${sha:abbr}'}</code>. Branch:{' '}
              <code>{'${branch}'}</code>. File / submodule: <code>{'${file}'}</code>,{' '}
              <code>{'${file:name}'}</code>.
            </p>
            <p>
              Bash uses quoted environment variables: <code>"$GW_REPO_PATH"</code>, <code>"$GW_SHA"</code>,{' '}
              <code>"$GW_BRANCH"</code>, <code>"$GW_FILE"</code>, <code>"$GW_INPUT_1"</code>. Values are never
              inserted as script source.
            </p>
            <p>URL variable values are URL encoded. File commands refer to the working path.</p>
            <p className="muted">
              Background commands continue in Activity with output and cancellation. Processes stop after 5
              minutes or 64 KiB of output.
            </p>
          </aside>
        </div>
        {removing && selected && (
          <div className="custom-remove" role="alert">
            <p>Remove “{selected.name}”? You cannot undo this action.</p>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = unwrapResult(
                    await api().remove({ id: selected.id, revision: selected.revision }),
                  );
                  if (alive.current) {
                    onChanged(result);
                    setDraft(undefined);
                    setSelected(undefined);
                    setRemoving(false);
                  }
                })
              }
            >
              Confirm Remove
            </button>
            <button type="button" className="button" onClick={() => setRemoving(false)}>
              Keep Command
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = unwrapResult(await api().import());
                if (result && alive.current) onChanged(result);
              })
            }
          >
            Import…
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !selected}
            onClick={() =>
              void run(async () => {
                if (selected)
                  unwrapResult(await api().export({ id: selected.id, revision: selected.revision }));
              })
            }
          >
            Export…
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !draft}
            onClick={() => void save()}
          >
            Save
          </button>
          {!embedded && (
            <button type="button" className="button" disabled={busy} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </Container>
  );
}

export function CustomCommandRunDialog({
  command,
  context,
  branches,
  operations,
  onClose,
}: {
  readonly command: CustomCommand;
  readonly context: CustomContext;
  readonly branches: readonly { fullName: string; name: string }[];
  readonly operations: readonly RepositoryOperation[];
  readonly onClose: () => void;
}) {
  const { dialog, alive } = useCommandDialog();
  const [inputs, setInputs] = useState(command.fields.map((field) => field.initial));
  const [preview, setPreview] = useState<CustomPreview>();
  const [started, setStarted] = useState<RepositoryOperation>();
  const operation = operations.find((item) => item.id === started?.id) ?? started;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      if (alive.current) setError(message(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const update = (index: number, value: string) => {
    setInputs((current) => current.map((item, i) => (i === index ? value : item)));
    setPreview(undefined);
  };
  return (
    <dialog
      ref={dialog}
      className="dialog custom-command-run"
      aria-label={command.name}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        <h2>{command.name}</h2>
        <p className="muted">
          {context.target}
          {context.value ? `: ${context.value}` : ''}
        </p>
        {!operation &&
          command.fields.map((field, index) => (
            <label className="custom-run-field" key={index}>
              {field.label}
              {field.required ? ' *' : ''}
              {field.kind === 'branch' ? (
                <select
                  aria-label={field.label}
                  disabled={busy}
                  value={inputs[index]}
                  onChange={(event) => update(index, event.target.value)}
                >
                  <option value="">Choose a branch…</option>
                  {branches.map((branch) => (
                    <option key={branch.fullName} value={branch.fullName}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  disabled={busy}
                  maxLength={4096}
                  value={inputs[index]}
                  onChange={(event) => update(index, event.target.value)}
                />
              )}
              {field.kind === 'file' && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const path = unwrapResult(await api().pickFile());
                      if (path && alive.current) update(index, path);
                    })
                  }
                >
                  Browse…
                </button>
              )}
            </label>
          ))}
        {preview && !operation && (
          <section aria-label="Command preview">
            <p>
              Working directory: <strong>{preview.cwd}</strong>
            </p>
            <pre>
              {preview.action.kind === 'bash'
                ? preview.action.script
                : preview.action.kind === 'process'
                  ? JSON.stringify([preview.action.executable, ...preview.action.args], null, 2)
                  : preview.action.url}
            </pre>
            {preview.action.kind === 'bash' && (
              <pre>
                {Object.entries(preview.variables)
                  .map(
                    ([key, value]) =>
                      `GW_${key.replaceAll(':', '_').toUpperCase()} = ${JSON.stringify(value)}`,
                  )
                  .join('\n')}
              </pre>
            )}
            <p className="muted">
              Run with your user permissions in this repository. Cancellation stops the process; it does not
              undo changes.
            </p>
          </section>
        )}
        {operation && (
          <section aria-label="Command output">
            <p role="status">{operation.message}</p>
            {(preview?.showOutput !== 'on-error' || operation.status === 'failed') && (
              <label>
                Details
                <textarea aria-label="Details" readOnly rows={12} value={operation.output} />
              </label>
            )}
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {!operation && (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (preview) {
                    const result = unwrapResult(await api().run({ token: preview.token }));
                    if (alive.current) setStarted(result);
                    if (alive.current && preview.waitForExit === false) onClose();
                  } else {
                    const result = unwrapResult(
                      await api().preview({ commandId: command.id, context, inputs }),
                    );
                    if (alive.current) setPreview(result);
                  }
                })
              }
            >
              {preview ? 'Run Command' : 'Review Command'}
            </button>
          )}
          {operation?.status === 'running' && (
            <button
              type="button"
              className="button"
              disabled={busy || operation.cancelRequested}
              onClick={() =>
                void run(async () => {
                  const result = unwrapResult(
                    await window.desktop!.repository.cancelOperation({ operationId: operation.id }),
                  );
                  if (result && alive.current) setStarted(result);
                })
              }
            >
              Cancel Command
            </button>
          )}
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {operation?.status === 'running' ? 'Close (keep running)' : 'Close'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
