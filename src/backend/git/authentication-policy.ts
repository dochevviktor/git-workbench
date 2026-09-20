/** Credentials stay between Git, the SSH agent and the user's configured credential/askpass tools. */
export type GitAuthenticationPolicy = 'silent' | 'prompt';

/**
 * Terminal prompting alone does not disable askpass or credential-manager dialogs. Every background
 * operation uses silent mode; explicit user network work may invoke the configured native tools.
 * Custom credential helpers are programs and must respect their own noninteractive configuration.
 */
export function applyAuthenticationPolicy(
  environment: NodeJS.ProcessEnv,
  policy: GitAuthenticationPolicy,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  result.GIT_TERMINAL_PROMPT = '0';
  result.GCM_TRACE_SECRETS = '0';
  result.GIT_TRACE_REDACT = '1';
  if (policy === 'silent') {
    // A nonempty override also masks core.askPass. `false` is supplied by Git's shell environment;
    // an unavailable executable fails closed and terminal prompting is still disabled.
    result.GIT_ASKPASS = 'false';
    result.SSH_ASKPASS = 'false';
    result.SSH_ASKPASS_REQUIRE = 'never';
    result.GCM_INTERACTIVE = 'never';
    result.GCM_GUI_PROMPT = '0';
    result.GIT_CONFIG_COUNT = '1';
    result.GIT_CONFIG_KEY_0 = 'credential.interactive';
    result.GIT_CONFIG_VALUE_0 = 'false';
  } else if (result.SSH_ASKPASS && !result.SSH_ASKPASS_REQUIRE) {
    // The installed helper can be Wayland-native; OpenSSH otherwise insists on DISPLAY being set.
    result.SSH_ASKPASS_REQUIRE = 'force';
  }
  return result;
}
