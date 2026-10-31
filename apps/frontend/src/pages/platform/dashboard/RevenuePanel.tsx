import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RevenueSummary } from "@siskop/types";
import { formatAngkaRingkas, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bucketLabel, deltaLabel } from "./dashboardView";

export function RevenuePanel({ revenue }: { revenue: RevenueSummary }) {
  const data = revenue.series.map((p) => ({ label: bucketLabel(p.month), amount: Number(p.amount) }));
  const total = data.reduce((sum, p) => sum + p.amount, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pertumbuhan revenue</CardTitle>
        <p className="text-xs text-muted-foreground">Pembayaran faktur langganan yang lunas, 12 bulan terakhir</p>
        <p className="pt-1 text-lg font-bold tabular-nums">
          {formatRupiah(Number(revenue.thisMonth))}
          <span className="ml-2 text-xs font-semibold text-muted-foreground">{deltaLabel(revenue.deltaPct)}</span>
        </p>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Belum ada pembayaran tercatat.</p>
        ) : (
          <div role="img" aria-label={`Revenue bulan ini ${formatRupiah(Number(revenue.thisMonth))}, ${deltaLabel(revenue.deltaPct)}`} className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v: number) => formatAngkaRingkas(v)} />
                <Tooltip formatter={(v) => formatRupiah(Number(v))} />
                <Bar dataKey="amount" name="Revenue" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">MRR saat ini: {formatRupiah(Number(revenue.mrr))}</p>
      </CardContent>
    </Card>
  );
}
