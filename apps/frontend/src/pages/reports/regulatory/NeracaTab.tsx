import type { Neraca, NeracaSection } from "@siskop/types";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { PrintButton } from "@/components/reports/PrintButton";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, ReportTotalRow } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { todayLocal } from "./period";

function SectionTable({
  title,
  section,
  subtotal
}: {
  title: string;
  section: NeracaSection;
  /** Extra line above the section total, e.g. the Modal Sendiri subtotal under Ekuitas. */
  subtotal?: { label: string; amount: string };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Akun</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item, i) => (
              <TableRow key={item.accountId ?? i} className={item.isHeader ? "font-semibold" : ""}>
                <TableCell className="font-mono text-xs">{item.code ?? "—"}</TableCell>
                <TableCell className={item.isComputed ? "italic text-muted-foreground" : ""} style={{ paddingLeft: `${1 + (item.level - 1) * 1.25}rem` }}>
                  {item.name}
                  {item.isContra && <span className="ml-2 text-xs font-normal text-muted-foreground">(pengurang)</span>}
                  {item.isComputed && (
                    <Badge variant="secondary" className="ml-2">
                      Otomatis
                    </Badge>
                  )}
                </TableCell>
                <ReportAmount value={item.balance} />
              </TableRow>
            ))}
            {subtotal && (
              <TableRow className="text-muted-foreground">
                <TableCell colSpan={2}>{subtotal.label}</TableCell>
                <ReportAmount value={subtotal.amount} />
              </TableRow>
            )}
            <ReportTotalRow label={`Total ${title}`} value={section.total} />
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function NeracaTab() {
  // "Per tanggal" reports use only `to`; `from` is kept so the filter shape matches the range reports.
  const filter = useReportFilter("neraca", () => ({ from: "", to: todayLocal(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const report = useReport<Neraca>("Gagal memuat neraca");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `asOfDate=${f.to}${unitQueryParam(f.unitId)}`;
  const apply = () => void report.run(`/reports/regulatory/neraca?${query}`);
  const data = report.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="neraca"
        mode="asOf"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={apply}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />}
      />

      <ReportResultCard
        reportName="Neraca"
        title="Neraca"
        subtitle={data ? [`Per ${formatTanggalIndonesia(data.asOfDate)}`, unitLabel].filter(Boolean).join(" · ") : undefined}
        actions={
          data && (
            <>
              <BalanceChip balanced={data.balanced} difference={Number(data.aset.total) - Number(data.totalKewajibanDanEkuitas)} />
              <PrintButton path={`/reports/regulatory/neraca/pdf?${query}`} filename={`neraca-${data.asOfDate}.pdf`} />
            </>
          )
        }
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.aset.items.length + data.kewajiban.items.length + data.ekuitas.items.length > 0}
      >
        {data && (
          <>
            <SectionTable title="Aset" section={data.aset} />
            <SectionTable title="Kewajiban" section={data.kewajiban} />
            <SectionTable
              title="Ekuitas"
              section={data.ekuitas}
              subtotal={{ label: "Modal Sendiri (pokok, wajib, modal tetap, cadangan, hibah)", amount: data.modalSendiri }}
            />
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm font-semibold">Total Kewajiban dan Ekuitas</p>
                <p className="text-sm font-semibold tabular-nums">{formatRupiah(data.totalKewajibanDanEkuitas)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </ReportResultCard>
    </div>
  );
}
