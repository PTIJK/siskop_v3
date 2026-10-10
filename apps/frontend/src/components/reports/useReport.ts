import { useCallback, useState } from "react";
import { apiFetch, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";

/** Explicit-apply report loader: nothing is fetched until run() is called. */
export function useReport<T>(errorTitle: string) {
  const { toast } = useToast();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  /** True once a run has finished: separates "no data for this period" from "never run". */
  const [hasRun, setHasRun] = useState(false);

  const run = useCallback(
    async (path: string) => {
      setIsLoading(true);
      try {
        setData(await apiFetch<T>(path));
        setHasRun(true);
      } catch (err) {
        const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
        toast({ title: errorTitle, description: message, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    },
    // errorTitle is a per-report constant
    [errorTitle]
  );

  const clear = useCallback(() => {
    setData(null);
    setHasRun(false);
  }, []);

  return { data, setData, isLoading, hasRun, run, clear };
}
