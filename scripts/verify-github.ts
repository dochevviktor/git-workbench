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
    const activitySignal = AbortSignal.timeout(60000);
    const repository = first.repositories[0];
    const activity: Record<string, string> = {};
    if (repository) {
      for (const kind of ['issues', 'pull-requests'] as const) {
        try {
          await provider.activity(
            token,
            {
              accountId: 'live',
              repositoryId: repository.id,
              kind,
              page: 1,
              state: 'all',
              author: '',
              assignee: '',
              text: '',
            },
            repository.fullName,
            activitySignal,
          );
          activity[kind] = 'passed';
        } catch (error) {
          activity[kind] = error instanceof ExpectedBackendError ? error.code : 'failed';
        }
      }
    }
    try {
      await provider.activity(
        token,
        { accountId: 'live', kind: 'notifications', page: 1, all: false, participating: false },
        undefined,
        activitySignal,
      );
      activity.notifications = 'passed';
    } catch (error) {
      activity.notifications = error instanceof ExpectedBackendError ? error.code : 'failed';
    }
    console.log(
      JSON.stringify({
        identity: 'passed',
        repositoryEnumeration: 'passed',
        pagination: first.nextPage ? 'passed' : 'not-needed',
        credentialsSaved: false,
        activity,
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
