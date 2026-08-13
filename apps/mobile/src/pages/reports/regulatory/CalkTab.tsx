import { useEffect, useState } from "react";
import { CALK_SECTION_LABEL, type Calk, type CalkMutasiItem, type CalkSection, type LabaRugiItem } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiahSingkat, formatTanggalIndonesia } from "@/lib/format";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { FileText } from "lucide-react";

const NARRATIVE_SECTIONS: CalkSection[] = ["UMUM", "DASAR_PENYUSUNAN", "KEBIJAKAN_AKUNTANSI", "INFORMASI_TAMBAHAN"];

function MutasiCard({ title, items }: { title: string; items: CalkMutasiItem[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada data.</p>
      ) : (
        items.map((item, i) => (
          <div key={item.accountId ?? i} className="border-b py-2 last:border-b-0">
            <p className="truncate text-sm">{item.name}</p>
            {item.code && <p className="font-mono text-xs text-muted-foreground">{item.code}</p>}
            <div className="mt-1 grid grid-cols-3 gap-x-2 text-xs">
              <div>
                <p className="text-muted-foreground">Awal</p>
                <p className="font-medium">{formatRupiahSingkat(item.saldoAwal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Akhir</p>
                <p className="font-medium">{formatRupiahSingkat(item.saldoAkhir)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Mutasi</p>
                <p className="font-medium">{formatRupiahSingkat(item.mutasi)}</p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function IncomeExpenseCard({ title, items }: { title: string; items: LabaRugiItem[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada data.</p>
      ) : (
        items.map((item) => (
          <div key={item.accountId} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
            <div className="min-w-0">
              <p className="truncate">{item.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{item.code}</p>
            </div>
            <span className="shrink-0 font-medium">{formatRupiahSingkat(item.total)}</span>
          </div>
        ))
      )}
    </div>
  );
}

// FR-MOB-RPT-01 extension — the 5th and last regulatory report
// (docs/06-PRD-SISKOP-Mobile-Version.md §7/§12). View-only, not "the whole
// module minus a button": desktop's own `NarrativeEditor` already has a
// `canEdit` toggle between a `<Textarea>` and a plain `<p>` read display —
// this uses only the read path, the same shape mobile already used for
// Profile. No PDF export exists for CALK on desktop either (its narrative
// is reviewed in-app, not exported) — nothing dropped there.
export function CalkTab() {
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<Calk | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; notEntitled: boolean } | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Calk>(`/reports/regulatory/calk?from=${from}&to=${to}`));
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Gagal memuat CALK";
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
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Catatan Naratif</h2>
            {NARRATIVE_SECTIONS.map((section) => {
              const entry = data.narasi[section];
              return (
                <div key={section} className="rounded-lg border bg-card p-4">
                  <h3 className="mb-1.5 text-sm font-semibold">{CALK_SECTION_LABEL[section]}</h3>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.content || "Belum diisi"}</p>
                  {entry.updatedAt && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Terakhir diperbarui {formatTanggalIndonesia(entry.updatedAt)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Rincian Angka</h2>
            <MutasiCard title="Aset" items={data.rincianAset} />
            <MutasiCard title="Kewajiban" items={data.rincianKewajiban} />
            <MutasiCard title="Ekuitas" items={data.rincianEkuitas} />
            <IncomeExpenseCard title="Pendapatan" items={data.rincianPendapatan} />
            <IncomeExpenseCard title="Beban" items={data.rincianBeban} />
            <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm font-semibold">
              <span>SHU Berjalan</span>
              <span>{formatRupiahSingkat(data.shuBerjalan)}</span>
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
