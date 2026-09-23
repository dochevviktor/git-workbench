import { useEffect, useRef, useState } from 'react';
import type { HostedRepositories, HostingAccounts, HostingCloneTarget } from '../../../common/ipc/hosting';
import { unwrapResult } from '../../../common/ipc/result';
import type { HostingActivityRequest } from '../../../common/ipc/hosting';
import { HostingActivity } from './HostingActivity';

export function HostingAccountsPanel({
  onClone,
}: {
  readonly onClone: (target: HostingCloneTarget) => void;
}) {
  const alive = useRef(true);
  const generation = useRef(0);
  const [accounts, setAccounts] = useState<HostingAccounts>({
    accounts: [],
    secureStorageAvailable: false,
    gitAccountId: null,
  });
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'account' | 'repositories' | 'activity'>('account');
  const [activity, setActivity] = useState<HostingActivityRequest>();
  const [searches] = useState(() => new Map<string, string[]>());
  const [remember, setRemember] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<HostedRepositories>();
  const [filter, setFilter] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'ssh'>('https');
  const account = accounts.accounts.find((item) => item.id === selected);
  const api = () => window.desktop!.hosting;

  useEffect(() => {
    alive.current = true;
    let current = true;
    void window
      .desktop!.hosting.listAccounts()
      .then(unwrapResult)
      .then((result) => {
        if (!current) return;
        setAccounts(result);
        setSelected(result.accounts[0]?.id ?? '');
        setRemember(result.accounts[0]?.storage === 'keyring');
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Could not load accounts.');
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      alive.current = false;
      void window.desktop?.hosting.cancel();
    };
  }, []);

  const run = async (work: (current: () => boolean) => Promise<void>) => {
    const id = ++generation.current;
    const current = () => alive.current && generation.current === id;
    setBusy(true);
    setError('');
    try {
      await work(current);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'The hosting request failed.');
    } finally {
      if (current()) setBusy(false);
    }
  };
  const connect = (replace: boolean) =>
    run(async (current) => {
      const connected = unwrapResult(
        await api().connect({ remember, ...(replace && account ? { accountId: account.id } : {}) }),
      );
      const result = unwrapResult(await api().listAccounts());
      if (!current()) return;
      setAccounts(result);
      if (connected) {
        setSelected(connected.id);
        setPage(undefined);
        setTab('account');
        setUpdating(false);
      }
    });
  const repositories = (number: number) =>
    run(async (current) => {
      if (!account) return;
      setPage(undefined);
      setTab('repositories');
      const result = unwrapResult(await api().listRepositories({ accountId: account.id, page: number }));
      if (current()) {
        setPage(result);
        setTab('repositories');
      }
    });
  const signOut = () =>
    run(async (current) => {
      if (!account) return;
      unwrapResult(await api().disconnect({ accountId: account.id }));
      for (const key of searches.keys()) if (key.startsWith(`${account.id}/`)) searches.delete(key);
      const result = unwrapResult(await api().listAccounts());
      if (current()) {
        setAccounts(result);
        setSelected(result.accounts[0]?.id ?? '');
        setPage(undefined);
        setTab('account');
        setUpdating(false);
        setRemember(result.accounts[0]?.storage === 'keyring');
      }
    });
  const visible =
    page?.repositories.filter((repo) => repo.fullName.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <section className="hosting-panel" aria-label="Accounts">
      <div className="hosting-layout">
        <aside className="hosting-accounts" aria-label="Hosting accounts">
          {accounts.accounts.map((item) => (
            <button
              type="button"
              key={item.id}
              className="hosting-account"
              aria-pressed={selected === item.id}
              disabled={busy}
              onClick={() => {
                setSelected(item.id);
                setTab('account');
                setPage(undefined);
                setError('');
                setFilter('');
                setUpdating(false);
                setRemember(item.storage === 'keyring');
              }}
            >
              <strong>GitHub</strong>
              <span>{item.login}</span>
            </button>
          ))}
          {!accounts.accounts.length && <p className="muted">No connected accounts</p>}
          <button
            type="button"
            className="button hosting-add"
            disabled={busy}
            onClick={() => {
              setSelected('');
              setUpdating(false);
              setRemember(false);
              setTab('account');
              setError('');
            }}
          >
            + Add account
          </button>
        </aside>
        <section className="hosting-detail" aria-busy={busy}>
          <div className="hosting-identity">
            <span className="hosting-avatar" aria-hidden="true">
              {account?.login.slice(0, 1).toUpperCase() ?? '+'}
            </span>
            <div>
              <h3>{account ? account.login : 'Log in to GitHub'}</h3>
              <p className="muted">https://github.com</p>
            </div>
          </div>
          {account && (
            <div className="hosting-tabs">
              <button
                type="button"
                className="button"
                aria-pressed={tab === 'account'}
                disabled={busy}
                onClick={() => setTab('account')}
              >
                Account
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={tab === 'repositories'}
                disabled={busy}
                onClick={() => void repositories(page?.page ?? 1)}
              >
                Repositories
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                aria-pressed={tab === 'activity' && activity?.kind === 'notifications'}
                onClick={() => {
                  setActivity({
                    accountId: account.id,
                    kind: 'notifications',
                    page: 1,
                    all: false,
                    participating: false,
                  });
                  setTab('activity');
                }}
              >
                Notifications
              </button>
            </div>
          )}
          {tab === 'account' && (
            <>
              <dl>
                <dt>Server Type:</dt>
                <dd>GitHub</dd>
                <dt>Authentication Type:</dt>
                <dd>Personal access token</dd>
                {account && (
                  <>
                    <dt>Username:</dt>
                    <dd>{account.login}</dd>
                    <dt>Storage:</dt>
                    <dd>
                      {account.storage === 'keyring'
                        ? 'Saved with OS keyring encryption'
                        : 'This application session only'}
                    </dd>
                    <dt>HTTPS Git:</dt>
                    <dd>
                      {accounts.gitAccountId === account.id ? 'Default account' : 'Available by username'}
                    </dd>
                  </>
                )}
              </dl>
              {(!account || updating) && (
                <div className="hosting-login">
                  <h4>{updating ? 'Update token' : 'Login'}</h4>
                  <p>
                    Copy your personal access token, then log in. This account will be used for GitHub
                    browsing and HTTPS clone, fetch, pull and push.
                  </p>
                  <label className="hosting-remember">
                    <input
                      type="checkbox"
                      checked={remember}
                      disabled={busy || !accounts.secureStorageAvailable}
                      onChange={(event) => setRemember(event.target.checked)}
                    />{' '}
                    Remember account securely
                  </label>
                  {!accounts.secureStorageAvailable && (
                    <p className="muted">
                      Secure storage is unavailable. Accounts can be used for this session.
                    </p>
                  )}
                  <div className="hosting-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() => void connect(Boolean(account))}
                    >
                      {updating ? 'Update token from Clipboard' : 'Log in with Access Token'}
                    </button>
                    {updating && (
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          setUpdating(false);
                          setError('');
                        }}
                      >
                        Cancel update
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          unwrapResult(await api().openTokenSettings());
                        })
                      }
                    >
                      Create token on GitHub…
                    </button>
                  </div>
                  <p className="muted">
                    Private repositories need repository access. For fine-grained tokens, allow Contents read
                    access to fetch and read/write access to push. Organization SSO may require authorization.
                  </p>
                </div>
              )}
              {account && (
                <div className="hosting-actions">
                  {!updating && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        setUpdating(true);
                        setError('');
                      }}
                    >
                      Update token…
                    </button>
                  )}
                  {accounts.gitAccountId !== account.id && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async (current) => {
                          unwrapResult(await api().useForGit({ accountId: account.id }));
                          const result = unwrapResult(await api().listAccounts());
                          if (current()) setAccounts(result);
                        })
                      }
                    >
                      Use as default for Git
                    </button>
                  )}
                  <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              )}
              {account && (
                <p className="muted hosting-account-note">
                  HTTPS operations use your token’s repository permissions. SSH remotes use your SSH keys.
                  Signing out removes this app’s credential; revoke it on GitHub to disable it everywhere.
                </p>
              )}
            </>
          )}
          {tab === 'repositories' && account && (
            <>
              <div className="hosting-actions">
                <input
                  className="reference-input"
                  aria-label="Filter loaded repositories"
                  placeholder="Filter this page"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void repositories(page?.page ?? 1)}
                >
                  Refresh
                </button>
              </div>
              <label>
                Clone protocol{' '}
                <select
                  aria-label="Clone protocol"
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value === 'ssh' ? 'ssh' : 'https')}
                >
                  <option value="https">HTTPS</option>
                  <option value="ssh">SSH</option>
                </select>
              </label>
              <p className="muted">
                {protocol === 'https'
                  ? 'HTTPS uses this account’s token for clone and future Git operations.'
                  : 'SSH uses your configured SSH keys and agent.'}
              </p>
              <ul className="hosting-repositories">
                {visible.map((repo) => (
                  <li key={repo.id}>
                    <strong>{repo.fullName}</strong>
                    <span className="muted">
                      {repo.private ? 'Private' : 'Public'}
                      {repo.archived ? ' · Archived' : ''}
                    </span>
                    <div className="hosting-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async (current) => {
                            const target = unwrapResult(
                              await api().getCloneTarget({
                                accountId: account.id,
                                repositoryId: repo.id,
                                protocol,
                              }),
                            );
                            if (current()) onClone(target);
                          })
                        }
                      >
                        Clone…
                      </button>
                      {(['issues', 'pull-requests'] as const).map((kind) => (
                        <button
                          type="button"
                          className="button"
                          key={kind}
                          onClick={() => {
                            setActivity({
                              accountId: account.id,
                              repositoryId: repo.id,
                              kind,
                              page: 1,
                              state: 'open',
                              author: '',
                              assignee: '',
                              text: '',
                            });
                            setTab('activity');
                          }}
                        >
                          Browse {kind === 'issues' ? 'issues' : 'pull requests'}
                        </button>
                      ))}
                      {(['website', 'pull-requests', 'issues'] as const).map((destination) => (
                        <button
                          type="button"
                          className="link-button"
                          key={destination}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              unwrapResult(
                                await api().openRepository({
                                  accountId: account.id,
                                  repositoryId: repo.id,
                                  destination,
                                }),
                              );
                            })
                          }
                        >
                          {destination === 'website'
                            ? 'Website'
                            : destination === 'pull-requests'
                              ? 'Pull requests'
                              : 'Issues'}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {!busy && !error && !visible.length && (
                <p>
                  {page?.repositories.length
                    ? 'No matches on this page.'
                    : 'No repositories available to this token.'}
                </p>
              )}
              <div className="hosting-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !page || page.page === 1}
                  onClick={() => void repositories(page!.page - 1)}
                >
                  Previous
                </button>
                <span>Page {page?.page ?? 1}</span>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !page?.nextPage}
                  onClick={() => void repositories(page!.nextPage!)}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {busy && (
            <p role="status">
              Contacting GitHub…{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  generation.current++;
                  void api().cancel();
                  setBusy(false);
                  setPage(undefined);
                  setTab('account');
                }}
              >
                Cancel request
              </button>
            </p>
          )}
          {tab === 'activity' && activity && account && (
            <HostingActivity
              key={`${activity.accountId}-${activity.kind}-${activity.kind === 'notifications' ? '' : activity.repositoryId}`}
              initial={activity}
              searches={searches}
              repositoryName={
                activity.kind === 'notifications'
                  ? undefined
                  : page?.repositories.find((repo) => repo.id === activity.repositoryId)?.fullName
              }
            />
          )}
          {error && (
            <p role="alert" className="hosting-error">
              {error}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
