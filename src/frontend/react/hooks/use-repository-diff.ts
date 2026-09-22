import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RepositoryDiff,
  RepositoryDiffTarget,
  RepositoryDiffWhitespace,
  RepositoryDiffOptions,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';

interface RepositoryDiffState {
  readonly value: RepositoryDiff | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refresh: () => void;
  readonly controls: DiffControls;
}

export interface DiffControls {
  readonly contextLines: number;
  readonly entireFile: boolean;
  readonly loadLarge: () => void;
  readonly cancel: () => void;
  readonly setContextLines: (value: number) => void;
  readonly setEntireFile: (value: boolean) => void;
}

const sessionOptions = new Map<string, RepositoryDiffOptions>();

function actionError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The selected diff could not be loaded.';
}

function targetKey(target: RepositoryDiffTarget | undefined): string | undefined {
  if (!target) return undefined;
  return JSON.stringify(target);
}

/** Loads a selected diff and ignores late responses from a previous repository or file selection. */
export function useRepositoryDiff(
  repositoryId: string | undefined,
  target: RepositoryDiffTarget | undefined,
  whitespace: RepositoryDiffWhitespace,
  refreshSignal = 0,
): RepositoryDiffState {
  const [options, setOptions] = useState<RepositoryDiffOptions>(
    () => sessionOptions.get(repositoryId ?? '') ?? { contextLines: 3, entireFile: false },
  );
  const [largeTarget, setLargeTarget] = useState<symbol>();
  const [value, setValue] = useState<RepositoryDiff>();
  const [loadedKey, setLoadedKey] = useState<string>();
  const [loadedWhitespace, setLoadedWhitespace] = useState<RepositoryDiffWhitespace>();
  const [loadedOptions, setLoadedOptions] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const targetRef = useRef<RepositoryDiffTarget | undefined>(target);
  targetRef.current = target;
  const key = `${repositoryId ?? ''}:${targetKey(target) ?? ''}`;
  // Explicit loading applies to one visit; leaving and returning must offer Load Diff again (P2-004).
  const visit = useMemo(() => Symbol(key), [key]);
  const liveTarget = target !== undefined && target.kind !== 'commit';
  const inFlight = useRef(false);
  const activeRead = useRef<{ id: string; readId: string } | undefined>(undefined);
  const paused = useRef(false);
  const cancelRead = useCallback(() => {
    if (activeRead.current) void window.desktop?.repository.cancelDiff(activeRead.current);
    activeRead.current = undefined;
  }, []);

  const load = useCallback(
    async (background = false) => {
      if (background && (inFlight.current || paused.current)) return;
      cancelRead();
      const requestGeneration = generation.current + 1;
      generation.current = requestGeneration;
      const requestedTarget = targetRef.current;
      if (!repositoryId || !requestedTarget) {
        setValue(undefined);
        setLoadedKey(undefined);
        setLoadedWhitespace(undefined);
        setLoading(false);
        setError(undefined);
        return;
      }

      const api = window.desktop;
      if (!api) {
        setValue(undefined);
        setLoadedKey(undefined);
        setLoadedWhitespace(undefined);
        setLoading(false);
        setError('Open this application in Electron to inspect diffs.');
        return;
      }

      inFlight.current = true;
      const readId = crypto.randomUUID();
      activeRead.current = { id: repositoryId, readId };
      if (!background) setLoading(true);
      setError(undefined);
      try {
        const next = unwrapResult(
          await api.repository.getDiff({
            id: repositoryId,
            target: requestedTarget,
            whitespace,
            options: { ...options, includeImages: true, loadLarge: largeTarget === visit, readId },
          }),
        );
        if (generation.current !== requestGeneration) return;
        setValue((previous) =>
          previous?.snapshot === next.snapshot &&
          previous?.content === next.content &&
          previous?.state === next.state &&
          previous?.byteLength === next.byteLength &&
          previous?.message === next.message &&
          JSON.stringify(previous?.binaryMetadata) === JSON.stringify(next.binaryMetadata) &&
          JSON.stringify(previous?.target) === JSON.stringify(next.target) &&
          JSON.stringify(previous?.images) === JSON.stringify(next.images) &&
          previous?.repositoryId === next.repositoryId
            ? previous
            : next,
        );
        setLoadedKey(key);
        setLoadedWhitespace(whitespace);
        setLoadedOptions(JSON.stringify(options));
      } catch (reason: unknown) {
        if (generation.current === requestGeneration) {
          setValue(undefined);
          setLoadedKey(undefined);
          setLoadedWhitespace(undefined);
          setError(actionError(reason));
        }
      } finally {
        if (generation.current === requestGeneration) {
          inFlight.current = false;
          setLoading(false);
        }
        if (activeRead.current?.readId === readId) activeRead.current = undefined;
      }
    },
    [key, repositoryId, whitespace, options, largeTarget, cancelRead, visit],
  );

  useEffect(() => {
    generation.current += 1;
    paused.current = false;
    setError(undefined);
    if (!repositoryId || !targetRef.current) {
      setLoading(false);
      return;
    }
    void load();
    return () => {
      generation.current += 1;
      cancelRead();
    };
  }, [key, load, repositoryId, refreshSignal, cancelRead]);

  useEffect(() => {
    if (!liveTarget) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load, liveTarget]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    value:
      loadedKey === key && loadedWhitespace === whitespace && loadedOptions === JSON.stringify(options)
        ? value
        : undefined,
    loading,
    error,
    refresh,
    controls: {
      contextLines: options.contextLines ?? 3,
      entireFile: options.entireFile ?? false,
      setContextLines: (contextLines) =>
        setOptions((current) => {
          const next = { ...current, contextLines: Math.max(0, Math.min(100, contextLines)) };
          sessionOptions.set(repositoryId ?? '', next);
          return next;
        }),
      setEntireFile: (entireFile) =>
        setOptions((current) => {
          const next = { ...current, entireFile };
          sessionOptions.set(repositoryId ?? '', next);
          return next;
        }),
      loadLarge: () => {
        paused.current = false;
        if (largeTarget === visit) void load();
        else setLargeTarget(visit);
      },
      cancel: () => {
        generation.current += 1;
        paused.current = true;
        cancelRead();
        inFlight.current = false;
        setLoading(false);
        setError('Diff loading canceled.');
      },
    },
  };
}
