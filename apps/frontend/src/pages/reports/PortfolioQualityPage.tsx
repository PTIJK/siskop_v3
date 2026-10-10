import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Landmark, Percent, Wallet } from "lucide-react";
import {
  PAR_BUCKET_LABEL,
  type CollectionEfficiency,
  type KOLCategory,
  type ParBucket,
  type ParLoanRow,
  type PortfolioPar
} from "@siskop/types";
import { apiFetch, apiFetchPage } from "@/api/client";
import { formatPeriode, formatPercent, formatRupiahOrDash, formatRupiahSingkat } from "@/lib/format";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { StatCard } from "@/components/shared/StatCard";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportPager } from "@/components/reports/ReportPager";
import { ReportResultCard } from "@/components/reports/ReportResultCard";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { STATUS } from "@/pages/dashboard/chartColors";
import { defaultPeriodFrom, defaultPeriodTo } from "./regulatory/period";

const LIMIT = 15;

/** Status colour per bucket: green when nothing is overdue, amber while arrears are young, red once they are serious. */
const BUCKET_COLOR: Record<ParBucket, string> = {
  CURRENT: STATUS.good,
  D1_30: STATUS.warning,
  D31_60: STATUS.warning,
  D61_90: STATUS.critical,
  D90_PLUS: STATUS.critical
};

function BucketTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; value: number; loans: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{p.label}</p>
      <p>{formatRupiahOrDash(p.value)}</p>
      <p className="text-muted-foreground">{p.loans} pinjaman</p>
    </div>
  );
}

function LoansInBucket({ bucket, unitId, onClose }: { bucket: ParBucket; unitId: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isPending } = useQuery({
    queryKey: ["portfolio", "par-loans", bucket, unitId, page],
    queryFn: () => apiFetchPage<ParLoanRow[]>(`/reports/portfolio/par/loans?bucket=${bucket}&page=${page}&limit=${LIMIT}${unitQueryParam(unitId)}`)
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Pinjaman: {PAR_BUCKET_LABEL[bucket]}</CardTitle>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onClose}>
          Tutup
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anggota</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Hari menunggak</TableHead>
                  <TableHead>Kolektibilitas</TableHead>
                  <TableHead className="text-right">Pokok tersisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((l) => (
                  <TableRow key={l.loanId}>
                    <TableCell>
                      <Link to={`/loans/${l.loanId}`} className="text-primary hover:underline">
                        {l.memberName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{l.memberCode}</span>
                    </TableCell>
                    <TableCell>{l.loanConfigName}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.daysOverdue}</TableCell>
                    <TableCell>
                      <KOLBadge category={l.kolCategory as KOLCategory} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiahOrDash(l.outstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ReportPager page={page} limit={LIMIT} total={data?.meta.total ?? 0} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EfficiencySection() {
  const filter = useReportFilter("portfolio-efficiency", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const report = useReport<CollectionEfficiency>("Gagal memuat efisiensi penagihan");
  const data = report.data;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Efisiensi Penagihan</h2>
      <ReportFilterCard
        reportName="efisiensi penagihan"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/portfolio/collection-efficiency?from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />}
      />
      <ReportResultCard
        reportName="Efisiensi Penagihan"
        title="Hasil periode"
        subtitle={data ? formatPeriode(data.periode.from, data.periode.to) : undefined}
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data}
      >
        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Efisiensi" value={formatPercent(data.efficiency)} subtitle="dibayar / jatuh tempo" icon={Percent} />
              <StatCard title="Jatuh tempo" value={formatRupiahOrDash(data.amountDue)} subtitle={`${data.installmentsDue} angsuran`} icon={Landmark} />
              <StatCard title="Terbayar atas jatuh tempo" value={formatRupiahOrDash(data.paidOnDue)} icon={Wallet} />
              <StatCard title="Kas diterima di periode" value={formatRupiahOrDash(data.cashCollected)} subtitle="termasuk tunggakan lama" icon={Wallet} />
            </div>
            {data.efficiency === null && <p className="text-sm text-muted-foreground">Tidak ada angsuran yang jatuh tempo pada periode ini.</p>}
            {data.loansWithoutSchedule > 0 && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {data.loansWithoutSchedule} pinjaman aktif belum memiliki jadwal angsuran dan tidak ikut dihitung.
              </p>
            )}
          </>
        )}
      </ReportResultCard>
    </div>
  );
}

export function PortfolioQualityPage() {
  const [unitId, setUnitId] = useState(ALL_UNITS);
  const [openBucket, setOpenBucket] = useState<ParBucket | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["portfolio", "par", unitId],
    queryFn: () => apiFetch<PortfolioPar>(`/reports/portfolio/par?${unitQueryParam(unitId).replace(/^&/, "")}`)
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kualitas Portofolio"
        description="Pinjaman beredar menurut umur tunggakan (PAR), rasio NPL, dan efisiensi penagihan"
        actions={<UnitFilter value={unitId} onChange={setUnitId} />}
      />

      {isPending ? (
        <PageLoading />
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Gagal memuat kualitas portofolio.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Pinjaman beredar" value={formatRupiahSingkat(data.totalOutstanding)} subtitle={`${data.loans} pinjaman aktif`} icon={Landmark} />
            <StatCard title="PAR > 30 hari" value={formatPercent(data.ratios.par30)} subtitle="pokok menunggak lebih dari 30 hari" icon={AlertTriangle} />
            <StatCard title="NPL (> 90 hari)" value={formatPercent(data.nplRatio)} subtitle="Kurang Lancar, Diragukan, Macet" icon={AlertTriangle} />
            <StatCard title="PAR > 0 hari" value={formatPercent(data.ratios.par1)} subtitle="semua pokok yang menunggak" icon={Percent} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pokok pinjaman menurut umur tunggakan</CardTitle>
              <p className="text-xs text-muted-foreground">Per {data.asOf}, sesuai perhitungan kolektibilitas harian terakhir. Klik baris untuk melihat pinjamannya.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.buckets.map((b) => ({ label: PAR_BUCKET_LABEL[b.bucket], value: Number(b.outstanding), loans: b.loans, bucket: b.bucket }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
                  <Tooltip content={<BucketTooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {data.buckets.map((b) => (
                      <Cell key={b.bucket} fill={BUCKET_COLOR[b.bucket]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Umur tunggakan</TableHead>
                    <TableHead className="text-right">Pinjaman</TableHead>
                    <TableHead className="text-right">Pokok tersisa</TableHead>
                    <TableHead className="text-right">Porsi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.buckets.map((b) => (
                    <TableRow
                      key={b.bucket}
                      className={cn(b.loans > 0 && "cursor-pointer", openBucket === b.bucket && "bg-muted/50")}
                      onClick={() => b.loans > 0 && setOpenBucket(openBucket === b.bucket ? null : b.bucket)}
                    >
                      <TableCell>
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: BUCKET_COLOR[b.bucket] }} />
                        {PAR_BUCKET_LABEL[b.bucket]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.loans}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiahOrDash(b.outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(b.share)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{data.loans}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiahOrDash(data.totalOutstanding)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {openBucket && <LoansInBucket key={`${openBucket}-${unitId}`} bucket={openBucket} unitId={unitId} onClose={() => setOpenBucket(null)} />}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Menurut produk pinjaman</CardTitle>
            </CardHeader>
            <CardContent>
              {data.byProduct.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pinjaman aktif.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="text-right">Pinjaman</TableHead>
                      <TableHead className="text-right">Pokok tersisa</TableHead>
                      <TableHead className="text-right">PAR &gt; 30</TableHead>
                      <TableHead className="text-right">PAR &gt; 90</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byProduct.map((p) => (
                      <TableRow key={p.loanConfigId}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.loans}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiahOrDash(p.outstanding)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(p.par30)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(p.par90)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <EfficiencySection />
    </div>
  );
}
