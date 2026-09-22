import { useEffect, useRef, useState } from 'react';
import type { RepositorySummary } from '../../../common/ipc/contracts';
import type { AiPreview, AiSettings, AiTarget } from '../../../common/ipc/ai';
import { aiModelSchema, aiTargetSchema } from '../../../common/ipc/ai';
import { unwrapResult } from '../../../common/ipc/result';
import './ai.css';

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : 'AI is unavailable.';
}

function useAiDialog(onClose: () => void, id?: string) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef({ value: 0 });
  const close = () => {
    generation.current.value++;
    void window.desktop?.ai.cancel(id ? { id } : {});
    onClose();
  };
  useEffect(() => {
    const previous = document.activeElement;
    const counter = generation.current;
    dialog.current?.showModal();
    return () => {
      counter.value++;
      void window.desktop?.ai.cancel(id ? { id } : {});
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [id]);
  return { dialog, generation, close };
}

export function AiSettingsDialog({ onClose }: { onClose(): void }) {
  const { dialog, generation, close } = useAiDialog(onClose);
  const [settings, setSettings] = useState<AiSettings>();
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void window.desktop?.ai
      .getSettings()
      .then(unwrapResult)
      .then((value) => {
        if (current) {
          setSettings(value);
          setModel(value.model ?? '');
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(errorText(reason));
      });
    return () => {
      current = false;
    };
  }, []);
  const update = async (disable: boolean) => {
    const api = window.desktop;
    if (!api) return;
    const current = ++generation.current.value;
    setBusy(true);
    setError('');
    try {
      const value = unwrapResult(await (disable ? api.ai.disable() : api.ai.configure({ model })));
      if (current === generation.current.value) setSettings(value);
    } catch (reason) {
      if (current === generation.current.value) setError(errorText(reason));
    } finally {
      if (current === generation.current.value) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="dialog ai-dialog ai-settings"
      aria-label="AI Integration"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-content">
        <h2>AI Integration</h2>
        <p>OpenAI · Remote API · {settings?.enabled ? 'Enabled for this session' : 'Disabled'}</p>
        <p>
          Generate commit messages and review diffs. Each request shows the exact material before you send it.
          An OpenAI API account and billing are required.
        </p>
        <label>
          Model
          <input
            aria-label="AI model"
            value={model}
            placeholder="Enter a text model ID available to your project"
            maxLength={128}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <p className="muted">
          Select a text file containing your API key. The key stays in application memory until you disable AI
          or quit. Nothing is sent during setup; credentials and model availability are checked on your first
          request.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy || !aiModelSchema.safeParse(model).success}
            onClick={() => void update(false)}
          >
            {settings?.enabled ? 'Replace key / model…' : 'Select key file and enable…'}
          </button>
          <button
            type="button"
            className="button"
            disabled={!settings?.enabled || busy}
            onClick={() => void update(true)}
          >
            Disable and forget key
          </button>
          <button type="button" className="button" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function AiRequestDialog({
  repository,
  mode,
  onClose,
  onUseDraft,
  draftAvailable = true,
}: {
  repository: RepositorySummary;
  mode: 'staged' | 'range';
  onClose(): void;
  onUseDraft?(text: string): void;
  draftAvailable?: boolean;
}) {
  const { dialog, generation, close } = useAiDialog(onClose, repository.id);
  const [settings, setSettings] = useState<AiSettings>();
  const [configuring, setConfiguring] = useState(false);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [mergeBase, setMergeBase] = useState(true);
  const [branches, setBranches] = useState<string[]>([]);
  const [preview, setPreview] = useState<AiPreview>();
  const [result, setResult] = useState('');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    let current = true;
    void window.desktop?.ai
      .getSettings()
      .then(unwrapResult)
      .then((value) => {
        if (current) setSettings(value);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorText(reason));
      });
    return () => {
      current = false;
    };
  }, [configuring]);
  useEffect(() => {
    if (mode !== 'range') return;
    let current = true;
    void window.desktop?.repository
      .getReferenceContext({ id: repository.id })
      .then(unwrapResult)
      .then((value) => {
        if (!current) return;
        setBranches([
          ...value.branches.map((branch) => `refs/heads/${branch.name}`),
          ...value.remoteBranches.map((branch) => `refs/remotes/${branch}`),
        ]);
        setHead(value.head.commit ?? '');
      })
      .catch((reason: unknown) => {
        if (current) setError(errorText(reason));
      });
    return () => {
      current = false;
    };
  }, [mode, repository.id]);
  const target: AiTarget = mode === 'staged' ? { kind: 'staged' } : { kind: 'range', base, head, mergeBase };
  const perform = async (send: boolean) => {
    const api = window.desktop;
    if (!api) return;
    const current = ++generation.current.value;
    setBusy(true);
    setError('');
    setResult('');
    try {
      if (send && preview) {
        setSent(true);
        const value = unwrapResult(await api.ai.send({ id: repository.id, token: preview.token }));
        if (current === generation.current.value) setResult(value.text);
      } else {
        setPreview(undefined);
        setApproved(false);
        setSent(false);
        const value = unwrapResult(await api.ai.preview({ id: repository.id, target }));
        if (current === generation.current.value) setPreview(value);
      }
    } catch (reason) {
      if (current === generation.current.value) setError(errorText(reason));
    } finally {
      if (current === generation.current.value) setBusy(false);
    }
  };
  return (
    <>
      <dialog
        ref={dialog}
        className="dialog ai-dialog"
        aria-label={mode === 'staged' ? 'Generate Commit Message' : 'AI Code Review'}
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="dialog-content">
          <h2>{mode === 'staged' ? 'Generate Commit Message' : 'AI Code Review'}</h2>
          <p className="ai-scope">
            {repository.name} · {repository.path}
          </p>
          <p>
            OpenAI · Remote API · {settings?.enabled ? settings.model : 'Disabled'}{' '}
            <button
              type="button"
              className="button button-small"
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setResult('');
                setConfiguring(true);
              }}
            >
              Configure…
            </button>
          </p>
          {!preview && mode === 'range' && (
            <>
              <datalist id="ai-branches">
                {branches.map((branch) => (
                  <option key={branch} value={branch} />
                ))}
              </datalist>
              <label>
                Base branch or full commit ID
                <input
                  aria-label="Review base"
                  list="ai-branches"
                  value={base}
                  disabled={busy}
                  onChange={(event) => setBase(event.target.value)}
                />
              </label>
              <label>
                Tip branch or full commit ID
                <input
                  aria-label="Review tip"
                  list="ai-branches"
                  value={head}
                  disabled={busy}
                  onChange={(event) => setHead(event.target.value)}
                />
              </label>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={mergeBase}
                  disabled={busy}
                  onChange={(event) => setMergeBase(event.target.checked)}
                />
                Review changes since the common ancestor
              </label>
            </>
          )}
          <p className="muted">
            Only the previewed diff and instructions are sent. Diffs include paths, changed text and three
            context lines; binary contents and submodule changes are omitted. Limit: 128 KiB. Review for
            secrets before sending.
          </p>
          {preview && (
            <>
              <p className="ai-scope">
                {preview.scope} · {preview.byteLength.toLocaleString()} bytes · {preview.model}
              </p>
              <p className="muted">
                This is a fixed snapshot. Later repository changes are not added to this request.
              </p>
              <details>
                <summary>Instructions sent to OpenAI</summary>
                <pre>{preview.instructions}</pre>
              </details>
              <pre className="ai-material" aria-label="Material to send" tabIndex={0}>
                {preview.material}
              </pre>
              <p className="muted">
                Response storage is disabled for this request. Provider abuse-monitoring retention may still
                apply. Cancel stops waiting but cannot recall data already sent. The app keeps this preview
                and review in memory only; using a generated message saves it as your ordinary commit draft.
              </p>
              {!sent && (
                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(event) => setApproved(event.target.checked)}
                  />
                  I reviewed this material and want to send it to OpenAI.
                </label>
              )}
            </>
          )}
          {result && (
            <label>
              {mode === 'staged' ? 'Editable generated message' : 'Review findings (unverified)'}
              <textarea
                aria-label="AI result"
                value={result}
                readOnly={mode === 'range'}
                onChange={(event) => setResult(event.target.value)}
                rows={8}
              />
            </label>
          )}
          {result && mode === 'staged' && !draftAvailable && (
            <p role="alert">
              The commit draft or staged changes changed while this dialog was open. Close and generate again;
              your current draft has been preserved.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">{sent ? 'Waiting for OpenAI…' : 'Preparing local preview…'}</p>}
          <div className="dialog-actions">
            {(!preview || sent) && (
              <button
                type="button"
                className="button"
                disabled={busy || !settings?.enabled || !aiTargetSchema.safeParse(target).success}
                onClick={() => void perform(false)}
              >
                {preview ? 'New preview' : 'Preview material'}
              </button>
            )}
            {preview && !sent && (
              <button
                type="button"
                className="button primary"
                disabled={busy || !approved}
                onClick={() => void perform(true)}
              >
                Send to OpenAI
              </button>
            )}
            {result && onUseDraft && (
              <button
                type="button"
                className="button primary"
                disabled={!draftAvailable || !result.trim()}
                onClick={() => {
                  onUseDraft(result);
                  close();
                }}
              >
                Replace commit draft
              </button>
            )}
            <button type="button" className="button" onClick={close}>
              {busy ? 'Cancel request and close' : 'Close'}
            </button>
          </div>
        </div>
      </dialog>
      {configuring && <AiSettingsDialog onClose={() => setConfiguring(false)} />}
    </>
  );
}
