import type { ReactNode } from 'react';
import type {
  RepositoryHistoryTracking,
  RepositoryOperation,
  RepositorySummary,
} from '../../../common/ipc/contracts';
import { ActivityPanel } from './ActivityPanel';
import { HostingNotifications } from './HostingNotifications';
import {
  ActivityIcon,
  AppearanceIcon,
  BranchIcon,
  CloseIcon,
  ChevronDownIcon,
  FetchIcon,
  NewBranchIcon,
  OpenInIcon,
  PullIcon,
  PushIcon,
  QuickLaunchIcon,
  RepositoryIcon,
  StashIcon,
  TerminalIcon,
} from './Icons';
import { MenuButton } from './menu/MenuButton';
import type { MenuEntry } from './menu/menu-model';

interface ToolbarProps {
  readonly workspaceName: string;
  readonly workspaceItems: readonly MenuEntry[];
  readonly consoleItems: readonly MenuEntry[];
  readonly onQuickLaunch: () => void;
  readonly quickLaunchShortcut: string;
  readonly repositoryListVisible: boolean;
  readonly onToggleRepositoryList: () => void;
  readonly repository: RepositorySummary | undefined;
  readonly worktreeParentName: string | undefined;
  readonly tracking: RepositoryHistoryTracking | undefined;
  readonly branchItems: readonly MenuEntry[];
  readonly branchDisabledReason: string | undefined;
  readonly branchPrimaryDisabledReason: string | undefined;
  readonly gitFlowItems: readonly MenuEntry[];
  readonly gitFlowDisabledReason: string | undefined;
  readonly gitFlowPrimaryDisabledReason: string | undefined;
  readonly stashItems: readonly MenuEntry[];
  readonly stashDisabledReason: string | undefined;
  readonly openInItems: readonly MenuEntry[];
  readonly appearanceItems: readonly MenuEntry[];
  readonly operations: readonly RepositoryOperation[];
  /** The operation running for the active repository, if any. */
  readonly runningOperation: RepositoryOperation | undefined;
  readonly networkDisabledReason: string | undefined;
  readonly pullDisabledReason: string | undefined;
  readonly activityOpen: boolean;
  readonly onFetch: () => void;
  readonly onPull: () => void;
  readonly onPush: () => void;
  readonly onNewBranch: () => void;
  readonly onGitFlow: () => void;
  readonly onSaveStash: () => void;
  readonly onToggleActivity: () => void;
  readonly onCancelOperation: (operationId: string) => void;
}

interface ToolbarButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabledReason?: string | undefined;
  readonly menuItems?: readonly MenuEntry[] | undefined;
  readonly shortcut?: string | undefined;
  readonly testId?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly primaryDisabledReason?: string | undefined;
}

function ToolbarButton({
  icon,
  label,
  disabledReason,
  menuItems,
  shortcut,
  testId,
  onClick,
  primaryDisabledReason,
}: ToolbarButtonProps) {
  const content = (
    <>
      <span className="toolbar-button-icon">
        {icon}
        {menuItems && !onClick && <ChevronDownIcon className="toolbar-button-chevron" size={9} />}
      </span>
      <span className="toolbar-button-label">{label}</span>
    </>
  );
  if (menuItems && onClick) {
    const primaryReason = disabledReason ?? primaryDisabledReason;
    return (
      <div className="toolbar-split-button" role="group" aria-label={`${label} actions`}>
        <button
          type="button"
          className="toolbar-button toolbar-split-primary"
          aria-label={label}
          aria-disabled={primaryReason !== undefined || undefined}
          title={primaryReason ?? label}
          data-testid={testId}
          onClick={() => {
            if (primaryReason === undefined) onClick();
          }}
        >
          {content}
        </button>
        <MenuButton
          className="toolbar-split-menu"
          items={menuItems}
          menuLabel={label}
          aria-label={`${label} menu`}
          title={`${label} menu`}
          disabledReason={disabledReason}
        >
          <ChevronDownIcon className="toolbar-button-chevron" size={9} />
        </MenuButton>
      </div>
    );
  }
  if (menuItems) {
    return (
      <MenuButton
        className="toolbar-button has-menu"
        items={menuItems}
        menuLabel={label}
        aria-label={label}
        disabledReason={disabledReason}
        title={label}
        data-testid={testId}
      >
        {content}
      </MenuButton>
    );
  }
  const disabled = disabledReason !== undefined;
  return (
    <button
      type="button"
      className="toolbar-button"
      aria-disabled={disabled || undefined}
      title={disabledReason ?? (shortcut ? `${label} (${shortcut})` : label)}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      {content}
    </button>
  );
}

function trackingCounts(tracking: RepositoryHistoryTracking | undefined): string | null {
  if (!tracking?.upstream || tracking.ahead === null || tracking.behind === null) return null;
  const parts = [];
  if (tracking.ahead > 0) parts.push(`${tracking.ahead}↑`);
  if (tracking.behind > 0) parts.push(`${tracking.behind}↓`);
  return parts.join(' ') || null;
}

function headDescription(repository: RepositorySummary): string {
  switch (repository.head.state) {
    case 'branch':
    case 'unborn':
      return repository.head.name ?? 'HEAD';
    case 'detached':
      return 'Detached HEAD';
    case 'unknown':
      return 'HEAD unavailable';
  }
}

function progressText(operation: RepositoryOperation): string {
  if (operation.cancelRequested) return 'Cancelling…';
  if (!operation.progress) return operation.message;
  const percent = operation.progress.percent;
  return percent === null ? operation.progress.phase : `${operation.progress.phase} ${percent}%`;
}

export function Toolbar({
  workspaceName,
  workspaceItems,
  consoleItems,
  onQuickLaunch,
  quickLaunchShortcut,
  repositoryListVisible,
  onToggleRepositoryList,
  repository,
  worktreeParentName,
  tracking,
  branchItems,
  branchDisabledReason,
  branchPrimaryDisabledReason,
  gitFlowItems,
  gitFlowDisabledReason,
  gitFlowPrimaryDisabledReason,
  stashItems,
  stashDisabledReason,
  openInItems,
  appearanceItems,
  operations,
  runningOperation,
  networkDisabledReason,
  pullDisabledReason,
  activityOpen,
  onFetch,
  onPull,
  onPush,
  onNewBranch,
  onGitFlow,
  onSaveStash,
  onToggleActivity,
  onCancelOperation,
}: ToolbarProps) {
  const noRepository = repository ? undefined : 'Open a repository first.';
  const counts = trackingCounts(tracking);
  const busyReason = runningOperation
    ? 'Another network operation is running for this repository.'
    : undefined;
  const networkReason = noRepository ?? networkDisabledReason ?? busyReason;

  return (
    <div className="toolbar" role="toolbar" aria-label="Repository commands">
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-repository-list"
          aria-label="Show repository list"
          aria-pressed={repositoryListVisible}
          title="Show repository list"
          onClick={onToggleRepositoryList}
        >
          <RepositoryIcon size={17} />
        </button>
        <ToolbarButton
          icon={<QuickLaunchIcon size={18} />}
          label="Quick Launch"
          shortcut={quickLaunchShortcut}
          onClick={onQuickLaunch}
        />
        <ToolbarButton
          icon={<FetchIcon size={18} />}
          label="Fetch"
          shortcut="Ctrl+Shift+F"
          testId="toolbar-fetch"
          disabledReason={networkReason}
          onClick={onFetch}
        />
        <ToolbarButton
          icon={<PullIcon size={18} />}
          label="Pull"
          testId="toolbar-pull"
          disabledReason={networkReason ?? pullDisabledReason}
          onClick={onPull}
        />
        <ToolbarButton
          icon={<PushIcon size={18} />}
          label="Push"
          testId="toolbar-push"
          disabledReason={networkReason}
          onClick={onPush}
        />
        <ToolbarButton
          icon={<StashIcon size={18} />}
          label="Stash"
          disabledReason={noRepository ?? stashDisabledReason}
          menuItems={stashItems}
          onClick={onSaveStash}
        />
      </div>

      <div className="toolbar-repository">
        <button
          type="button"
          className={activityOpen ? 'toolbar-activity active' : 'toolbar-activity'}
          aria-label="Activity"
          aria-expanded={activityOpen}
          title="Activity"
          data-testid="toolbar-activity"
          onClick={onToggleActivity}
        >
          <ActivityIcon size={14} className={runningOperation ? 'spinning' : undefined} />
        </button>
        {repository ? (
          <div className="toolbar-repository-copy" aria-live="polite">
            <strong title={repository.path}>
              {worktreeParentName ? `${worktreeParentName}: ` : ''}
              {repository.name}
            </strong>
            {runningOperation ? (
              <span className="toolbar-repository-progress" data-testid="toolbar-progress">
                {progressText(runningOperation)}
              </span>
            ) : (
              <span className="toolbar-repository-branch">
                <BranchIcon size={12} />
                {repository.bare ? 'Bare repository' : headDescription(repository)}
              </span>
            )}
          </div>
        ) : (
          <div className="toolbar-repository-copy">
            <strong>{runningOperation?.title ?? 'Welcome to Git Workbench!'}</strong>
            <span className="toolbar-repository-branch">
              {runningOperation ? progressText(runningOperation) : 'Open a repository to start'}
            </span>
          </div>
        )}
        <span className="toolbar-repository-tracking" title={tracking?.upstream ?? undefined}>
          {counts}
        </span>
        {runningOperation && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Cancel ${runningOperation.title}`}
            title={runningOperation.cancelRequested ? 'Cancellation requested' : 'Cancel operation'}
            disabled={runningOperation.cancelRequested}
            onClick={() => onCancelOperation(runningOperation.id)}
          >
            <CloseIcon size={13} />
          </button>
        )}
        {activityOpen && (
          <ActivityPanel operations={operations} onCancel={onCancelOperation} onClose={onToggleActivity} />
        )}
      </div>

      <div className="toolbar-group">
        <ToolbarButton
          icon={<NewBranchIcon size={18} />}
          label="Branch"
          disabledReason={noRepository ?? branchDisabledReason}
          primaryDisabledReason={branchPrimaryDisabledReason}
          menuItems={branchItems}
          onClick={onNewBranch}
        />
        <ToolbarButton
          icon={<BranchIcon size={18} />}
          label="Git-flow"
          disabledReason={gitFlowDisabledReason}
          primaryDisabledReason={gitFlowPrimaryDisabledReason}
          menuItems={gitFlowItems}
          onClick={onGitFlow}
        />
      </div>

      <div className="toolbar-group toolbar-end">
        <HostingNotifications />
        <ToolbarButton
          icon={<OpenInIcon size={18} />}
          label="Open in"
          disabledReason={noRepository}
          menuItems={openInItems}
        />
        <ToolbarButton
          icon={<TerminalIcon size={18} />}
          label="Console"
          disabledReason={
            noRepository ??
            (consoleItems.length ? undefined : 'Configure a terminal in Preferences → Integration.')
          }
          menuItems={consoleItems}
        />
        <ToolbarButton icon={<AppearanceIcon size={18} />} label="Appearance" menuItems={appearanceItems} />
        <ToolbarButton
          testId="toolbar-workspace"
          icon={<RepositoryIcon size={18} />}
          label={workspaceName}
          menuItems={workspaceItems}
        />
      </div>
    </div>
  );
}
