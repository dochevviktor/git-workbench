import { useEffect, useRef } from 'react';
import type { AppInfo, GitInfo } from '../../../common/ipc/contracts';

interface AboutDialogProps {
  readonly info: AppInfo | undefined;
  readonly gitInfo: GitInfo | undefined;
  readonly onClose: () => void;
}

export function AboutDialog({ info, gitInfo, onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="about-title"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-content">
        <h2 id="about-title">Git Workbench</h2>
        <p className="muted">
          An independently developed Git client. It is not affiliated with or endorsed by the makers of Fork.
        </p>
        <dl className="dialog-facts">
          <dt>Version</dt>
          <dd>{info?.version ?? 'Unknown'}</dd>
          <dt>Build</dt>
          <dd>{info?.mode ?? 'Unknown'}</dd>
          <dt>Platform</dt>
          <dd>{info?.platform ?? 'Unknown'}</dd>
          <dt>Git</dt>
          <dd>
            {gitInfo?.status === 'available'
              ? `${gitInfo.version ?? ''} (${gitInfo.executable ?? ''})`
              : gitInfo?.status === 'missing'
                ? 'Not found'
                : 'Unavailable'}
          </dd>
          {gitInfo?.minimumVersion && (
            <>
              <dt>Minimum Git</dt>
              <dd>
                {gitInfo.minimumVersion}
                {gitInfo.status === 'unsupported' ? ' · select a newer Git in Preferences' : ''}
              </dd>
            </>
          )}
          <dt>Electron</dt>
          <dd>{info?.versions.electron ?? 'Unknown'}</dd>
          <dt>Chromium</dt>
          <dd>{info?.versions.chrome ?? 'Unknown'}</dd>
          <dt>Node.js</dt>
          <dd>{info?.versions.node ?? 'Unknown'}</dd>
        </dl>
        <div className="dialog-actions">
          <button
            type="button"
            className="button primary"
            autoFocus
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
