import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  RepositoryCommitContext,
  RepositoryCommitResult,
  RepositorySummary,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { useCommitContext } from '../hooks/use-commit-context';
import { usePersistentState } from '../hooks/use-persistent-state';
import { ChevronDownIcon, RecentMessagesIcon } from './Icons';
import { MenuButton } from './menu/MenuButton';
import { menuSeparator, planned } from './menu/menu-model';
import type { MenuEntry } from './menu/menu-model';

/** Git's conventional subject length; the counter counts down from it like Fork's reminder. */
const subjectLengthGuide = 50;
const recentMessageLabelLength = 72;
const descriptionMinimumHeight = 52;
const descriptionMaximumHeight = 220;

type CommitFailure = Extract<RepositoryCommitResult, { readonly status: 'failed' }>;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
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
    case 'cherry-pick':
      return 'A cherry-pick is in progress. Committing finishes it with the staged result.';
    case 'revert':
      return 'A revert is in progress. Committing finishes it with the staged result.';
    case 'rebase':
      return 'A rebase is in progress. Continue or abort it from Git until rebase support arrives (P07).';
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
  readonly stagedCount: number;
  readonly conflictedCount: number;
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
  busy,
  onCommitted,
}: CommitComposerProps) {
  const [subject, setSubject] = usePersistentState(
    `repository.${repository.id}.commit.subject`,
    '',
    isString,
  );
  const [body, setBody] = usePersistentState(`repository.${repository.id}.commit.body`, '', isString);
  const [amend, setAmend] = usePersistentState(`repository.${repository.id}.commit.amend`, false, isBoolean);
  const [committing, setCommitting] = useState(false);
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
      if (!api || !value || committing) return;
      setCommitting(true);
      setFailure(undefined);
      setError(undefined);
      try {
        const result = unwrapResult(
          await api.repository.commit({
            id: repository.id,
            subject,
            body,
            amend,
            snapshot: value.snapshot,
            skipHooks,
          }),
        );
        if (result.status === 'failed') {
          setFailure(result);
          refreshContext();
          return;
        }
        setSubject('');
        setBody('');
        setAmend(false);
        draftBeforeAmend.current = undefined;
        refreshContext();
        onCommitted();
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : 'The commit could not be completed.');
        refreshContext();
      } finally {
        setCommitting(false);
      }
    },
    [
      amend,
      body,
      committing,
      onCommitted,
      refreshContext,
      repository.id,
      setAmend,
      setBody,
      setSubject,
      subject,
      value,
    ],
  );

  const blockedReason = useMemo(() => {
    if (!value) return context.error ?? 'The commit details are still loading.';
    if (busy) return 'Another working-tree action is in progress.';
    if (value.identity.source === 'missing') {
      return 'Configure user.name and user.email before committing.';
    }
    if (conflictedCount > 0) return 'Resolve the conflicted files before committing.';
    if (!subject.trim() && !body.trim()) return 'Enter a commit message.';
    if (amend) return value.amend ? undefined : (value.amendBlockedReason ?? 'There is no commit to amend.');
    if (stagedCount === 0 && !value.pendingOperation) return 'Stage at least one change to commit.';
    return undefined;
  }, [amend, body, busy, conflictedCount, context.error, stagedCount, subject, value]);

  // Count code points so an emoji or accented character is one character, as a reader would count it.
  const remaining = subjectLengthGuide - [...subject].length;
  const amendAvailable = Boolean(value?.amend);
  const commitLabel = committing
    ? 'Committing…'
    : amend
      ? stagedCount > 0
        ? `Amend ${fileCountLabel(stagedCount)}`
        : 'Amend Commit'
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
      ? 'Commit signing is configured. Signing prompts are not handled yet (planned for P10).'
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
                disabled={committing}
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
            spellCheck
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
          spellCheck
          data-testid="commit-description"
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="composer-actions">
        <label
          className="composer-amend"
          title={amendAvailable ? undefined : (value?.amendBlockedReason ?? undefined)}
        >
          <input
            type="checkbox"
            checked={amend}
            disabled={!amendAvailable || committing}
            data-testid="commit-amend"
            onChange={(event) => toggleAmend(event.target.checked)}
          />
          Amend
        </label>
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
    </form>
  );
}
