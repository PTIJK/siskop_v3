import { useEffect, useState } from "react";
import type { PerubahanEkuitas } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { ALL_UNITS, unitQueryParam } from "./unit";
import { UnitFilter } from "./UnitFilter";

/** Pengurangan arrives as a positive amount; shown negated so each column reads top to bottom. */
function signed(rowKey: string, value: string): string {
  return rowKey === "PENGURANGAN" && Number(value) !== 0 ? `(${formatRupiah(value)})` : formatRupiah(value);
}

export function PerubahanEkuitasTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [unitId, setUnitId] = useState(ALL_UNITS);
  const [data, setData] = useState<PerubahanEkuitas | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<PerubahanEkuitas>(
        `/reports/regulatory/perubahan-ekuitas?from=${from}&to=${to}${unitQueryParam(unitId)}`
      );
      setData(result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat laporan perubahan ekuitas", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchReport();
  }, []);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <PeriodRangeControls
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
            onSubmit={fetchReport}
            isLoading={isLoading}
            extra={<UnitFilter value={unitId} onChange={setUnitId} />}
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : data ? (
        <>
          <p className="text-sm text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>
          <Card>
            <CardContent className="pt-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">Keterangan</TableHead>
                    {data.columns.map((c) => (
                      <TableHead key={c.key} className="min-w-32 text-right">
                        {c.label}
                      </TableHead>
                    ))}
                    <TableHead className="min-w-32 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => {
                    const emphasis = row.key === "SALDO_AWAL" || row.key === "SALDO_AKHIR" ? "font-semibold" : "";
                    return (
                      <TableRow key={row.key} className={emphasis}>
                        <TableCell>{row.label}</TableCell>
                        {data.columns.map((c) => (
                          <TableCell key={c.key} className="text-right tabular-nums">
                            {signed(row.key, row.values[c.key] ?? "0")}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">{signed(row.key, row.total)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Modal Sendiri (Permenkop UKM 8/2023)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Awal periode</span>
                <span className="tabular-nums">{formatRupiah(data.modalSendiri.awal)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Akhir periode</span>
                <span className="tabular-nums">{formatRupiah(data.modalSendiri.akhir)}</span>
              </div>
              {Number(data.modalSendiri.penyesuaianSaldoAwal) !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Termasuk penyesuaian saldo awal di luar buku besar sebesar{" "}
                  {formatRupiah(data.modalSendiri.penyesuaianSaldoAwal)}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Simpanan pokok, simpanan wajib, modal tetap, cadangan, dan hibah. Modal penyertaan dan SHU tidak termasuk.
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">Pilih periode dan klik &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
