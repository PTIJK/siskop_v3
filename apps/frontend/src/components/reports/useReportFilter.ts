import { useCallback, useState } from "react";

/** Filter state that survives tab switches and reloads within the browser session
 * ("remember last filter"). Storage can be absent or throw (private window, blocked
 * site data), so every access is guarded and the report still works without it. */
export function useReportFilter<T extends Record<string, string>>(key: string, defaults: () => T) {
  const storageKey = `report-filter:${key}`;
  const [value, setValue] = useState<T>(() => {
    const base = defaults();
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Keep only known string fields so a stale shape can never poison the form.
      const merged: Record<string, string> = { ...base };
      for (const k of Object.keys(base)) {
        const v = parsed[k];
        if (typeof v === "string") merged[k] = v;
      }
      return merged as T;
    } catch {
      return base;
    }
  });

  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((prev) => {
        const next = { ...prev, ...patch };
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* storage unavailable: the filter just isn't remembered */
        }
        return next;
      });
    },
    [storageKey]
  );

  const reset = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setValue(defaults());
    // defaults is a per-report constant factory
  }, [storageKey]);

  return { value, update, reset };
}
