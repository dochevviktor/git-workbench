import type { ReactNode } from 'react';
import type { RepositoryHistoryTracking, RepositorySummary } from '../../../common/ipc/contracts';
import {
  ActivityIcon,
  AppearanceIcon,
  BranchIcon,
  ChevronDownIcon,
  FetchIcon,
  NewBranchIcon,
  OpenInIcon,
  PullIcon,
  PushIcon,
  QuickLaunchIcon,
  StashIcon,
  TerminalIcon,
} from './Icons';
import { MenuButton } from './menu/MenuButton';
import type { MenuEntry } from './menu/menu-model';

interface ToolbarProps {
  readonly repository: RepositorySummary | undefined;
  readonly tracking: RepositoryHistoryTracking | undefined;
  readonly openInItems: readonly MenuEntry[];
  readonly appearanceItems: readonly MenuEntry[];
}

interface ToolbarButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabledReason?: string | undefined;
  readonly menuItems?: readonly MenuEntry[] | undefined;
  readonly onClick?: (() => void) | undefined;
}

function ToolbarButton({ icon, label, disabledReason, menuItems, onClick }: ToolbarButtonProps) {
  const content = (
    <>
      <span className="toolbar-button-icon">
        {icon}
        {menuItems && <ChevronDownIcon className="toolbar-button-chevron" size={9} />}
      </span>
      <span className="toolbar-button-label">{label}</span>
    </>
  );
  if (menuItems) {
    return (
      <MenuButton
        className="toolbar-button has-menu"
        items={menuItems}
        menuLabel={label}
        disabledReason={disabledReason}
        title={label}
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
      title={disabledReason ?? label}
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

const networkPhase = 'P05';

export function Toolbar({ repository, tracking, openInItems, appearanceItems }: ToolbarProps) {
  const noRepository = repository ? undefined : 'Open a repository first.';
  const counts = trackingCounts(tracking);

  return (
    <div className="toolbar" role="toolbar" aria-label="Repository commands">
      <div className="toolbar-group">
        <ToolbarButton
          icon={<QuickLaunchIcon size={18} />}
          label="Quick Launch"
          disabledReason="Quick Launch is not available yet (planned for P12)."
        />
        <ToolbarButton
          icon={<FetchIcon size={18} />}
          label="Fetch"
          disabledReason={noRepository ?? `Fetching is not available yet (planned for ${networkPhase}).`}
        />
        <ToolbarButton
          icon={<PullIcon size={18} />}
          label="Pull"
          disabledReason={noRepository ?? `Pulling is not available yet (planned for ${networkPhase}).`}
        />
        <ToolbarButton
          icon={<PushIcon size={18} />}
          label="Push"
          disabledReason={noRepository ?? `Pushing is not available yet (planned for ${networkPhase}).`}
        />
        <ToolbarButton
          icon={<StashIcon size={18} />}
          label="Stash"
          disabledReason={noRepository ?? 'Stashing is not available yet (planned for P06).'}
          menuItems={[]}
        />
      </div>

      <div className="toolbar-repository" aria-live="polite">
        <button
          type="button"
          className="toolbar-activity"
          aria-disabled="true"
          aria-label="Activity"
          title="The activity log is not available yet (planned for P01)."
        >
          <ActivityIcon size={14} />
        </button>
        {repository ? (
          <div className="toolbar-repository-copy">
            <strong title={repository.path}>{repository.name}</strong>
            <span className="toolbar-repository-branch">
              <BranchIcon size={12} />
              {repository.bare ? 'Bare repository' : headDescription(repository)}
            </span>
          </div>
        ) : (
          <div className="toolbar-repository-copy">
            <strong>Welcome to Git Workbench!</strong>
            <span className="toolbar-repository-branch">Open a repository to start</span>
          </div>
        )}
        <span className="toolbar-repository-tracking" title={tracking?.upstream ?? undefined}>
          {counts}
        </span>
      </div>

      <div className="toolbar-group">
        <ToolbarButton
          icon={<NewBranchIcon size={18} />}
          label="Branch"
          disabledReason={
            noRepository ?? `Creating branches is not available yet (planned for ${networkPhase}).`
          }
          menuItems={[]}
        />
      </div>

      <div className="toolbar-group toolbar-end">
        <ToolbarButton
          icon={<OpenInIcon size={18} />}
          label="Open in"
          disabledReason={noRepository}
          menuItems={openInItems}
        />
        <ToolbarButton
          icon={<TerminalIcon size={18} />}
          label="Console"
          disabledReason={noRepository ?? 'Opening a console is not available yet (planned for P12).'}
        />
        <ToolbarButton icon={<AppearanceIcon size={18} />} label="Appearance" menuItems={appearanceItems} />
      </div>
    </div>
  );
}
