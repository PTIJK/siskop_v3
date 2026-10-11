import { useCallback, useState } from "react";
import { apiFetchPage, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";

export interface ReportPageMeta {
  page?: number;
  limit?: number;
  total?: number;
}

/** Explicit-apply report loader: nothing is fetched until run() is called. */
export function useReport<T>(errorTitle: string) {
  const { toast } = useToast();
  const [data, setData] = useState<T | null>(null);
  /** Pagination info for list reports (Jurnal Umum, Buku Besar per akun); empty for the rest. */
  const [meta, setMeta] = useState<ReportPageMeta>({});
  const [isLoading, setIsLoading] = useState(false);
  /** True once a run has finished: separates "no data for this period" from "never run". */
  const [hasRun, setHasRun] = useState(false);

  const run = useCallback(
    async (path: string) => {
      setIsLoading(true);
      try {
        const res = await apiFetchPage<T>(path);
        setData(res.items);
        setMeta({ page: res.meta.page, limit: res.meta.limit, total: res.meta.total });
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
    setMeta({});
    setHasRun(false);
  }, []);

  return { data, setData, meta, isLoading, hasRun, run, clear };
}
