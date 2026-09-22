import { useEffect, useState } from 'react';
import type { GitInstance } from '../../../common/ipc/settings';
import { unwrapResult } from '../../../common/ipc/result';

export function GitInstanceControl() {
  const [value, setValue] = useState<GitInstance>();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true;
    void window.desktop?.settings
      .getGitInstance()
      .then(unwrapResult)
      .then((result) => {
        if (current) {
          setValue(result);
          setSelected(result.executable);
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Cannot read Git instance.');
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <div className="settings-page">
      <p className="settings-target">Next launch: {selected ?? 'System Git (GIT_EXECUTABLE or PATH)'}</p>
      <div className="settings-links">
        <button
          className="button"
          disabled={!value || busy}
          onClick={() => {
            setBusy(true);
            void window.desktop?.settings
              .pickGitInstance()
              .then(unwrapResult)
              .then((path) => {
                if (path) setSelected(path);
              })
              .catch(() => setError('Cannot select Git executable.'))
              .finally(() => setBusy(false));
          }}
        >
          Choose Git…
        </button>
        <button className="button" disabled={!value || busy} onClick={() => setSelected(null)}>
          System Git
        </button>
        <button
          className="button"
          disabled={!value || busy || selected === value.executable}
          onClick={() => {
            if (!value) return;
            setBusy(true);
            setError('');
            void window.desktop?.settings
              .saveGitInstance({ ...value, executable: selected })
              .then(unwrapResult)
              .then((result) => {
                setValue(result);
                setNotice('Saved. Restart the application to use this Git instance.');
              })
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : 'Cannot save Git instance.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Save Git instance
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
