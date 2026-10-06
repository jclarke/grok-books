import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** Read and patch page-specific query-string values. Empty values are removed. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string, fallback = "") => params.get(key) ?? fallback, [params]);
  const patch = useCallback(
    (updates: Record<string, string | number | null | undefined>, opts: { resetOffset?: boolean; replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          if (opts.resetOffset !== false && !("offset" in updates)) next.delete("offset");
          return next;
        },
        { replace: opts.replace },
      );
    },
    [setParams],
  );
  return { params, get, patch };
}
