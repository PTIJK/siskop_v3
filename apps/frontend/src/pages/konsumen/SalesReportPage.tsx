import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Package, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { ApiRequestError } from "@/api/client";
import { getTokoSalesReport } from "@/api/konsumen";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodRangeControls } from "@/pages/reports/regulatory/PeriodRangeControls";
import { defaultPeriodFrom } from "@/pages/reports/regulatory/period";

const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Tunai",
  TRANSFER: "Transfer",
  MEMBER_CREDIT: "Kredit Anggota"
};

const MOVEMENT_LABEL: Record<string, string> = {
  IN: "Masuk",
  OUT: "Keluar",
  ADJUSTMENT: "Penyesuaian"
};

/**
 * Today as a local yyyy-MM-dd. pages/reports/regulatory/period.ts#defaultPeriodTo
 * slices toISOString() (UTC), which for a Jakarta user reads as *yesterday*
 * between 00:00 and 07:00 — and this report's `to` is an inclusive end-of-day
 * bound, so it would silently drop that morning's sales.
 */
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "2026-09-21" -> "21/09", without going through `Date` (no timezone shift). */
function shortDay(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function TrendTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.name}: {formatRupiah(p.value)}
        </p>
      ))}
    </div>
  );
}

// Laporan Toko for one Toko unit (the unit comes from the route, like
// StockPage/ProductsPage). The figures come straight from the sales rows —
// not the ledger — but agree with the Laba Rugi's Penjualan/HPP for the same
// period (apps/backend/tests/konsumen-report.test.ts holds that as a contract).
// The backend gates this on reports:read; UnitLayout only shows the tab to
// callers who have it.
export function SalesReportPage() {
  const { unitId } = useParams<{ unitId: string }>();

  // `draft` follows the date inputs; `applied` only changes on "Tampilkan", so
  // typing a date doesn't fire a request per keystroke.
  const [draft, setDraft] = useState(() => ({ from: defaultPeriodFrom(), to: todayLocal() }));
  const [applied, setApplied] = useState(draft);

  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: ["konsumen", "sales-report", unitId, applied.from, applied.to],
    queryFn: () => getTokoSalesReport({ unitId, from: applied.from, to: applied.to }),
    enabled: Boolean(unitId)
  });

  const trend = (data?.tren ?? []).map((t) => ({
    label: shortDay(t.date),
    Omzet: Number.parseFloat(t.omzet),
    "Laba kotor": Number.parseFloat(t.labaKotor)
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan Toko" description="Penjualan, laba kotor, produk terlaris, dan stok unit ini" />

      <Card>
        <CardContent className="pt-5">
          <PeriodRangeControls
            from={draft.from}
            to={draft.to}
            onFromChange={(from) => setDraft((d) => ({ ...d, from }))}
            onToChange={(to) => setDraft((d) => ({ ...d, to }))}
            onSubmit={() => setApplied(draft)}
            isLoading={isFetching}
          />
        </CardContent>
      </Card>

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat laporan toko"}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Omzet" value={formatRupiah(data.ringkasan.omzet)} icon={ShoppingCart} />
            <StatCard title="Harga Pokok (HPP)" value={formatRupiah(data.ringkasan.hpp)} icon={Package} />
            <StatCard
              title="Laba Kotor"
              value={formatRupiah(data.ringkasan.labaKotor)}
              subtitle={`Margin ${data.ringkasan.marginPercent.toLocaleString("id-ID")}%`}
              icon={TrendingUp}
              iconColor="text-green-600"
            />
            <StatCard
              title="Transaksi"
              value={data.ringkasan.transactionCount.toLocaleString("id-ID")}
              subtitle={`${data.ringkasan.itemsSold.toLocaleString("id-ID")} item terjual`}
              icon={Receipt}
            />
          </div>

          {data.ringkasan.transactionCount === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Belum ada penjualan pada periode {data.periode.from} — {data.periode.to}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tren Penjualan Harian</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
                      <Tooltip content={<TrendTooltip />} />
                      <Bar dataKey="Omzet" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Laba kotor" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Produk Terlaris</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produk</TableHead>
                          <TableHead className="text-right">Terjual</TableHead>
                          <TableHead className="text-right">Omzet</TableHead>
                          <TableHead className="text-right">Laba Kotor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.produkTerlaris.map((p) => (
                          <TableRow key={p.productId}>
                            <TableCell>
                              <span className="font-medium">{p.name}</span>
                              <span className="block font-mono text-xs text-muted-foreground">{p.sku}</span>
                            </TableCell>
                            <TableCell className="text-right">{p.quantity.toLocaleString("id-ID")}</TableCell>
                            <TableCell className="text-right">{formatRupiah(p.omzet)}</TableCell>
                            <TableCell className="text-right">{formatRupiah(p.labaKotor)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Per Metode Pembayaran</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Metode</TableHead>
                          <TableHead className="text-right">Transaksi</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.perMetodeBayar.map((m) => (
                          <TableRow key={m.paymentMethod}>
                            <TableCell>{PAYMENT_LABEL[m.paymentMethod] ?? m.paymentMethod}</TableCell>
                            <TableCell className="text-right">{m.count.toLocaleString("id-ID")}</TableCell>
                            <TableCell className="text-right">{formatRupiah(m.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Persediaan Saat Ini</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nilai persediaan</span>
                  <span className="font-semibold">{formatRupiah(data.persediaan.stockValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Produk aktif</span>
                  <span>{data.persediaan.productCount.toLocaleString("id-ID")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stok habis</span>
                  <span className={data.persediaan.outOfStockCount > 0 ? "font-semibold text-destructive" : undefined}>
                    {data.persediaan.outOfStockCount.toLocaleString("id-ID")}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Mutasi Stok (periode ini)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {data.mutasiStok.length === 0 ? (
                  <p className="text-muted-foreground">Tidak ada pergerakan stok</p>
                ) : (
                  data.mutasiStok.map((m) => (
                    <div key={m.type} className="flex justify-between">
                      <span className="text-muted-foreground">
                        {MOVEMENT_LABEL[m.type] ?? m.type} ({m.count.toLocaleString("id-ID")}x)
                      </span>
                      <span>{m.quantity.toLocaleString("id-ID")} unit</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Piutang Anggota</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-2xl font-bold tracking-tight">{formatRupiah(data.piutangAnggota)}</p>
                <p className="text-xs text-muted-foreground">
                  Kredit Anggota yang belum lunas di seluruh koperasi, bukan hanya unit ini.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
