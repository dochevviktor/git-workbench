import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, WindowCommand, WindowState } from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

export function useDesktop() {
  const [info, setInfo] = useState<AppInfo>();
  const [windowState, setWindowState] = useState<WindowState>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const api = window.desktop;
    if (!api) {
      setError('Open this application in Electron to connect to the desktop. Run npm run dev.');
      setLoading(false);
      return;
    }

    let active = true;
    let eventReceived = false;
    setLoading(true);
    setError(undefined);
    const unsubscribe = api.window.onStateChanged((state) => {
      eventReceived = true;
      if (active) setWindowState(state);
    });

    void Promise.all([api.app.getInfo(), api.window.getState()])
      .then(([appResult, stateResult]) => {
        if (!active) return;
        setInfo(unwrapResult(appResult));
        const state = unwrapResult(stateResult);
        // A newer event must not be overwritten by an older initial snapshot.
        if (!eventReceived) setWindowState(state);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not connect to the desktop.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  const windowCommand = useCallback((action: WindowCommand['action']) => {
    const api = window.desktop;
    if (!api) return;
    void api.window
      .command({ action })
      .then(unwrapResult)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'The window command could not be completed.');
      });
  }, []);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    info,
    windowState,
    error,
    loading,
    refresh,
    windowCommand,
  };
}
