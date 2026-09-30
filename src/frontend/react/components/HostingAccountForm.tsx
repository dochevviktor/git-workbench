import { useRef, useState } from 'react';
import { hostingProviderNames } from '../../../common/ipc/hosting';
import type {
  HostingAccount,
  HostingConnectRequest,
  HostingOAuthRequest,
  HostingProviderId,
} from '../../../common/ipc/hosting';

export function HostingAccountForm({
  account,
  secureStorage,
  oauthAvailable,
  busy,
  onToken,
  onOAuth,
  onCancel,
}: {
  readonly account?: HostingAccount | undefined;
  readonly secureStorage: boolean;
  readonly oauthAvailable: boolean;
  readonly busy: boolean;
  readonly onToken: (request: HostingConnectRequest) => void;
  readonly onOAuth: (request: HostingOAuthRequest) => void;
  readonly onCancel: () => void;
}) {
  const [provider, setProvider] = useState<HostingProviderId>(account?.provider ?? 'github');
  const [authentication, setAuthentication] = useState(account?.authentication ?? 'token');
  const [serverUrl, setServerUrl] = useState(account?.serverUrl ?? '');
  const [username, setUsername] = useState(account?.login ?? '');
  const [remember, setRemember] = useState(account?.storage === 'keyring' && secureStorage);
  // Password bytes stay in this uncontrolled input until submission, never in React/persisted state.
  const tokenInput = useRef<HTMLInputElement>(null);
  const selfHosted = !['github', 'gitlab', 'bitbucket'].includes(provider);
  const oauth = provider === 'github' && authentication === 'oauth';
  const tokenLabel =
    provider === 'gitea' ? 'Access token' : provider === 'gitlab-server' ? 'Token' : 'Personal access token';
  return (
    <form
      className="hosting-login"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const selection = { remember, ...(account ? { accountId: account.id } : {}) };
        if (oauth) {
          if (oauthAvailable) onOAuth({ ...selection, username });
          return;
        }
        const token = tokenInput.current?.value.trim() ?? '';
        if (tokenInput.current) tokenInput.current.value = '';
        onToken({
          ...selection,
          provider,
          ...(selfHosted ? { serverUrl: serverUrl.trim() } : {}),
          ...(provider.startsWith('bitbucket') ? { username: username.trim() } : {}),
          token,
        });
      }}
    >
      <fieldset disabled={busy} className="hosting-login-fields">
        <label htmlFor="hosting-provider">Server Type:</label>
        <select
          id="hosting-provider"
          value={provider}
          disabled={Boolean(account)}
          onChange={(event) => {
            setProvider(event.target.value as HostingProviderId);
            setServerUrl('');
            setAuthentication('token');
            setUsername('');
            if (tokenInput.current) tokenInput.current.value = '';
          }}
        >
          {(Object.entries(hostingProviderNames) as [HostingProviderId, string][]).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {selfHosted && (
          <>
            <label htmlFor="hosting-server">Server URL:</label>
            <input
              id="hosting-server"
              type="url"
              required
              maxLength={500}
              placeholder="https://git.example.com"
              value={serverUrl}
              disabled={Boolean(account)}
              onChange={(event) => {
                setServerUrl(event.target.value);
                if (tokenInput.current) tokenInput.current.value = '';
              }}
            />
          </>
        )}
        {provider === 'github' && (
          <>
            <label htmlFor="hosting-authentication">Authentication Type:</label>
            <select
              id="hosting-authentication"
              value={authentication}
              onChange={(event) => {
                setAuthentication(event.target.value as 'token' | 'oauth');
                if (tokenInput.current) tokenInput.current.value = '';
              }}
            >
              <option value="oauth">OAuth</option>
              <option value="token">Personal access token</option>
            </select>
          </>
        )}
        {provider.startsWith('bitbucket') && (
          <>
            <label htmlFor="hosting-bitbucket-user">
              {provider === 'bitbucket' ? 'Atlassian email:' : 'Username:'}
            </label>
            <input
              id="hosting-bitbucket-user"
              type={provider === 'bitbucket' ? 'email' : 'text'}
              required
              maxLength={254}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                if (tokenInput.current) tokenInput.current.value = '';
              }}
            />
          </>
        )}
        {oauth ? (
          <>
            <label htmlFor="hosting-username">Username:</label>
            <input
              id="hosting-username"
              autoComplete="username"
              maxLength={100}
              placeholder="GitHub username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="hosting-token">{tokenLabel}:</label>
            <input
              ref={tokenInput}
              id="hosting-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              minLength={10}
              maxLength={4096}
            />
          </>
        )}
        <label className="hosting-remember hosting-form-wide">
          <input
            type="checkbox"
            checked={remember}
            disabled={!secureStorage}
            onChange={(event) => setRemember(event.target.checked)}
          />{' '}
          Remember account securely
        </label>
        {!secureStorage && (
          <p className="muted hosting-form-wide">
            Secure storage is unavailable. Use this account for the current session.
          </p>
        )}
        {oauth && (
          <p className="muted hosting-form-wide">
            {oauthAvailable
              ? 'Continue in your browser, enter the displayed code and authorize Git Workbench.'
              : 'GitHub OAuth is not configured for this installation. Choose Personal access token to connect, or configure a Git Workbench OAuth app first.'}
          </p>
        )}
        {!oauth && (
          <p className="muted hosting-form-wide">
            {provider.startsWith('gitlab')
              ? 'Use a personal token with read_user and read_api for browsing, plus read_repository or write_repository for Git.'
              : provider === 'bitbucket'
                ? 'Allow read:user:bitbucket, read:workspace:bitbucket and read:repository:bitbucket on your API token. Git push also needs write:repository:bitbucket. App passwords are no longer supported.'
                : provider === 'bitbucket-server'
                  ? 'Use your username and personal HTTP access token with repository read permission; add write permission for push.'
                  : provider === 'gitea'
                    ? 'Allow user and repository access. Git push also requires write permission.'
                    : 'Allow repository access. Fine-grained tokens need Contents read for fetch and read/write for push. Organization authorization may also be required.'}
          </p>
        )}
        <div className="hosting-actions hosting-form-wide">
          <button type="submit" className="button primary" disabled={oauth && !oauthAvailable}>
            {oauth ? 'Log in with OAuth' : account ? 'Update token' : 'Log in'}
          </button>
          <button type="button" className="button" onClick={onCancel}>
            {account ? 'Cancel update' : 'Cancel'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
