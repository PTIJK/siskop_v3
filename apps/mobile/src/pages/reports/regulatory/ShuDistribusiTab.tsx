import { useEffect, useState } from "react";
import type { ShuDistribution } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { FileText, Info, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 15;

// Fixes the read-only technical debt flagged before Fase 2 started
// (docs/06-PRD-SISKOP-Mobile-Version.md §12): desktop's ShuDistribusiTab.tsx
// renders every active member's row in one unbounded <table> —
// getShuDistribution() computes and returns the full roster with no backend
// pagination (it can't easily paginate anyway: alokasi/shuBerjalan are
// aggregates over the whole set). The fix here is client-side: the full
// array is still fetched once, but rendered in pages instead of all at once,
// so a tenant with hundreds of members doesn't hand the phone hundreds of
// DOM nodes in a single paint. Demo data only has 10 members, so this can't
// be stress-tested for real here — the slicing logic itself is what's being
// fixed, independent of how many rows exist.
export function ShuDistribusiTab() {
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<ShuDistribution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEntitled: boolean } | null>(null);
  const [page, setPage] = useState(1);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    setPage(1);
    try {
      setData(await apiFetch<ShuDistribution>(`/reports/regulatory/shu-distribution?from=${from}&to=${to}`));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Gagal memuat pembagian SHU";
      const notEntitled = err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED";
      setError({ message, notEntitled });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchReport();
  }, []);

  const totalPages = data ? Math.ceil(data.anggota.length / PAGE_SIZE) : 0;
  const pageRows = data ? data.anggota.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];

  return (
    <div className="space-y-4">
      <PeriodRangeControls from={from} to={to} onFromChange={setFrom} onToChange={setTo} onSubmit={fetchReport} isLoading={isLoading} />

      {isLoading ? (
        <PageLoading />
      ) : error ? (
        error.notEntitled ? (
          <EntitlementNotice message={error.message} />
        ) : (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>
        )
      ) : data?.catatan ? (
        <div className="flex items-start gap-2.5 rounded-lg border bg-card p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{data.catatan}</p>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>

          {data.alokasi && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Jasa Simpanan", bucket: data.alokasi.jasaSimpanan },
                { label: "Jasa Pinjaman", bucket: data.alokasi.jasaPinjaman },
                { label: "Cadangan", bucket: data.alokasi.cadangan },
                { label: "Lainnya", bucket: data.alokasi.lainnya }
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    {item.label} ({item.bucket.percent}%)
                  </p>
                  <p className="mt-1 text-base font-bold">{formatRupiahSingkat(item.bucket.total)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Pembagian per Anggota</h3>
            {pageRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada data.</p>
            ) : (
              <div className="space-y-2">
                {pageRows.map((a) => (
                  <div key={a.memberId} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {a.no}. {a.fullName}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{a.memberCode}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold">{formatRupiahSingkat(a.totalShu)}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-x-2 border-t pt-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Pokok/SW</p>
                        <p className="font-medium">{formatRupiahSingkat(a.shuPokokWajib)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Sukarela</p>
                        <p className="font-medium">{formatRupiahSingkat(a.shuSukarela)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Pinjaman</p>
                        <p className="font-medium">{formatRupiahSingkat(a.jasaPinjaman)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-3 border-t pt-3 text-xs text-muted-foreground">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-md border p-1.5 disabled:opacity-40"
                  aria-label="Halaman sebelumnya"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>
                  {page} / {totalPages} ({data.anggota.length} anggota)
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md border p-1.5 disabled:opacity-40"
                  aria-label="Halaman berikutnya"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {data.totalDibagikanKeAnggota && (
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-semibold">
                <span>Total Dibagikan ke Anggota</span>
                <span>{formatRupiahSingkat(data.totalDibagikanKeAnggota)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <FileText className="h-8 w-8" />
          <p className="text-sm">Pilih periode dan tekan &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
