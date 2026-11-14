import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { errorMessage } from "../lib/api";

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: (silent?: boolean) => Promise<void>;
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Small data-loading primitive for the dashboard.
 *
 * The loader is stored in a ref so callers can pass inline closures without
 * re-triggering requests on every render; pass the real inputs through `deps`.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
  options: { enabled?: boolean } = {},
): ResourceState<T> {
  const { enabled = true } = options;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(
    async (silent = false) => {
      if (!enabled) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const next = await loaderRef.current();
        if (mounted.current) setData(next);
      } catch (caught) {
        if (mounted.current) setError(errorMessage(caught));
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void reload();
    // Inputs are intentionally spread so callers control invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, loading, error, reload, setData };
}

/** Debounce an arbitrary value. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
