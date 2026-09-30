import type { HostingAccount } from '../../common/ipc/hosting';
import { hostedRepositorySchema } from '../../common/ipc/hosting';

/** Only known hosting web destinations are produced; repository URLs never become arbitrary browser URLs. */
export function pullRequestUrl(remoteUrl: string, branch: string): string | null {
  let parsed: URL;
  try {
    const scp = /^(?:[^@/\s]+@)?([^/:\s]+):(.+)$/u.exec(remoteUrl);
    parsed = new URL(!remoteUrl.includes('://') && scp ? `ssh://${scp[1]}/${scp[2]}` : remoteUrl);
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol)) return null;
  const parts = parsed.pathname
    .replace(/\.git$/u, '')
    .split('/')
    .filter(Boolean);
  if (parts.some((part) => /%2f|%5c|%2e/iu.test(part)) || parsed.port || parsed.search || parsed.hash)
    return null;
  let path: string;
  try {
    path = parts.map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  } catch {
    return null;
  }
  let url: URL;
  switch (parsed.hostname.toLowerCase()) {
    case 'github.com':
      if (parts.length !== 2) return null;
      url = new URL(`https://github.com/${path}/compare/${encodeURIComponent(branch)}`);
      url.searchParams.set('expand', '1');
      break;
    case 'gitlab.com':
      if (parts.length < 2) return null;
      url = new URL(`https://gitlab.com/${path}/-/merge_requests/new`);
      url.searchParams.set('merge_request[source_branch]', branch);
      break;
    case 'bitbucket.org':
      if (parts.length !== 2) return null;
      url = new URL(`https://bitbucket.org/${path}/pull-requests/new`);
      url.searchParams.set('source', branch);
      break;
    case 'dev.azure.com':
      if (parts.length !== 4 || parts[2] !== '_git') return null;
      url = new URL(`https://dev.azure.com/${path}/pullrequestcreate`);
      url.searchParams.set('sourceRef', branch);
      break;
    case 'ssh.dev.azure.com':
      if (parts.length !== 4 || parts[0] !== 'v3') return null;
      url = new URL(
        `https://dev.azure.com/${encodeURIComponent(parts[1]!)}/${encodeURIComponent(parts[2]!)}/_git/${encodeURIComponent(parts[3]!)}/pullrequestcreate`,
      );
      url.searchParams.set('sourceRef', branch);
      break;
    default:
      if (
        /^[A-Za-z0-9-]+\.visualstudio\.com$/u.test(parsed.hostname) &&
        parts.length === 3 &&
        parts[1] === '_git'
      ) {
        url = new URL(`https://${parsed.hostname}/${path}/pullrequestcreate`);
        url.searchParams.set('sourceRef', branch);
        break;
      }
      return null;
  }
  return url.href;
}

/** Custom web origins come only from verified account registrations in main. */
export function configuredPullRequestUrl(
  remote: string,
  branch: string,
  accounts: readonly HostingAccount[],
): string | null {
  const publicUrl = pullRequestUrl(remote, branch);
  if (publicUrl) return publicUrl;
  let target: URL;
  try {
    const scp = /^(?:[^@/\s]+@)?([^/:\s]+):(.+)$/u.exec(remote);
    target = new URL(!remote.includes('://') && scp ? `ssh://${scp[1]}/${scp[2]}` : remote);
  } catch {
    return null;
  }
  if (
    !['https:', 'ssh:'].includes(target.protocol) ||
    target.search ||
    target.hash ||
    /%|\\/u.test(target.pathname)
  )
    return null;
  const matches = accounts.filter((account) => {
    if (!account.serverUrl || ['github', 'gitlab', 'bitbucket'].includes(account.provider)) return false;
    const server = new URL(account.serverUrl);
    return target.protocol === 'https:'
      ? target.origin === server.origin &&
          target.pathname.startsWith(`${server.pathname.replace(/\/$/u, '')}/`)
      : target.hostname === server.hostname;
  });
  const distinct = [
    ...new Map(matches.map((account) => [`${account.provider}/${account.serverUrl}`, account])).values(),
  ];
  distinct.sort((a, b) => b.serverUrl!.length - a.serverUrl!.length);
  if (!distinct.length || (target.protocol === 'ssh:' && distinct.length > 1)) return null;
  const account = distinct[0]!;
  const server = new URL(account.serverUrl!);
  const prefix = target.protocol === 'https:' ? server.pathname.replace(/\/$/u, '') : '';
  let repository = target.pathname.slice(prefix.length + 1).replace(/\.git$/u, '');
  if (account.provider === 'bitbucket-server' && target.protocol === 'https:') {
    if (!repository.startsWith('scm/')) return null;
    repository = repository.slice(4);
  }
  if (!hostedRepositorySchema.shape.fullName.safeParse(repository).success) return null;
  const base = account.serverUrl;
  let url: URL;
  if (account.provider.startsWith('gitlab')) {
    url = new URL(`${base}/${repository}/-/merge_requests/new`);
    url.searchParams.set('merge_request[source_branch]', branch);
  } else if (account.provider === 'bitbucket-server') {
    const [project, name, extra] = repository.split('/');
    if (extra) return null;
    url = new URL(`${base}/projects/${project}/repos/${name}/compare/commits`);
    url.searchParams.set('sourceBranch', `refs/heads/${branch}`);
  } else {
    if (repository.split('/').length !== 2) return null;
    url = new URL(`${base}/${repository}/compare/${encodeURIComponent(branch)}`);
    if (account.provider === 'github-enterprise') url.searchParams.set('expand', '1');
  }
  return url.href;
}
