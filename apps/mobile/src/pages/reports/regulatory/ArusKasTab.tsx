import { useEffect, useState } from "react";
import type { ArusKas, ArusKasSection } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { FileText, Info } from "lucide-react";

function ActivityCard({ title, section }: { title: string; section: ArusKasSection }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {section.rincian.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada transaksi pada periode ini.</p>
      ) : (
        <>
          {section.rincian.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 font-medium">{formatRupiahSingkat(r.amount)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>Total {title}</span>
            <span>{formatRupiahSingkat(section.total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// Second of the 3 regulatory reports being added (docs/06-PRD-SISKOP-Mobile-Version.md
// §7/§12). Desktop shows a "Buka Konfigurasi Akun" link when `data.catatan`
// is present (incomplete account mapping) — dropped here since Config isn't
// in mobile scope at all (§6); the note text itself is still shown.
export function ArusKasTab() {
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<ArusKas | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEntitled: boolean } | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await apiFetch<ArusKas>(`/reports/regulatory/arus-kas?from=${from}&to=${to}`));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Gagal memuat arus kas";
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
      ) : data?.catatan ? (
        <div className="flex items-start gap-2.5 rounded-lg border bg-card p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{data.catatan}</p>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Periode {data.periode.from} — {data.periode.to}
            </p>
            <Badge variant={data.balanced ? "default" : "destructive"}>{data.balanced ? "Seimbang" : "Tidak Seimbang"}</Badge>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm font-semibold">
            <span>Saldo Kas Awal</span>
            <span>{formatRupiahSingkat(data.saldoKasAwal)}</span>
          </div>

          <ActivityCard title="Aktivitas Operasi" section={data.aktivitasOperasi} />
          <ActivityCard title="Aktivitas Investasi" section={data.aktivitasInvestasi} />
          <ActivityCard title="Aktivitas Pendanaan" section={data.aktivitasPendanaan} />

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Kenaikan (Penurunan) Kas Bersih</span>
              <span>{formatRupiahSingkat(data.kenaikanPenurunanKasBersih)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between border-t pt-1.5 text-sm font-semibold">
              <span>Saldo Kas Akhir</span>
              <span>{formatRupiahSingkat(data.saldoKasAkhir)}</span>
            </div>
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
