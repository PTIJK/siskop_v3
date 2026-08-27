import { useEffect, useState } from "react";
import type { Neraca, NeracaSection } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { FileText } from "lucide-react";

function SectionCard({ title, section }: { title: string; section: NeracaSection }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {section.items.map((item, i) => (
        <div key={item.accountId ?? i} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
          <div className="min-w-0">
            <p className={item.isComputed ? "truncate italic text-muted-foreground" : "truncate"}>
              {item.name}
              {item.isComputed && (
                <Badge variant="secondary" className="ml-1.5">
                  Otomatis
                </Badge>
              )}
            </p>
            {item.code && <p className="font-mono text-xs text-muted-foreground">{item.code}</p>}
          </div>
          <span className="shrink-0 font-medium">{formatRupiahSingkat(item.balance)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>Total {title}</span>
        <span>{formatRupiahSingkat(section.total)}</span>
      </div>
    </div>
  );
}

// First of the 3 regulatory reports being added under the full-parity
// principle (docs/06-PRD-SISKOP-Mobile-Version.md §7/§12) — SHU distribution
// and CALK remain deferred (unpaginated member roster / inline narrative
// editing, respectively — see conversation record). Auto-loads on mount with
// today's date, matching desktop's NeracaTab.tsx (unlike the financial/RAT
// reports, which require a manual "Tampilkan" tap first).
export function NeracaTab() {
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Neraca | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEntitled: boolean } | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Neraca>(`/reports/regulatory/neraca?asOfDate=${asOfDate}`));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Gagal memuat neraca";
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
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Per Tanggal</p>
        <div className="flex gap-2">
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <button
            onClick={fetchReport}
            disabled={isLoading}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <FileText className="h-4 w-4" /> {isLoading ? "Memuat..." : "Tampilkan"}
          </button>
        </div>
      </div>

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
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Neraca per {data.asOfDate}</p>
            <Badge variant={data.balanced ? "default" : "destructive"}>{data.balanced ? "Seimbang" : "Tidak Seimbang"}</Badge>
          </div>
          <SectionCard title="Aset" section={data.aset} />
          <SectionCard title="Kewajiban" section={data.kewajiban} />
          <SectionCard title="Ekuitas" section={data.ekuitas} />
          <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm font-semibold">
            <span>Total Kewajiban dan Ekuitas</span>
            <span>{formatRupiahSingkat(data.totalKewajibanDanEkuitas)}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <FileText className="h-8 w-8" />
          <p className="text-sm">Pilih tanggal dan tekan &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
