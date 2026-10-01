import { useEffect, useRef, useState } from 'react';
import type { RepositorySummary } from '../../../common/ipc/contracts';
import type { AiPreview, AiSettings, AiTarget, AiProviderId } from '../../../common/ipc/ai';
import {
  aiConfigureSchema,
  aiProviderNames,
  aiProviderSchema,
  defaultAiPrompts,
  aiTargetSchema,
} from '../../../common/ipc/ai';
import { unwrapResult } from '../../../common/ipc/result';
import './ai.css';

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : 'AI is unavailable.';
}

function executionLabel(provider: AiProviderId) {
  return provider === 'ollama'
    ? 'Local server · 127.0.0.1:11434'
    : provider === 'openai'
      ? 'Remote API'
      : 'Installed CLI · Remote model';
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
  const [provider, setProvider] = useState<AiProviderId>('openai');
  const [commitPrompt, setCommitPrompt] = useState(defaultAiPrompts.commit);
  const [reviewPrompt, setReviewPrompt] = useState(defaultAiPrompts.review);
  const [remember, setRemember] = useState(false);
  const [tab, setTab] = useState<'provider' | 'prompts'>('provider');
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
          setProvider(value.provider);
          setCommitPrompt(value.commitPrompt);
          setReviewPrompt(value.reviewPrompt);
          setRemember(value.remember);
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(errorText(reason));
      });
    return () => {
      current = false;
    };
  }, []);
  const request = { model, provider, commitPrompt, reviewPrompt, remember };
  const agent = provider !== 'openai' && provider !== 'ollama';
  const usesKey = provider === 'openai' || provider === 'cursor';
  const sameProvider = provider === settings?.provider;
  const configured = sameProvider && settings.enabled;
  const claimed = useRef(false);
  const update = async (disable: boolean, selectExecutable = false, replaceKey = false) => {
    const api = window.desktop;
    if (!api || claimed.current) return;
    claimed.current = true;
    const current = ++generation.current.value;
    setBusy(true);
    setError('');
    try {
      const value = unwrapResult(
        await (disable ? api.ai.disable() : api.ai.configure({ ...request, selectExecutable, replaceKey })),
      );
      if (current === generation.current.value) setSettings(value);
    } catch (reason) {
      if (current === generation.current.value) setError(errorText(reason));
    } finally {
      claimed.current = false;
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
        <nav className="ai-tabs" aria-label="AI settings pages">
          <button type="button" aria-pressed={tab === 'provider'} onClick={() => setTab('provider')}>
            Provider
          </button>
          <button type="button" aria-pressed={tab === 'prompts'} onClick={() => setTab('prompts')}>
            Default requests
          </button>
        </nav>
        <p>
          {configured ? 'Enabled for this session' : 'Disabled'} · {executionLabel(provider)}
        </p>
        {tab === 'provider' ? (
          <>
            <label className="ai-setting-row">
              AI agent
              <select
                aria-label="AI provider"
                value={provider}
                disabled={busy}
                onChange={(event) => setProvider(aiProviderSchema.parse(event.target.value))}
              >
                {aiProviderSchema.options.map((value) => (
                  <option value={value} key={value}>
                    {aiProviderNames[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <input
                aria-label="AI model"
                value={model}
                placeholder={
                  provider === 'ollama'
                    ? 'Name of an installed local model'
                    : 'Model name available to your account'
                }
                maxLength={128}
                disabled={busy}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            {agent && (
              <div className="ai-executable">
                <span title={sameProvider ? (settings.executable ?? undefined) : undefined}>
                  {sameProvider && settings.executable
                    ? settings.executable
                    : 'Select your installed CLI when enabling.'}
                </span>
                {sameProvider && settings.executable && (
                  <button
                    type="button"
                    className="button button-small"
                    disabled={busy || !aiConfigureSchema.safeParse(request).success}
                    onClick={() => void update(false, true)}
                  >
                    Change executable…
                  </button>
                )}
              </div>
            )}
            <p className="muted">
              {provider === 'ollama'
                ? 'Uses an already installed local model. Start Ollama separately with cloud features disabled. No model is downloaded by this app.'
                : usesKey
                  ? `Select a text file containing your ${aiProviderNames[provider]} API key. The key stays in memory until Disable or quit. An API account with available usage is required.`
                  : `Install ${aiProviderNames[provider]} and sign in through its terminal login first. This app does not read or store the agent’s login credentials.`}
            </p>
            <p className="muted">
              Setup sends no repository content. Each request has a preview and a separate Send action.
            </p>
          </>
        ) : (
          <>
            <label>
              Commit message request
              <textarea
                aria-label="Commit message request"
                rows={4}
                maxLength={3000}
                value={commitPrompt}
                disabled={busy}
                onChange={(event) => setCommitPrompt(event.target.value)}
              />
            </label>
            <label>
              Code review request
              <textarea
                aria-label="Code review request"
                rows={4}
                maxLength={3000}
                value={reviewPrompt}
                disabled={busy}
                onChange={(event) => setReviewPrompt(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setCommitPrompt(defaultAiPrompts.commit);
                setReviewPrompt(defaultAiPrompts.review);
              }}
            >
              Restore default requests
            </button>
            <p className="muted">
              The displayed diff is added automatically. Requests are plain text; do not include credentials.
              The app always adds instructions to treat the diff as data and return text without running
              tools.
            </p>
          </>
        )}
        <label className="ai-check">
          <input
            type="checkbox"
            checked={remember}
            disabled={busy}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember model, executable and requests
        </label>
        <p className="muted">
          Remembered choices are saved in this app’s profile. AI starts disabled after restart; keys and
          results are never saved with these choices.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy || !settings || !aiConfigureSchema.safeParse(request).success}
            onClick={() => void update(false)}
          >
            {configured
              ? 'Save settings'
              : usesKey
                ? 'Select key file and enable…'
                : agent && (!sameProvider || !settings?.executable)
                  ? 'Select executable and enable…'
                  : 'Enable for this session'}
          </button>
          {usesKey && configured && (
            <button
              type="button"
              className="button"
              disabled={busy || !aiConfigureSchema.safeParse(request).success}
              onClick={() => void update(false, false, true)}
            >
              Replace key…
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={!settings?.enabled || busy}
            onClick={() => void update(true)}
          >
            {settings?.provider === 'openai' || settings?.provider === 'cursor'
              ? 'Disable and forget key'
              : 'Disable'}
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
  mode: 'staged' | 'amend' | 'range';
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
  const target: AiTarget = mode !== 'range' ? { kind: mode } : { kind: 'range', base, head, mergeBase };
  const provider = preview?.provider ?? settings?.provider ?? 'openai';
  const providerName = aiProviderNames[provider];
  const claimed = useRef(false);
  const perform = async (send: boolean) => {
    const api = window.desktop;
    if (!api || claimed.current) return;
    claimed.current = true;
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
      claimed.current = false;
      if (current === generation.current.value) setBusy(false);
    }
  };
  return (
    <>
      <dialog
        ref={dialog}
        className="dialog ai-dialog"
        aria-label={mode !== 'range' ? 'Generate Commit Message' : 'AI Code Review'}
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="dialog-content">
          <h2>{mode !== 'range' ? 'Generate Commit Message' : 'AI Code Review'}</h2>
          <p className="ai-scope">
            {repository.name} · {repository.path}
          </p>
          <p>
            {providerName} · {executionLabel(provider)} · {settings?.enabled ? settings.model : 'Disabled'}{' '}
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
                <summary>Instructions sent to {providerName}</summary>
                <pre>{preview.instructions}</pre>
              </details>
              <pre className="ai-material" aria-label="Material to send" tabIndex={0}>
                {preview.material}
              </pre>
              <p className="muted">
                {provider === 'openai'
                  ? 'Response storage is disabled for this request. Provider abuse-monitoring retention may still apply. '
                  : provider === 'ollama'
                    ? 'The request goes to your local Ollama server. Its logging settings apply. '
                    : 'Your installed agent sends the preview to its provider. Provider retention and managed policies apply; CLI session persistence is disabled or isolated in a temporary directory. '}
                Cancel stops the request but cannot recall data already sent. The app keeps this preview and
                review in memory only; using a generated message saves it as your ordinary commit draft.
              </p>
              {!sent && (
                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(event) => setApproved(event.target.checked)}
                  />
                  I reviewed this material and want to send it to {providerName}.
                </label>
              )}
            </>
          )}
          {result && (
            <label>
              {mode !== 'range' ? 'Editable generated message' : 'Review findings (unverified)'}
              <textarea
                aria-label="AI result"
                value={result}
                readOnly={mode === 'range'}
                onChange={(event) => setResult(event.target.value)}
                rows={8}
              />
            </label>
          )}
          {result && mode !== 'range' && !draftAvailable && (
            <p role="alert">
              The commit draft or staged changes changed while this dialog was open. Close and generate again;
              your current draft has been preserved.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">{sent ? `Waiting for ${providerName}…` : 'Preparing local preview…'}</p>}
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
                Send to {providerName}
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
