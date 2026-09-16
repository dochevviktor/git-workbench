import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RepositoryHistoryTracking, RepositorySummary } from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
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
} from './Icons';
import { MenuPopup } from './menu/MenuPopup';
import type { MenuAnchor, MenuCommand, MenuEntry } from './menu/menu-model';

interface ToolbarProps {
  readonly platform: Platform;
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
  readonly platform: Platform;
  readonly onClick?: (() => void) | undefined;
}

function ToolbarButton({ icon, label, disabledReason, menuItems, platform, onClick }: ToolbarButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [keyboard, setKeyboard] = useState(false);
  const disabled = disabledReason !== undefined;

  const close = useCallback(() => {
    setAnchor(undefined);
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);
  const activate = useCallback(
    (command: MenuCommand) => {
      close();
      command.run?.();
    },
    [close],
  );
  const isOutsideIgnored = useCallback((target: Element) => buttonRef.current?.contains(target) ?? false, []);

  const open = (fromKeyboard: boolean) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setKeyboard(fromKeyboard);
    setAnchor({ type: 'below', rect });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={menuItems ? 'toolbar-button has-menu' : 'toolbar-button'}
        aria-disabled={disabled || undefined}
        aria-haspopup={menuItems ? 'menu' : undefined}
        aria-expanded={menuItems ? anchor !== undefined : undefined}
        title={disabledReason ?? label}
        onMouseDown={(event) => {
          if (!menuItems || disabled || event.button !== 0) return;
          event.preventDefault();
          if (anchor) close();
          else open(false);
        }}
        onKeyDown={(event) => {
          if (!menuItems || disabled) return;
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          open(true);
        }}
        onClick={() => {
          if (!disabled && !menuItems) onClick?.();
        }}
      >
        <span className="toolbar-button-icon">
          {icon}
          {menuItems && <ChevronDownIcon className="toolbar-button-chevron" size={9} />}
        </span>
        <span className="toolbar-button-label">{label}</span>
      </button>
      {anchor &&
        menuItems &&
        createPortal(
          <MenuPopup
            items={menuItems}
            anchor={anchor}
            platform={platform}
            label={label}
            initialActive={keyboard ? 'first' : 'none'}
            onActivate={activate}
            onDismiss={close}
            isOutsideIgnored={isOutsideIgnored}
          />,
          document.body,
        )}
    </>
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

export function Toolbar({ platform, repository, tracking, openInItems, appearanceItems }: ToolbarProps) {
  const noRepository = repository ? undefined : 'Open a repository first.';
  const counts = trackingCounts(tracking);
  const dirty = repository?.workingTree.state === 'dirty';

  return (
    <div className="toolbar" role="toolbar" aria-label="Repository commands">
      <div className="toolbar-group">
        <ToolbarButton
          icon={<QuickLaunchIcon size={20} />}
          label="Quick Launch"
          disabledReason="Quick Launch is not available yet (planned for P12)."
          platform={platform}
        />
        <ToolbarButton
          icon={<FetchIcon size={20} />}
          label="Fetch"
          disabledReason={noRepository ?? `Fetching is not available yet (planned for ${networkPhase}).`}
          platform={platform}
        />
        <ToolbarButton
          icon={<PullIcon size={20} />}
          label="Pull"
          disabledReason={noRepository ?? `Pulling is not available yet (planned for ${networkPhase}).`}
          platform={platform}
        />
        <ToolbarButton
          icon={<PushIcon size={20} />}
          label="Push"
          disabledReason={noRepository ?? `Pushing is not available yet (planned for ${networkPhase}).`}
          platform={platform}
        />
        <ToolbarButton
          icon={<StashIcon size={20} />}
          label="Stash"
          disabledReason={noRepository ?? 'Stashing is not available yet (planned for P06).'}
          menuItems={[]}
          platform={platform}
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
            <strong title={repository.path}>
              {repository.name}
              {dirty ? '*' : ''}
            </strong>
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
          icon={<NewBranchIcon size={20} />}
          label="New Branch"
          disabledReason={
            noRepository ?? `Creating branches is not available yet (planned for ${networkPhase}).`
          }
          platform={platform}
        />
      </div>

      <div className="toolbar-group toolbar-end">
        <ToolbarButton
          icon={<OpenInIcon size={20} />}
          label="Open in"
          disabledReason={noRepository}
          menuItems={openInItems}
          platform={platform}
        />
        <ToolbarButton
          icon={<AppearanceIcon size={20} />}
          label="Appearance"
          menuItems={appearanceItems}
          platform={platform}
        />
      </div>
    </div>
  );
}
