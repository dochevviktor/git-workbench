import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SigningControls } from './SigningControls';
import { AiRequestDialog } from './AiIntegration';
import type { RepositorySigningMode } from '../../../common/ipc/contracts';
import type { KeyboardEvent } from 'react';
import type {
  RepositoryCommitContext,
  RepositoryCommitResult,
  RepositorySummary,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { waitForOperation } from '../lib/operations';
import { useCommitContext } from '../hooks/use-commit-context';
import { isNumberBetween, usePersistentState } from '../hooks/use-persistent-state';
import { ChevronDownIcon, RecentMessagesIcon } from './Icons';
import { MenuButton } from './menu/MenuButton';
import { menuSeparator, planned } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

const recentMessageLabelLength = 72;
const descriptionMinimumHeight = 52;
const descriptionMaximumHeight = 220;

type CommitFailure = Extract<RepositoryCommitResult, { readonly status: 'failed' }>;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function splitMessage(message: string): { readonly subject: string; readonly body: string } {
  const [first, ...rest] = message.replace(/\r\n?/gu, '\n').split('\n');
  return { subject: first ?? '', body: rest.join('\n').replace(/^\n+/u, '') };
}

function fileCountLabel(count: number): string {
  return count === 1 ? '1 File' : `${count} Files`;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function pendingOperationNotice(context: RepositoryCommitContext): string | undefined {
  switch (context.pendingOperation) {
    case 'merge':
      return 'A merge is in progress. Committing records the merge with its recorded parents.';
    case 'squash':
      return 'A squash merge is ready. Committing records the staged result with one parent.';
    case 'cherry-pick':
      return 'A cherry-pick is in progress. Committing finishes it with the staged result.';
    case 'revert':
      return 'A revert is in progress. Committing finishes it with the staged result.';
    case 'rebase':
      return context.rebaseEdit === 'needs-amend'
        ? 'Interactive rebase is paused for Edit. Amend this commit, then continue the rebase.'
        : context.rebaseEdit === 'ready-to-continue'
          ? 'The edited interactive-rebase commit is ready. Continue the rebase when the message is correct.'
          : 'A rebase is in progress. Resolve and stage the files, then Continue or Abort from Recovery.';
    case null:
      return undefined;
  }
}

function amendNotice(context: RepositoryCommitContext): string | undefined {
  const target = context.amend;
  if (!target) return undefined;
  if (target.published === true) {
    const [first, ...rest] = target.publishedRefs;
    const where = first ? ` on ${first}${rest.length > 0 ? ` and ${rest.length} more` : ''}` : '';
    return `This commit is already published${where}. Amending rewrites history other people may have.`;
  }
  if (target.published === null) {
    return 'Whether this commit was already pushed could not be determined within the time limit.';
  }
  if (context.head.state === 'detached') {
    return 'HEAD is detached, so the amended commit will not move any branch.';
  }
  if (target.parentCount > 1) return 'This is a merge commit; amending keeps its existing parents.';
  return undefined;
}

function identityNotice(context: RepositoryCommitContext): string | undefined {
  const { name, email, source } = context.identity;
  if (source === 'configured') return undefined;
  if (source === 'implicit') {
    return `Git will record commits as ${name} <${email}>, guessed from this computer. Set user.name and user.email to choose.`;
  }
  return 'Git has no author identity here. Set user.name and user.email before committing.';
}

interface CommitComposerProps {
  readonly repository: RepositorySummary;
  /** Changes whenever the staged set or HEAD moves, so the composer reloads its guard token. */
  readonly changeToken: string;
  /** How many files the commit would contain; in amend mode this includes the amended commit's own. */
  readonly stagedCount: number;
  readonly conflictedCount: number;
  /** Amend lives in the view, because the Staged pane previews the amended commit while it is on. */
  readonly amend: boolean;
  readonly onAmendChange: (amend: boolean) => void;
  /** A staging action is running; commits wait for it. */
  readonly busy: boolean;
  readonly onCommitted: () => void;
}

/** Fork's composer: subject with a length counter and recent messages, description, Amend, Commit. */
export function CommitComposer({
  repository,
  changeToken,
  stagedCount,
  conflictedCount,
  amend,
  onAmendChange,
  busy,
  onCommitted,
}: CommitComposerProps) {
  const [subjectLengthGuide] = usePersistentState('commit.subjectGuide', 50, isNumberBetween(30, 120));
  const [spellCheck] = usePersistentState(
    'commit.spellCheck',
    true,
    (value): value is boolean => typeof value === 'boolean',
  );
  const [subject, setSubject] = usePersistentState(
    `repository.${repository.id}.commit.subject`,
    '',
    isString,
  );
  const [body, setBody] = usePersistentState(`repository.${repository.id}.commit.body`, '', isString);
  const setAmend = onAmendChange;
  const [committing, setCommitting] = useState(false);
  const [aiDraft, setAiDraft] = useState<{ subject: string; body: string; token: string; id: string }>();
  const [signing, setSigning] = useState<RepositorySigningMode>('inherit');
  const mounted = useRef(true);
  const currentDraft = useRef({ subject, body });
  currentDraft.current = { subject, body };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [failure, setFailure] = useState<CommitFailure>();
  const [error, setError] = useState<string>();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const draftBeforeAmend = useRef<{ readonly subject: string; readonly body: string } | undefined>(undefined);
  const prefilled = useRef<string | undefined>(undefined);

  const context = useCommitContext(repository.id, changeToken);
  const value = context.value;
  const refreshContext = context.refresh;

  const prefillKey = value
    ? `${repository.id}:${value.head.commit ?? 'unborn'}:${value.pendingOperation ?? 'none'}`
    : undefined;

  useEffect(() => {
    if (!value || !prefillKey || prefilled.current === prefillKey) return;
    prefilled.current = prefillKey;
    if (subject.trim() || body.trim()) return;
    const source = value.pendingMessage ?? value.template;
    if (!source) return;
    const message = splitMessage(source);
    setSubject(message.subject);
    setBody(message.body);
  }, [body, prefillKey, setBody, setSubject, subject, value]);

  useEffect(() => {
    if (value?.rebaseEdit === 'needs-amend' && value.amend && !amend) {
      setAmend(true);
      return;
    }
    if (amend && value && !value.amend) setAmend(false);
  }, [amend, setAmend, value]);

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    // Fork grows the message area with its content; keep it bounded so the diff stays visible.
    element.style.height = 'auto';
    element.style.height = `${Math.min(descriptionMaximumHeight, Math.max(descriptionMinimumHeight, element.scrollHeight))}px`;
  }, [body]);

  const toggleAmend = useCallback(
    (next: boolean) => {
      const target = value?.amend;
      if (next && target) {
        draftBeforeAmend.current = { subject, body };
        if (!subject.trim() && !body.trim()) {
          setSubject(target.subject);
          setBody(target.body);
        }
      } else if (!next) {
        const previous = draftBeforeAmend.current;
        if (previous && target && subject === target.subject && body === target.body) {
          setSubject(previous.subject);
          setBody(previous.body);
        }
        draftBeforeAmend.current = undefined;
      }
      setAmend(next);
    },
    [body, setAmend, setBody, setSubject, subject, value?.amend],
  );

  const commit = useCallback(
    async (skipHooks: boolean) => {
      const api = window.desktop;
      if (!api || !value || context.loading || committing) return;
      setCommitting(true);
      setFailure(undefined);
      setError(undefined);
      try {
        if (value.pendingOperation === 'rebase' && value.rebaseEdit === 'ready-to-continue' && !amend) {
          const recovery = unwrapResult(await api.repository.getRecovery({ id: repository.id }));
          const operation = await waitForOperation(
            api,
            unwrapResult(
              await api.repository.recover({
                id: repository.id,
                action: 'continue',
                snapshot: recovery.snapshot,
              }),
            ),
          );
          if (operation.status !== 'succeeded') throw new Error(operation.message);
          refreshContext();
          onCommitted();
          return;
        }
        const accepted = unwrapResult(
          await api.repository.commit({
            id: repository.id,
            subject,
            body,
            amend,
            snapshot: value.snapshot,
            skipHooks,
            signing,
          }),
        );
        const operation = await waitForOperation(api, accepted);
        if (!mounted.current) return;
        if (operation.result?.kind !== 'commit') throw new Error(operation.message);
        const result = operation.result.value;
        if (result.status === 'failed') {
          setFailure(result);
          refreshContext();
          return;
        }
        if (currentDraft.current.subject === subject && currentDraft.current.body === body) {
          setSubject('');
          setBody('');
        }
        setAmend(false);
        draftBeforeAmend.current = undefined;
        refreshContext();
        onCommitted();
      } catch (reason: unknown) {
        if (!mounted.current) return;
        setError(reason instanceof Error ? reason.message : 'The commit could not be completed.');
        refreshContext();
      } finally {
        if (mounted.current) setCommitting(false);
      }
    },
    [
      amend,
      body,
      committing,
      context.loading,
      onCommitted,
      refreshContext,
      repository.id,
      setAmend,
      setBody,
      setSubject,
      subject,
      value,
      signing,
    ],
  );

  const blockedReason = useMemo(() => {
    if (context.loading) return 'The commit details are still loading.';
    if (!value) return context.error ?? 'The commit details are still loading.';
    if (busy) return 'Another working-tree action is in progress.';
    if (value.identity.source === 'missing') {
      return 'Configure user.name and user.email before committing.';
    }
    if (conflictedCount > 0) return 'Resolve the conflicted files before committing.';
    if (value.pendingOperation === 'rebase' && value.rebaseEdit === 'ready-to-continue' && !amend)
      return undefined;
    if (!subject.trim()) return 'Enter a commit subject.';
    if (value.pendingOperation === 'rebase' && value.rebaseEdit !== 'needs-amend')
      return 'Continue the rebase from Recovery after staging the resolution.';
    if (amend) return value.amend ? undefined : (value.amendBlockedReason ?? 'There is no commit to amend.');
    if (stagedCount === 0 && !value.pendingOperation) return 'Stage at least one change to commit.';
    return undefined;
  }, [amend, busy, conflictedCount, context.error, context.loading, stagedCount, subject, value]);

  // Count code points so an emoji or accented character is one character, as a reader would count it.
  const remaining = subjectLengthGuide - [...subject].length;
  const amendAvailable = Boolean(value?.amend);
  const commitLabel = committing
    ? 'Committing…'
    : value?.pendingOperation === 'rebase' && value.rebaseEdit === 'ready-to-continue' && !amend
      ? 'Continue Rebase'
      : amend
        ? 'Amend Last Commit'
        : stagedCount > 0
          ? `Commit ${fileCountLabel(stagedCount)}`
          : 'Commit';

  const recentItems = useMemo<MenuEntry[]>(() => {
    const messages = value?.recentMessages ?? [];
    if (messages.length === 0) {
      return [
        {
          id: 'no-recent',
          label: 'No recent commit messages',
          disabled: true,
          disabledReason: 'This repository has no commits to reuse a message from.',
        },
      ];
    }
    return messages.map((message, index) => ({
      id: `recent-${index}`,
      label: truncate(message.subject, recentMessageLabelLength),
      run: () => {
        setSubject(message.subject);
        setBody(message.body);
      },
    }));
  }, [setBody, setSubject, value?.recentMessages]);

  const commitOptions = useMemo<MenuEntry[]>(
    () => [
      {
        id: 'commit-skip-hooks',
        label: 'Commit Without Hooks',
        disabled: Boolean(blockedReason) || (value?.hooks.length ?? 0) === 0,
        disabledReason:
          blockedReason ??
          ((value?.hooks.length ?? 0) === 0 ? 'This repository has no commit hooks.' : undefined),
        run: () => void commit(true),
      },
      menuSeparator,
      { id: 'commit-and-push', label: 'Commit and Push…', ...planned('Pushing', 'P05') },
    ],
    [blockedReason, commit, value?.hooks.length],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || blockedReason) return;
    event.preventDefault();
    void commit(false);
  };

  const notices = [
    value ? identityNotice(value) : undefined,
    value ? pendingOperationNotice(value) : undefined,
    amend && value ? amendNotice(value) : undefined,
    value?.signing
      ? 'Git signs commits by default. Passphrase prompts are handled by the native signing agent.'
      : undefined,
  ].filter((notice): notice is string => notice !== undefined);

  return (
    <form
      className="commit-composer"
      aria-label="Commit"
      data-testid="commit-composer"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {(error ?? context.error) && (
        <div className="inline-alert" role="alert">
          <span>{error ?? context.error}</span>
          <button type="button" className="button button-small" onClick={() => refreshContext()}>
            Refresh
          </button>
        </div>
      )}
      {failure && (
        <div className="commit-alert" role="alert" data-testid="commit-failure">
          <p className="commit-alert-message">{failure.message}</p>
          {failure.output && <pre className="commit-output">{failure.output}</pre>}
          <div className="commit-alert-actions">
            {failure.canSkipHooks && (
              <button
                type="button"
                className="button button-small"
                disabled={committing || context.loading || !value}
                onClick={() => void commit(true)}
              >
                Commit Without Hooks
              </button>
            )}
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setFailure(undefined);
                refreshContext();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {notices.map((notice) => (
        <p className="commit-notice" key={notice} role="status">
          {notice}
        </p>
      ))}
      <div className="composer-message">
        <div className="composer-subject">
          <input
            type="text"
            value={subject}
            placeholder="Commit subject"
            aria-label="Commit subject"
            spellCheck={spellCheck}
            data-testid="commit-subject"
            onChange={(event) => setSubject(event.target.value)}
          />
          <span
            className={`composer-counter${remaining < 0 ? ' over' : ''}`}
            aria-label={
              remaining < 0
                ? `${-remaining} characters over the ${subjectLengthGuide}-character subject guide`
                : `${remaining} characters left in the ${subjectLengthGuide}-character subject guide`
            }
          >
            {remaining}
          </span>
          <MenuButton
            className="pane-icon-button"
            aria-label="Recent commit messages"
            title="Recent commit messages"
            menuLabel="Recent commit messages"
            items={recentItems}
          >
            <RecentMessagesIcon size={14} />
          </MenuButton>
        </div>
        <textarea
          ref={descriptionRef}
          value={body}
          placeholder="Description"
          aria-label="Commit description"
          spellCheck={spellCheck}
          data-testid="commit-description"
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="composer-actions">
        <button
          type="button"
          className="button button-small"
          disabled={busy || committing || amend || stagedCount === 0 || conflictedCount > 0}
          title={
            amend
              ? 'AI generation currently uses staged changes for a new commit.'
              : 'Preview staged changes to generate an editable message'
          }
          onClick={() => setAiDraft({ subject, body, token: changeToken, id: repository.id })}
        >
          Generate Message…
        </button>
        <label
          className="composer-amend"
          title={amendAvailable ? undefined : (value?.amendBlockedReason ?? undefined)}
        >
          <input
            type="checkbox"
            checked={amend}
            disabled={!amendAvailable || committing || context.loading}
            data-testid="commit-amend"
            onChange={(event) => toggleAmend(event.target.checked)}
          />
          Amend
        </label>
        <SigningControls
          repositoryId={repository.id}
          value={signing}
          onChange={setSigning}
          disabled={committing}
        />
        <div className="composer-commit">
          <button
            type="button"
            className="button composer-commit-button"
            disabled={Boolean(blockedReason) || committing}
            title={blockedReason}
            data-testid="commit-submit"
            onClick={() => void commit(false)}
          >
            {commitLabel}
          </button>
          <MenuButton
            className="button composer-commit-menu"
            aria-label="Commit options"
            title="Commit options"
            menuLabel="Commit options"
            items={commitOptions}
          >
            <ChevronDownIcon size={12} />
          </MenuButton>
        </div>
      </div>
      {aiDraft && aiDraft.id === repository.id && (
        <AiRequestDialog
          repository={repository}
          mode="staged"
          onClose={() => setAiDraft(undefined)}
          draftAvailable={
            aiDraft.subject === subject &&
            aiDraft.body === body &&
            aiDraft.token === changeToken &&
            !amend &&
            !committing
          }
          onUseDraft={(text) => {
            const next = splitMessage(text);
            setSubject(next.subject);
            setBody(next.body);
          }}
        />
      )}
    </form>
  );
}
