/** Opt-in, read-only check. Never saves credentials, account identity, repository names or raw errors. */
import { GitHubProvider } from '../src/backend/hosting/github-provider';
import { readTokenFile } from '../src/backend/hosting/hosting-service';
import { ExpectedBackendError } from '../src/backend/errors';

if (!process.argv.includes('--live')) {
  console.error('Pass --live to authorize the GitHub identity and repository-list reads.');
  process.exitCode = 1;
} else {
  try {
    const token = await readTokenFile('.idea/.githubtoken');
    const provider = new GitHubProvider();
    const signal = AbortSignal.timeout(30000);
    await provider.identity(token, signal);
    const first = await provider.repositories(token, 1, signal);
    if (first.nextPage) await provider.repositories(token, first.nextPage, signal);
    console.log(
      JSON.stringify({
        identity: 'passed',
        repositoryEnumeration: 'passed',
        pagination: first.nextPage ? 'passed' : 'not-needed',
        credentialsSaved: false,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof ExpectedBackendError
        ? `${error.code}: ${error.message}`
        : 'Live GitHub validation failed; details suppressed.',
    );
    process.exitCode = 1;
  }
}
