import { useState } from "react";
import type { FinancialReport, RATReport } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { openPdf } from "@/lib/pdf";
import { formatRupiahSingkat } from "@/lib/format";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { cn } from "@/lib/utils";
import { Download, FileText } from "lucide-react";

type PeriodType = "range" | "monthly" | "yearly";
type ReportTab = "financial" | "rat";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, sub, value, valueClass }: { label: string; sub?: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <div className="min-w-0">
        <p className="truncate">{label}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <span className={cn("shrink-0 font-semibold", valueClass)}>{value}</span>
    </div>
  );
}

// FR-MOB-RPT-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): full parity with
// desktop's ReportsPage — all 3 period modes, both tabs, and every
// stat-card/detail-table sub-section (Rincian Simpanan per Jenis, Rincian
// Transaksi Simpanan, Rincian Pinjaman, Simpanan per Jenis, Distribusi KOL) —
// the original terse FR wording didn't name these, so they're spelled out
// here to avoid the Dashboard omission repeating (§8.5). Tables render as
// stacked rows, not a raw <table>, per the systemic fix (§8.1).
export function ReportsPage() {
  const [periodType, setPeriodType] = useState<PeriodType>("range");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [tab, setTab] = useState<ReportTab>("financial");
  const [financialReport, setFinancialReport] = useState<FinancialReport | null>(null);
  const [ratReport, setRatReport] = useState<RATReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const getDateRange = () => {
    if (periodType === "range") return { startDate, endDate };
    if (periodType === "monthly") {
      const m = month.padStart(2, "0");
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      return { startDate: `${year}-${m}-01`, endDate: `${year}-${m}-${lastDay}` };
    }
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  };

  const fetchReport = async () => {
    setIsLoading(true);
    setApiError("");
    try {
      if (tab === "financial") {
        const { startDate: sd, endDate: ed } = getDateRange();
        if (!sd || !ed) return;
        setFinancialReport(await apiFetch<FinancialReport>(`/reports/financial?startDate=${sd}&endDate=${ed}`));
      } else {
        setRatReport(await apiFetch<RATReport>(`/reports/rat?year=${year}`));
      }
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Gagal memuat laporan");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadPDF = async () => {
    try {
      if (tab === "financial") {
        const { startDate: sd, endDate: ed } = getDateRange();
        await openPdf(`/reports/financial/pdf?startDate=${sd}&endDate=${ed}`);
      } else {
        await openPdf(`/reports/rat/pdf?year=${year}`);
      }
    } catch {
      setApiError("Gagal membuka PDF");
    }
  };

  const hasReport = financialReport || ratReport;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Laporan</h1>

      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Periode</p>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {[
            { value: "range", label: "Range" },
            { value: "monthly", label: "Bulanan" },
            { value: "yearly", label: "Tahunan" }
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriodType(opt.value as PeriodType)}
              className={cn(
                "flex-1 rounded-sm px-2 py-1.5 text-xs font-medium",
                periodType === opt.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {periodType === "range" && (
            <div className="flex gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
            </div>
          )}
          {periodType === "monthly" && (
            <div className="flex gap-2">
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)} className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm">
                {YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {periodType === "yearly" && (
            <select value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={fetchReport}
            disabled={isLoading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <FileText className="h-4 w-4" /> {isLoading ? "Memuat..." : "Tampilkan"}
          </button>
          {hasReport && (
            <button onClick={downloadPDF} className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <Download className="h-4 w-4" />
            </button>
          )}
        </div>
        {apiError && <p className="mt-2 text-xs text-destructive">{apiError}</p>}
      </div>

      <div className="flex gap-1 rounded-md bg-muted p-1">
        {[
          { value: "financial", label: "Laporan Keuangan" },
          { value: "rat", label: "Laporan RAT" }
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setTab(t.value as ReportTab);
              setFinancialReport(null);
              setRatReport(null);
            }}
            className={cn(
              "flex-1 rounded-sm px-2 py-1.5 text-xs font-medium",
              tab === t.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageLoading />
      ) : tab === "financial" ? (
        financialReport ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Periode: {financialReport.periode.start} s/d {financialReport.periode.end}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Saldo Akhir Simpanan</p>
                <p className="mt-1 text-base font-bold">{formatRupiahSingkat(financialReport.saldoAkhirSimpanan)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Sisa Pinjaman Outstanding</p>
                <p className="mt-1 text-base font-bold">{formatRupiahSingkat(financialReport.sisaPinjamanOutstanding)}</p>
              </div>
              <div className="col-span-2 rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Angsuran Diterima</p>
                <p className="mt-1 text-base font-bold">{formatRupiahSingkat(financialReport.pinjaman.angsuranDiterima.total)}</p>
              </div>
            </div>

            <ReportCard title="Rincian Simpanan per Jenis">
              {financialReport.simpananPerJenis.map((s, i) => (
                <Row key={i} label={s.name} sub={`${s.type} · ${s.count} rekening`} value={formatRupiahSingkat(s.totalBalance)} />
              ))}
            </ReportCard>

            <ReportCard title="Rincian Transaksi Simpanan">
              <Row
                label="Setoran"
                sub={`${financialReport.transaksiSimpanan.deposit.count} transaksi`}
                value={formatRupiahSingkat(financialReport.transaksiSimpanan.deposit.total)}
                valueClass="text-green-700"
              />
              <Row
                label="Penarikan"
                sub={`${financialReport.transaksiSimpanan.withdrawal.count} transaksi`}
                value={formatRupiahSingkat(financialReport.transaksiSimpanan.withdrawal.total)}
                valueClass="text-orange-700"
              />
            </ReportCard>

            <ReportCard title="Rincian Pinjaman">
              <Row
                label="Pinjaman Dicairkan"
                sub={`${financialReport.pinjaman.dicairkan.count} pinjaman`}
                value={formatRupiahSingkat(financialReport.pinjaman.dicairkan.total)}
              />
              <Row
                label="Angsuran Diterima"
                sub={`${financialReport.pinjaman.angsuranDiterima.count} angsuran`}
                value={formatRupiahSingkat(financialReport.pinjaman.angsuranDiterima.total)}
                valueClass="text-green-700"
              />
            </ReportCard>
          </div>
        ) : (
          <EmptyState />
        )
      ) : ratReport ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Tahun {ratReport.tahun}</p>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Anggota Awal Tahun", value: `${ratReport.keanggotaan.awalTahun} orang` },
              { label: "Anggota Akhir Tahun", value: `${ratReport.keanggotaan.akhirTahun} orang` },
              { label: "Pertumbuhan Anggota", value: `${ratReport.keanggotaan.pertumbuhan} orang` },
              { label: "Pinjaman Diberikan", value: formatRupiahSingkat(ratReport.pinjaman.diberikan.total) },
              { label: "Jml. Pinjaman Diberikan", value: `${ratReport.pinjaman.diberikan.count}` },
              { label: "Pinjaman Lunas", value: `${ratReport.pinjaman.lunas}` }
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-base font-bold">{item.value}</p>
              </div>
            ))}
          </div>

          <ReportCard title="Simpanan per Jenis">
            {ratReport.simpanan.map((s, i) => (
              <Row key={i} label={s.jenis} sub={`${s.type} · ${s.jumlahRekening} rekening`} value={formatRupiahSingkat(s.totalSaldo)} />
            ))}
          </ReportCard>

          <ReportCard title="Distribusi Kualitas Pinjaman (KOL)">
            {ratReport.kolDistribution.map((k, i) => (
              <div key={i} className="flex items-center justify-between border-b py-2 text-sm last:border-b-0">
                <KOLBadge category={k.category} />
                <span className="font-semibold">
                  {k.count} ({k.percentage})
                </span>
              </div>
            ))}
          </ReportCard>
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
      <FileText className="h-8 w-8" />
      <p className="text-sm">Pilih periode dan tekan &quot;Tampilkan&quot;</p>
    </div>
  );
}
