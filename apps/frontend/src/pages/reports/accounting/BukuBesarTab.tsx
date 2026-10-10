import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { BukuBesarAccount, TrialBalance, TrialBalanceRow } from "@siskop/types";
import { formatPeriode, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportPager } from "@/components/reports/ReportPager";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, STICKY_HEAD, STICKY_TABLE_CONTAINER } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "../regulatory/period";
import { TrialBalanceTableRow } from "./TrialBalanceTable";

const LIMIT = 50;

/** Buku Besar: the overview of accounts with activity; clicking an account opens its ledger with a running balance. */
export function BukuBesarTab() {
  const filter = useReportFilter("buku-besar", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const overview = useReport<TrialBalance>("Gagal memuat buku besar");
  const ledger = useReport<BukuBesarAccount>("Gagal memuat buku besar akun");
  const unitLabel = useUnitLabel(f.unitId);
  const [openAccount, setOpenAccount] = useState<TrialBalanceRow | null>(null);
  const [page, setPage] = useState(1);

  const query = `from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`;
  const loadLedger = (account: TrialBalanceRow, nextPage: number) => {
    setOpenAccount(account);
    setPage(nextPage);
    void ledger.run(`/reports/accounting/buku-besar/${account.accountId}?${query}&page=${nextPage}&limit=${LIMIT}`);
  };
  const closeLedger = () => {
    setOpenAccount(null);
    ledger.clear();
  };

  const data = overview.data;
  const detail = ledger.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="buku besar"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => {
          closeLedger();
          void overview.run(`/reports/accounting/buku-besar?${query}`);
        }}
        onReset={() => {
          filter.reset();
          overview.clear();
          closeLedger();
        }}
        isLoading={overview.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} includeUnallocated />}
      />

      {openAccount ? (
        <ReportResultCard
          reportName="Buku Besar Akun"
          title={`Buku Besar: ${openAccount.code} ${openAccount.name}`}
          subtitle={detail ? [formatPeriode(detail.periode.from, detail.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
          actions={
            <Button variant="outline" size="sm" onClick={closeLedger}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Semua akun
            </Button>
          }
          isLoading={ledger.isLoading}
          hasRun={ledger.hasRun}
          hasData
        >
          {detail && (
            <Card>
              <CardContent className="space-y-3 pt-5">
                <Table containerClassName={STICKY_TABLE_CONTAINER}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`w-16 ${STICKY_HEAD}`}>No</TableHead>
                      <TableHead className={STICKY_HEAD}>Tanggal</TableHead>
                      <TableHead className={STICKY_HEAD}>Keterangan</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Debit</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Kredit</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ledger.meta.page ?? 1) === 1 && (
                      <TableRow className="bg-muted/30 font-medium hover:bg-muted/30">
                        <TableCell colSpan={5}>Saldo awal</TableCell>
                        <ReportAmount value={detail.saldoAwal} />
                      </TableRow>
                    )}
                    {detail.lines.map((l) => (
                      <TableRow key={l.lineId}>
                        <TableCell className="tabular-nums">{l.entryNo ?? "-"}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatTanggalPendek(l.entryDate)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {l.description}
                          {l.entryType !== "UMUM" && (
                            <Badge variant="secondary" className="ml-2">
                              {l.entryType === "PENYESUAIAN" ? "Penyesuaian" : "Penutup"}
                            </Badge>
                          )}
                        </TableCell>
                        <ReportAmount value={l.debit} />
                        <ReportAmount value={l.credit} />
                        <ReportAmount value={l.saldo} className="font-medium" />
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                      <TableCell colSpan={3}>Total periode / saldo akhir</TableCell>
                      <ReportAmount value={detail.totalDebit} />
                      <ReportAmount value={detail.totalCredit} />
                      <ReportAmount value={detail.saldoAkhir} />
                    </TableRow>
                  </TableBody>
                </Table>
                <ReportPager
                  page={page}
                  limit={LIMIT}
                  total={ledger.meta.total ?? detail.lines.length}
                  onPage={(p) => loadLedger(openAccount, p)}
                  disabled={ledger.isLoading}
                />
              </CardContent>
            </Card>
          )}
        </ReportResultCard>
      ) : (
        <ReportResultCard
          reportName="Buku Besar"
          title="Buku Besar"
          subtitle={data ? [formatPeriode(data.periode.from, data.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
          isLoading={overview.isLoading}
          hasRun={overview.hasRun}
          hasData={!!data && data.rows.length > 0}
        >
          {data && (
            <Card>
              <CardContent className="pt-5">
                <Table containerClassName={STICKY_TABLE_CONTAINER}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`w-24 ${STICKY_HEAD}`}>Kode</TableHead>
                      <TableHead className={STICKY_HEAD}>Nama Akun (klik untuk buku besar akun)</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Saldo Awal</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Debit</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Kredit</TableHead>
                      <TableHead className={`text-right ${STICKY_HEAD}`}>Saldo Akhir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TrialBalanceTableRow key={r.accountId} row={r} onOpen={(row) => loadLedger(row, 1)} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </ReportResultCard>
      )}
    </div>
  );
}
