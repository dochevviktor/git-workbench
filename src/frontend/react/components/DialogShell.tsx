import { useEffect, useId, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Platform } from '../lib/platform';
import { WarningIcon } from './Icons';

/** Fork's dialog chrome: a large mark, a title with one explanatory line, then labelled rows. */
export function DialogShell({
  title,
  subtitle,
  icon,
  platform,
  warning,
  submitLabel,
  submitDisabled,
  danger,
  busy,
  onSubmit,
  onClose,
  children,
  className,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: ReactNode;
  readonly platform: Platform;
  readonly warning: string | null;
  readonly submitLabel: string;
  readonly submitDisabled: boolean;
  readonly danger?: boolean;
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submitDisabled && !busy) onSubmit();
  };

  const confirm = (
    <button
      key="confirm"
      type="submit"
      className={danger ? 'button primary danger' : 'button primary'}
      disabled={submitDisabled || busy}
      data-testid="reference-dialog-submit"
    >
      {submitLabel}
    </button>
  );
  const cancel = (
    <button key="cancel" type="button" className="button" onClick={onClose}>
      {busy ? 'Close' : 'Cancel'}
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      className={`dialog reference-dialog${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      data-testid="reference-dialog"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="dialog-content" onSubmit={submit}>
        <div className="reference-dialog-header">
          <span className="reference-dialog-mark" aria-hidden="true">
            {icon}
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        <dl className="reference-dialog-fields">{children}</dl>
        <div className="reference-dialog-actions">
          <p className="reference-dialog-warning" role="alert" data-testid="reference-dialog-warning">
            {warning && (
              <>
                <WarningIcon size={14} />
                <span>{warning}</span>
              </>
            )}
          </p>
          {/* Linux follows the Windows reference; macOS keeps its native button order. */}
          <div className="dialog-actions">
            {platform === 'darwin' ? [cancel, confirm] : [confirm, cancel]}
          </div>
        </div>
      </form>
    </dialog>
  );
}
