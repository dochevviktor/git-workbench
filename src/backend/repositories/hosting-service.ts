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
      return null;
  }
  return url.href;
}
