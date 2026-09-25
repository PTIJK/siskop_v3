import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SavingStatement as SavingStatementData, SavingTransactionType } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { downloadFile } from "@/lib/pdf";
import { formatRupiahRinci, formatTanggalPendek } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown, FileSpreadsheet } from "lucide-react";

const TYPE_LABEL: Record<SavingTransactionType, string> = {
  DEPOSIT: "Setoran",
  INTEREST: "Bunga",
  WITHDRAWAL: "Penarikan"
};

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function amountOrDash(value: string): string {
  return Number(value) === 0 ? "-" : formatRupiahRinci(value);
}

/**
 * "Riwayat Transaksi" as a Rekening Koran: account-holder view where money in
 * (setoran, bunga) is Kredit and money out (penarikan) is Debit, with a
 * running Saldo per line between Saldo Awal and Saldo Akhir for the period.
 */
export function SavingStatement({ savingId }: { savingId: string }) {
  const { toast } = useToast();
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(ymd(today));
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);

  const validPeriod = !!from && !!to && from <= to;
  const qs = `from=${from}&to=${to}`;
  const { data: statement, isPending, error } = useQuery({
    queryKey: ["savings", savingId, "statement", from, to],
    queryFn: () => apiFetch<SavingStatementData>(`/savings/${savingId}/statement?${qs}`),
    enabled: validPeriod
  });

  const handleExport = async (kind: "pdf" | "csv") => {
    setExporting(kind);
    try {
      const memberNo = statement?.saving.member.memberId.replace(/[^A-Za-z0-9_-]/g, "") ?? savingId;
      await downloadFile(`/savings/${savingId}/statement/${kind}?${qs}`, `rekening-koran-${memberNo}-${from}_${to}.${kind}`);
    } catch (err) {
      toast({ title: "Gagal", description: err instanceof Error ? err.message : "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Riwayat Transaksi</CardTitle>
          <p className="text-sm text-muted-foreground">Rekening koran — pergerakan dana per periode</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="statement-from" className="text-xs">
              Dari
            </Label>
            <Input id="statement-from" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement-to" className="text-xs">
              Sampai
            </Label>
            <Input id="statement-to" type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" disabled={!statement || !!exporting} onClick={() => handleExport("pdf")}>
            <FileDown className="mr-2 h-4 w-4" /> {exporting === "pdf" ? "Mengunduh..." : "PDF"}
          </Button>
          <Button variant="outline" size="sm" disabled={!statement || !!exporting} onClick={() => handleExport("csv")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> {exporting === "csv" ? "Mengunduh..." : "CSV"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!validPeriod ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Tanggal awal harus sebelum tanggal akhir</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat riwayat transaksi"}
          </p>
        ) : isPending || !statement ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 rounded-md border p-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Saldo Awal</dt>
                <dd className="font-semibold tabular-nums">{formatRupiahRinci(statement.openingBalance)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total Kredit (masuk)</dt>
                <dd className="font-semibold tabular-nums text-green-700">{formatRupiahRinci(statement.totalCredit)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total Debit (keluar)</dt>
                <dd className="font-semibold tabular-nums text-orange-700">{formatRupiahRinci(statement.totalDebit)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Saldo Akhir</dt>
                <dd className="font-semibold tabular-nums text-primary">{formatRupiahRinci(statement.closingBalance)}</dd>
              </div>
            </dl>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Kredit</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40">
                  <TableCell className="text-sm">{formatTanggalPendek(`${statement.period.from}T00:00:00`)}</TableCell>
                  <TableCell className="text-sm font-medium">Saldo Awal</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right font-medium tabular-nums">{formatRupiahRinci(statement.openingBalance)}</TableCell>
                </TableRow>
                {statement.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Tidak ada transaksi pada periode ini
                    </TableCell>
                  </TableRow>
                ) : (
                  statement.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatTanggalPendek(r.date)}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{TYPE_LABEL[r.type]}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.note, r.createdByName ?? (r.type === "INTEREST" ? "Sistem" : null)].filter(Boolean).join(" · ") || "-"}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${Number(r.debit) ? "text-orange-700" : "text-muted-foreground"}`}>{amountOrDash(r.debit)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${Number(r.credit) ? "text-green-700" : "text-muted-foreground"}`}>{amountOrDash(r.credit)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatRupiahRinci(r.balance)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-sm">{formatTanggalPendek(`${statement.period.to}T00:00:00`)}</TableCell>
                  <TableCell className="text-sm font-semibold">Saldo Akhir</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-orange-700">{formatRupiahRinci(statement.totalDebit)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-green-700">{formatRupiahRinci(statement.totalCredit)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiahRinci(statement.closingBalance)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
