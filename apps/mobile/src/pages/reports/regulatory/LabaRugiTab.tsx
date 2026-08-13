import { useEffect, useState } from "react";
import type { LabaRugiSection, LaporanHasilUsaha } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { FileText } from "lucide-react";

function SectionCard({ title, section }: { title: string; section: LabaRugiSection }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {section.items.map((item) => (
        <div key={item.accountId} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
          <div className="min-w-0">
            <p className="truncate">{item.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{item.code}</p>
          </div>
          <span className="shrink-0 font-medium">{formatRupiahSingkat(item.total)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>Total {title}</span>
        <span>{formatRupiahSingkat(section.total)}</span>
      </div>
    </div>
  );
}

// Third and last of the "easy" regulatory reports being added
// (docs/06-PRD-SISKOP-Mobile-Version.md §7/§12) — SHU distribution and CALK
// stay deferred (see conversation record). Desktop's SectionTable here only
// renders code/name/total, even though `LabaRugiItem` also carries
// `anggota`/`bukanAnggota` split fields — matched exactly (full parity means
// matching what desktop actually shows, not the full API shape).
export function LabaRugiTab() {
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<LaporanHasilUsaha | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEntitled: boolean } | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await apiFetch<LaporanHasilUsaha>(`/reports/regulatory/laporan-hasil-usaha?from=${from}&to=${to}`));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Gagal memuat laporan hasil usaha";
      const notEntitled = err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED";
      setError({ message, notEntitled });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchReport();
  }, []);

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
      ) : data ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>
          <SectionCard title="Pendapatan" section={data.pendapatan} />
          <SectionCard title="Beban" section={data.beban} />
          <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm font-semibold">
            <span>SHU Berjalan (Pendapatan − Beban)</span>
            <span>{formatRupiahSingkat(data.shuBerjalan)}</span>
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
