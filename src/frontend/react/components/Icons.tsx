import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { readonly size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function QuickLaunchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 5.5h12.5M4.5 8.25l1.75 1.5-1.75 1.5M8 11.25h3" />
    </Icon>
  );
}

export function FetchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.25 11.75H4a2.75 2.75 0 0 1-.4-5.47A4.25 4.25 0 0 1 11.9 5a3.25 3.25 0 0 1 .35 6.72" />
      <path d="M8 7.25v6.5M5.75 11.5 8 13.75l2.25-2.25" />
    </Icon>
  );
}

export function PullIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.75v8.5M4.75 7 8 10.25 11.25 7M2.25 14.25h11.5" />
    </Icon>
  );
}

export function PushIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 11.25v-9.5M4.75 5 8 1.75 11.25 5M2.25 14.25h11.5" />
    </Icon>
  );
}

export function StashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.75" y="2.25" width="12.5" height="3.5" rx="0.75" />
      <path d="M2.75 5.75v7a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-7M6.25 8.5h3.5" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
    </Icon>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4.5" cy="3.25" r="1.5" />
      <circle cx="4.5" cy="12.75" r="1.5" />
      <circle cx="11.5" cy="4.75" r="1.5" />
      <path d="M4.5 4.75v6.5M11.5 6.25c0 3-7 2.5-7 5" />
    </Icon>
  );
}

export function NewBranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.5" cy="3.25" r="1.5" />
      <circle cx="6.5" cy="12.75" r="1.5" />
      <circle cx="12.25" cy="4.75" r="1.5" />
      <path d="M6.5 4.75v6.5M12.25 6.25c0 3-5.75 2.5-5.75 5M1.25 5h3M2.75 3.5v3" />
    </Icon>
  );
}

export function OpenInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 2.75H3.25a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9M9.5 1.75h4.75V6.5M14.25 1.75 7.5 8.5" />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="m4.5 6.25 2 1.75-2 1.75M8.25 10.25h3.25" />
    </Icon>
  );
}

export function AppearanceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 1.75v12.5a6.25 6.25 0 0 0 0-12.5Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ChangesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.25 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-8Z" />
      <path d="M9.25 1.75v3.5h3.5M8 6.5v3.5M6.25 8.25h3.5M6.25 12h3.5" />
    </Icon>
  );
}

export function CommitsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 1.5v13" />
      <circle cx="4" cy="4" r="1.6" fill="var(--icon-fill, transparent)" />
      <circle cx="4" cy="11.5" r="1.6" fill="var(--icon-fill, transparent)" />
      <path d="M7.5 4h6M7.5 11.5h6M7.5 7.75h4" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.25 10.25 3.75 3.75" />
    </Icon>
  );
}

export function RemoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.25 12.75H4a2.75 2.75 0 0 1-.4-5.47A4.25 4.25 0 0 1 11.9 6a3.25 3.25 0 0 1 .35 6.72Z" />
    </Icon>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 2.75v4.1a1 1 0 0 0 .3.7l6.4 6.4a1 1 0 0 0 1.4 0l4.1-4.1a1 1 0 0 0 0-1.4l-6.4-6.4a1 1 0 0 0-.7-.3h-4.1a1 1 0 0 0-1 1Z" />
      <circle cx="5" cy="5.25" r="1" />
    </Icon>
  );
}

export function StashItemIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.25 5.5 8 2.25l5.75 3.25L8 8.75Z" />
      <path d="M2.25 5.5v5L8 13.75l5.75-3.25v-5M8 8.75v5" />
    </Icon>
  );
}

export function SubmoduleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="0.75" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1Z" />
    </Icon>
  );
}

export function RepositoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.25 12.75v-10a1 1 0 0 1 1-1h8.5v10.5H4.5a1.25 1.25 0 0 0 0 2.5h8.25" />
      <path d="M6 1.75v5l1.5-1.25L9 6.75v-5" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 4.25h7M12.5 4.25H14M2 11.75h1.5M7 11.75h7" />
      <circle cx="10.75" cy="4.25" r="1.75" />
      <circle cx="5.25" cy="11.75" r="1.75" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={props.strokeWidth ?? 1.75}>
      <path d="m3 8.5 3.25 3.25L13 4.75" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.75v10.5M2.75 8h10.5" />
    </Icon>
  );
}

/** Marks a commit whose message continues past its subject line. */
export function MessageBodyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.75 4.25v2.5a2 2 0 0 1-2 2h-7.5M5.75 6.25l-2.5 2.5 2.5 2.5" />
    </Icon>
  );
}

export function ListOptionsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </Icon>
  );
}

export function RecentMessagesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h11M2.5 7.5h11M2.5 11h6.5" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.4-4.25 6.5-4.25S14.5 8 14.5 8s-2.4 4.25-6.5 4.25S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </Icon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.25 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-8Z" />
      <path d="M9.25 1.75v3.5h3.5" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.4 9.5a1 1 0 0 1-.87 1.5H2.6a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6v3.25M8 11.25v.1" />
    </Icon>
  );
}

/** Window-control glyphs are drawn on a 10px pixel grid so they stay crisp at common scales. */
function WindowGlyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      {children}
    </svg>
  );
}

export function MinimizeGlyph() {
  return (
    <WindowGlyph>
      <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
    </WindowGlyph>
  );
}

export function MaximizeGlyph() {
  return (
    <WindowGlyph>
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
    </WindowGlyph>
  );
}

export function RestoreGlyph() {
  return (
    <WindowGlyph>
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
      <path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" />
    </WindowGlyph>
  );
}

export function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M0.5 0.5 9.5 9.5M9.5 0.5 0.5 9.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
