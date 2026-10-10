import { Link } from "react-router-dom";
import type { Neraca, NeracaItem, NeracaSection } from "@siskop/types";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { CompareCells, CompareHeads } from "@/components/reports/CompareCells";
import { CompareSelect } from "@/components/reports/CompareSelect";
import { COMPARE_NONE, compareQueryParam } from "@/components/reports/compare";
import { ExportMenu } from "@/components/reports/ExportMenu";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, ReportTotalRow } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { bukuBesarHref } from "../accounting/drilldown";
import { todayLocal } from "./period";

/** The computed unclosed-SHU line has no account id, so it is matched by its name. */
const itemKey = (i: NeracaItem) => i.accountId ?? i.name;

function SectionTable({
  title,
  section,
  previous,
  subtotal,
  ledgerHref
}: {
  title: string;
  section: NeracaSection;
  /** The same section at the comparison date; its presence turns the comparison columns on. */
  previous?: NeracaSection;
  /** Link to an account's Buku Besar for this report's date and unit. */
  ledgerHref: (accountId: string) => string;
  /** Extra line above the section total, e.g. the Modal Sendiri subtotal under Ekuitas. */
  subtotal?: { label: string; amount: string };
}) {
  const before = previous ? new Map(previous.items.map((i) => [itemKey(i), i.balance])) : null;
  // Aset and Ekuitas growing is good; for Kewajiban it is neutral.
  const better = title === "Kewajiban" ? undefined : true;
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
              {before && <CompareHeads label="Pembanding" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item, i) => (
              <TableRow key={item.accountId ?? i} className={item.isHeader ? "font-semibold" : ""}>
                <TableCell className="font-mono text-xs">{item.code ?? "—"}</TableCell>
                <TableCell className={item.isComputed ? "italic text-muted-foreground" : ""} style={{ paddingLeft: `${1 + (item.level - 1) * 1.25}rem` }}>
                  {item.accountId && !item.isHeader && !item.isComputed ? (
                    <Link to={ledgerHref(item.accountId)} className="text-primary hover:underline">
                      {item.name}
                    </Link>
                  ) : (
                    item.name
                  )}
                  {item.isContra && <span className="ml-2 text-xs font-normal text-muted-foreground">(pengurang)</span>}
                  {item.isComputed && (
                    <Badge variant="secondary" className="ml-2">
                      Otomatis
                    </Badge>
                  )}
                </TableCell>
                <ReportAmount value={item.balance} />
                {before && <CompareCells current={item.balance} previous={before.get(itemKey(item))} higherIsBetter={better} />}
              </TableRow>
            ))}
            {subtotal && (
              <TableRow className="text-muted-foreground">
                <TableCell colSpan={2}>{subtotal.label}</TableCell>
                <ReportAmount value={subtotal.amount} />
                {before && <TableCell colSpan={3} />}
              </TableRow>
            )}
            {before && previous ? (
              <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell colSpan={2}>Total {title}</TableCell>
                <ReportAmount value={section.total} />
                <CompareCells current={section.total} previous={previous.total} higherIsBetter={better} />
              </TableRow>
            ) : (
              <ReportTotalRow label={`Total ${title}`} value={section.total} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function NeracaTab() {
  // "Per tanggal" reports use only `to`; `from` is kept so the filter shape matches the range reports.
  const filter = useReportFilter("neraca", () => ({ from: "", to: todayLocal(), unitId: ALL_UNITS, compare: COMPARE_NONE }));
  const { value: f } = filter;
  const report = useReport<Neraca>("Gagal memuat neraca");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `asOfDate=${f.to}${unitQueryParam(f.unitId)}`;
  const apply = () => void report.run(`/reports/regulatory/neraca?${query}${compareQueryParam(f.compare)}`);
  const data = report.data;
  const previous = data?.comparison;
  // A balance is cumulative; its ledger runs from the start of that year (opening balance first) to the report date.
  const ledgerHref = (accountId: string) =>
    bukuBesarHref(accountId, { from: `${f.to.slice(0, 4)}-01-01`, to: f.to, unitId: f.unitId });

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
        extra={
          <>
            <UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />
            <CompareSelect value={f.compare} onChange={(compare) => filter.update({ compare })} />
          </>
        }
      />

      <ReportResultCard
        reportName="Neraca"
        title="Neraca"
        subtitle={
          data
            ? [
                `Per ${formatTanggalIndonesia(data.asOfDate)}`,
                previous && `dibandingkan dengan ${formatTanggalIndonesia(previous.asOfDate)}`,
                unitLabel
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={
          data && (
            <>
              <BalanceChip balanced={data.balanced} difference={Number(data.aset.total) - Number(data.totalKewajibanDanEkuitas)} />
              <ExportMenu report="neraca" query={query} stem={`neraca-${data.asOfDate}`} pdfPath={`/reports/regulatory/neraca/pdf?${query}`} />
            </>
          )
        }
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.aset.items.length + data.kewajiban.items.length + data.ekuitas.items.length > 0}
      >
        {data && (
          <>
            <SectionTable title="Aset" section={data.aset} previous={previous?.aset} ledgerHref={ledgerHref} />
            <SectionTable title="Kewajiban" section={data.kewajiban} previous={previous?.kewajiban} ledgerHref={ledgerHref} />
            <SectionTable
              title="Ekuitas"
              section={data.ekuitas}
              previous={previous?.ekuitas}
              ledgerHref={ledgerHref}
              subtotal={{ label: "Modal Sendiri (pokok, wajib, modal tetap, cadangan, hibah)", amount: data.modalSendiri }}
            />
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm font-semibold">Total Kewajiban dan Ekuitas</p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatRupiah(data.totalKewajibanDanEkuitas)}
                  {previous && (
                    <span className="ml-3 text-xs font-normal text-muted-foreground">
                      pembanding {formatRupiah(previous.totalKewajibanDanEkuitas)}
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </ReportResultCard>
    </div>
  );
}
