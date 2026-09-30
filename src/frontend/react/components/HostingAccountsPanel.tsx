import { useEffect, useRef, useState } from 'react';
import type {
  HostedRepositories,
  HostingAccounts,
  HostingCloneTarget,
  HostingConnectRequest,
  HostingOAuthRequest,
  HostingOAuthState,
  HostingAccount,
} from '../../../common/ipc/hosting';
import { hostingProviderNames, hostingActivityProviders } from '../../../common/ipc/hosting';
import { unwrapResult } from '../../../common/ipc/result';
import type { HostingActivityRequest } from '../../../common/ipc/hosting';
import { HostingActivity } from './HostingActivity';
import { HostingAccountForm } from './HostingAccountForm';

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
  const [updating, setUpdating] = useState(false);
  const [adding, setAdding] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [oauth, setOAuth] = useState<HostingOAuthState>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<HostedRepositories>();
  const [filter, setFilter] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'ssh'>('https');
  const account = accounts.accounts.find((item) => item.id === selected);
  const defaultForServer =
    account &&
    accounts.accounts.find(
      (item) => (item.serverUrl ?? 'https://github.com') === (account.serverUrl ?? 'https://github.com'),
    )?.id === account.id;
  const working = busy || Boolean(oauth);
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
        setAdding(!result.accounts.length);
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
  const connected = async (value: HostingAccount | null, current: () => boolean) => {
    const result = unwrapResult(await api().listAccounts());
    if (!current()) return;
    setAccounts(result);
    if (value) {
      setSelected(value.id);
      setPage(undefined);
      setTab('account');
      setUpdating(false);
      setAdding(false);
    }
  };
  const connect = (request: HostingConnectRequest) =>
    run(async (current) => {
      if (!/^[\x21-\x7e]{10,4096}$/u.test(request.token))
        throw new Error('Enter a valid access token without spaces or line breaks.');
      await connected(unwrapResult(await api().connect(request)), current);
    });
  const beginOAuth = (request: HostingOAuthRequest) =>
    run(async (current) => {
      const state = unwrapResult(await api().beginOAuth(request));
      if (current()) setOAuth(state);
    });
  useEffect(() => {
    if (!oauth) return;
    const id = generation.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const current = () => !cancelled && alive.current && generation.current === id;
    const poll = async () => {
      try {
        const result = unwrapResult(await window.desktop!.hosting.pollOAuth());
        if (!current()) return;
        if (result.account) {
          const list = unwrapResult(await window.desktop!.hosting.listAccounts());
          if (!current()) return;
          setAccounts(list);
          setSelected(result.account.id);
          setUpdating(false);
          setAdding(false);
          setPage(undefined);
          setTab('account');
          setOAuth(undefined);
        } else timer = setTimeout(() => void poll(), result.interval * 1000);
      } catch (reason) {
        if (current()) {
          setOAuth(undefined);
          setError(reason instanceof Error ? reason.message : 'GitHub authorization failed.');
        }
      }
    };
    timer = setTimeout(() => void poll(), oauth.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [oauth]);
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
        setRemoving(false);
        setAdding(!result.accounts.length);
      }
    });
  const visible =
    page?.repositories.filter((repo) => repo.fullName.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <section className="hosting-panel" aria-label="Accounts">
      <div className="hosting-layout">
        <aside className="hosting-accounts" aria-label="Hosting accounts">
          <div className="hosting-account-list">
            {accounts.accounts.map((item) => (
              <button
                type="button"
                key={item.id}
                className="hosting-account"
                aria-pressed={selected === item.id}
                disabled={working}
                onClick={() => {
                  setSelected(item.id);
                  setTab('account');
                  setPage(undefined);
                  setError('');
                  setFilter('');
                  setUpdating(false);
                  setAdding(false);
                  setRemoving(false);
                }}
              >
                <strong>{hostingProviderNames[item.provider]}</strong>
                <span>{item.login}</span>
                {item.serverUrl && !['github', 'gitlab'].includes(item.provider) && (
                  <small>{item.serverUrl}</small>
                )}
              </button>
            ))}
            {!accounts.accounts.length && <p className="muted">No connected accounts</p>}
          </div>
          <div className="hosting-account-controls">
            <button
              type="button"
              className="button"
              aria-label="Add account"
              title="Add account"
              disabled={working}
              onClick={() => {
                setSelected('');
                setUpdating(false);
                setAdding(true);
                setRemoving(false);
                setTab('account');
                setError('');
              }}
            >
              +
            </button>
            <button
              type="button"
              className="button"
              aria-label="Remove account"
              title="Remove account"
              disabled={working || !account}
              onClick={() => {
                setRemoving(true);
                setUpdating(false);
                setTab('account');
                setError('');
              }}
            >
              −
            </button>
          </div>
        </aside>
        <section className="hosting-detail" aria-busy={working}>
          <div className="hosting-identity">
            <span className="hosting-avatar" aria-hidden="true">
              {account?.login.slice(0, 1).toUpperCase() ?? '+'}
            </span>
            <div>
              <h3>{account ? account.login : 'Add account'}</h3>
              <p className="muted">
                {account ? (account.serverUrl ?? 'https://github.com') : 'Connect to a Git hosting service'}
              </p>
            </div>
          </div>
          {account && (
            <div className="hosting-tabs">
              <button
                type="button"
                className="button"
                aria-pressed={tab === 'account'}
                disabled={working}
                onClick={() => setTab('account')}
              >
                Account
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={tab === 'repositories'}
                disabled={working}
                onClick={() => void repositories(page?.page ?? 1)}
              >
                Repositories
              </button>
              {hostingActivityProviders.includes(account.provider) && (
                <button
                  type="button"
                  className="button"
                  disabled={working}
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
              )}
            </div>
          )}
          {tab === 'account' && (
            <>
              {account && !updating && (
                <dl>
                  <dt>Server Type:</dt>
                  <dd>{hostingProviderNames[account.provider]}</dd>
                  <dt>Authentication Type:</dt>
                  <dd>{account.authentication === 'oauth' ? 'OAuth' : 'Personal access token'}</dd>
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
                        {defaultForServer ? 'Default account for this server' : 'Available by username'}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {((!account && adding) || updating) && (
                <HostingAccountForm
                  key={account?.id ?? 'new'}
                  account={account}
                  secureStorage={accounts.secureStorageAvailable}
                  oauthAvailable={Boolean(accounts.githubOAuthAvailable)}
                  busy={working}
                  onToken={(request) => void connect(request)}
                  onOAuth={(request) => void beginOAuth(request)}
                  onCancel={() => {
                    setUpdating(false);
                    setAdding(false);
                    setError('');
                    if (!account) setSelected(accounts.accounts[0]?.id ?? '');
                  }}
                />
              )}
              {!account && !adding && <p className="muted">Use + to add an account.</p>}
              {removing && account && (
                <div className="hosting-remove-confirm" role="group" aria-label="Confirm account removal">
                  <p>
                    Remove {account.login} from {hostingProviderNames[account.provider]}? Its saved credential
                    will be removed from Git Workbench.
                  </p>
                  <div className="hosting-actions">
                    <button
                      className="button danger"
                      type="button"
                      disabled={working}
                      onClick={() => void signOut()}
                    >
                      Remove account
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={working}
                      onClick={() => setRemoving(false)}
                    >
                      Cancel removal
                    </button>
                  </div>
                </div>
              )}
              {account && !updating && !removing && (
                <div className="hosting-actions hosting-account-actions">
                  {!updating && (
                    <button
                      type="button"
                      className="button"
                      disabled={working}
                      onClick={() => {
                        setUpdating(true);
                        setError('');
                      }}
                    >
                      {account.authentication === 'oauth' ? 'Reauthorize…' : 'Update token…'}
                    </button>
                  )}
                  {!defaultForServer && (
                    <button
                      type="button"
                      className="button"
                      disabled={working}
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
                  <button type="button" className="button" disabled={working} onClick={() => void signOut()}>
                    Sign out
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={working}
                    onClick={() =>
                      void run(async () => {
                        unwrapResult(await api().manageCredential({ accountId: account.id }));
                      })
                    }
                  >
                    {account.authentication === 'oauth' ? 'Manage authorization…' : 'Manage tokens…'}
                  </button>
                </div>
              )}
              {account && !updating && !removing && hostingActivityProviders.includes(account.provider) && (
                <label className="hosting-notification-preference">
                  <input
                    type="checkbox"
                    checked={Boolean(account.notificationsEnabled)}
                    disabled={working}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      const previous = Boolean(account.notificationsEnabled);
                      setAccounts((value) => ({
                        ...value,
                        accounts: value.accounts.map((item) =>
                          item.id === account.id ? { ...item, notificationsEnabled: enabled } : item,
                        ),
                      }));
                      void run(async (current) => {
                        try {
                          unwrapResult(await api().setNotifications({ accountId: account.id, enabled }));
                          const result = unwrapResult(await api().listAccounts());
                          if (current()) setAccounts(result);
                        } catch (error) {
                          if (current())
                            setAccounts((value) => ({
                              ...value,
                              accounts: value.accounts.map((item) =>
                                item.id === account.id ? { ...item, notificationsEnabled: previous } : item,
                              ),
                            }));
                          throw error;
                        }
                      });
                    }}
                  />{' '}
                  Enable Notifications
                </label>
              )}
              {account && !updating && (
                <p className="muted hosting-account-note">
                  HTTPS operations use your token’s repository permissions. SSH remotes use your SSH keys.
                  Signing out removes this app’s credential; revoke it on your server to disable it
                  everywhere.
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
                  : account.provider === 'bitbucket-server'
                    ? 'SSH uses port 7999. Review the URL in Clone if your server uses another SSH host or port.'
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
                      {hostingActivityProviders.includes(account.provider) &&
                        (['issues', 'pull-requests'] as const).map((kind) => (
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
                      {(
                        [
                          'website',
                          'pull-requests',
                          ...(account.provider === 'bitbucket-server' ? [] : (['issues'] as const)),
                        ] as const
                      ).map((destination) => (
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
          {oauth && (
            <p role="status">
              Enter code <strong className="hosting-device-code">{oauth.userCode}</strong> at
              github.com/login/device in your browser. Waiting for authorization…
            </p>
          )}
          {working && (
            <p role="status">
              {oauth ? 'GitHub OAuth' : 'Contacting server…'}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  generation.current++;
                  void api().cancel();
                  setBusy(false);
                  setOAuth(undefined);
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
