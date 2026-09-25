import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, FileDown, FileSpreadsheet, TrendingUp } from "lucide-react";
import type { SavingStatement, SavingTransactionType } from "@siskop/types";
import { downloadFile, openPdf } from "@/lib/pdf";
import { formatRupiahRinci, formatTanggalPendek } from "@/lib/format";

const TYPE_META: Record<SavingTransactionType, { label: string; icon: typeof ArrowDownCircle; colorClass: string }> = {
  DEPOSIT: { label: "Setoran", icon: ArrowDownCircle, colorClass: "text-green-600" },
  INTEREST: { label: "Bunga", icon: TrendingUp, colorClass: "text-blue-600" },
  WITHDRAWAL: { label: "Penarikan", icon: ArrowUpCircle, colorClass: "text-orange-600" }
};

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface Props {
  /** `/savings/:id` (staff) or `/member/savings/:id` (member portal). */
  basePath: string;
  queryKey: readonly unknown[];
  fetchStatement: (path: string) => Promise<SavingStatement>;
  /** Bearer token for the PDF/CSV exports; defaults to the staff session. */
  getToken?: () => string | null;
}

/**
 * "Riwayat Transaksi" as a Rekening Koran on mobile: cards instead of the
 * desktop five-column table (docs/06 §8.1 overflow rule). Each card shows the
 * Debit (keluar) or Kredit (masuk) amount and the running Saldo after it,
 * bracketed by Saldo Awal and Saldo Akhir for the chosen period.
 */
export function SavingStatementList({ basePath, queryKey, fetchStatement, getToken }: Props) {
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(ymd(today));
  const [exportError, setExportError] = useState<string | null>(null);

  const validPeriod = !!from && !!to && from <= to;
  const qs = `from=${from}&to=${to}`;
  const { data: statement, isPending, error } = useQuery({
    queryKey: [...queryKey, "statement", from, to],
    queryFn: () => fetchStatement(`${basePath}/statement?${qs}`),
    enabled: validPeriod
  });

  const handleExport = async (kind: "pdf" | "csv") => {
    setExportError(null);
    try {
      if (kind === "pdf") await openPdf(`${basePath}/statement/pdf?${qs}`, getToken);
      else await downloadFile(`${basePath}/statement/csv?${qs}`, `rekening-koran-${from}_${to}.csv`, getToken);
    } catch {
      setExportError(kind === "pdf" ? "Gagal membuka PDF" : "Gagal mengunduh CSV");
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Riwayat Transaksi</h2>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Dari
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Sampai
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>

      {!validPeriod ? (
        <p className="rounded-lg border py-6 text-center text-sm text-muted-foreground">Tanggal awal harus sebelum tanggal akhir</p>
      ) : error ? (
        <p className="rounded-lg border py-6 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Gagal memuat riwayat transaksi"}
        </p>
      ) : isPending || !statement ? (
        <p className="rounded-lg border py-6 text-center text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Saldo Awal</dt>
              <dd className="text-sm font-semibold tabular-nums">{formatRupiahRinci(statement.openingBalance)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Saldo Akhir</dt>
              <dd className="text-sm font-semibold tabular-nums text-primary">{formatRupiahRinci(statement.closingBalance)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Kredit (masuk)</dt>
              <dd className="text-sm font-semibold tabular-nums text-green-700">{formatRupiahRinci(statement.totalCredit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Debit (keluar)</dt>
              <dd className="text-sm font-semibold tabular-nums text-orange-700">{formatRupiahRinci(statement.totalDebit)}</dd>
            </div>
          </dl>

          <div className="flex gap-2">
            <button
              onClick={() => handleExport("pdf")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              onClick={() => handleExport("csv")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
          {exportError && <p className="text-center text-xs text-destructive">{exportError}</p>}

          {statement.rows.length === 0 ? (
            <p className="rounded-lg border py-6 text-center text-sm text-muted-foreground">Tidak ada transaksi pada periode ini</p>
          ) : (
            <div className="space-y-2">
              {statement.rows.map((r) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                const isDebit = r.type === "WITHDRAWAL";
                const detail = [r.note, r.createdByName].filter(Boolean).join(" · ");
                return (
                  <div key={r.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.colorClass}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium">{meta.label}</span>
                            <span className="text-xs text-muted-foreground">{formatTanggalPendek(r.date)}</span>
                          </div>
                          {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-semibold tabular-nums ${isDebit ? "text-orange-700" : "text-green-700"}`}>
                          <span className="mr-1 text-[10px] font-medium uppercase">{isDebit ? "Db" : "Cr"}</span>
                          {formatRupiahRinci(isDebit ? r.debit : r.credit)}
                        </p>
                        <p className="text-xs tabular-nums text-muted-foreground">Saldo {formatRupiahRinci(r.balance)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
