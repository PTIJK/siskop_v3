import { useId, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAngkaRingkas, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  /** Solid for the first series, dashed for the next: not colour alone. */
  dashed?: boolean;
}

interface TrendChartProps {
  title: string;
  description: string;
  data: { month: string; [key: string]: number | string }[];
  series: TrendSeries[];
  height?: number;
}

function summarize(data: TrendChartProps["data"], series: TrendSeries[]): string {
  if (data.length === 0) return "Belum ada data.";
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) return "Belum ada data.";
  return series
    .map((s) => `${s.name}: dari ${formatRupiah(Number(first[s.key] ?? 0))} pada ${first.month} menjadi ${formatRupiah(Number(last[s.key] ?? 0))} pada ${last.month}`)
    .join(". ");
}

function Tip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border bg-card px-3 py-2 shadow-md">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-[13px] font-bold tabular-nums">
          <span className="font-semibold text-muted-foreground">{p.name}: </span>
          {formatRupiah(p.value)}
        </p>
      ))}
    </div>
  );
}

/**
 * Line chart with direct labels at the line ends instead of a legend, solid vs
 * dashed series, a spoken summary, and a "Lihat sebagai tabel" fallback (design.md §9.8).
 */
export function TrendChart({ title, description, data, series, height = 220 }: TrendChartProps) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          aria-controls={tableId}
          onClick={() => setAsTable((v) => !v)}
          className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {asTable ? "Lihat sebagai grafik" : "Lihat sebagai tabel"}
        </button>
      </CardHeader>
      <CardContent id={tableId}>
        {asTable ? (
          <Table aria-label={title} containerClassName="max-h-[260px] overflow-auto">
            <TableHeader>
              <TableRow>
                <TableHead>Bulan</TableHead>
                {series.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.month}>
                  <TableCell>{row.month}</TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} className="text-right tabular-nums">
                      {formatRupiah(Number(row[s.key] ?? 0))}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div role="img" aria-label={`${title}. ${summarize(data, series)}`}>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart data={data} margin={{ top: 8, right: 76, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tickFormatter={formatAngkaRingkas} tick={{ fontSize: 11 }} width={52} tickLine={false} axisLine={false} />
                <Tooltip content={<Tip />} />
                {series.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2.25}
                    strokeDasharray={s.dashed ? "6 4" : undefined}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                    label={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) =>
                      index === data.length - 1 && x !== undefined && y !== undefined ? (
                        <text key={s.key} x={Number(x) + 8} y={Number(y) + 4} fontSize={12} fontWeight={700} fill="currentColor" className="text-foreground">
                          {s.name}
                        </text>
                      ) : (
                        <g key={`${s.key}-${index}`} />
                      )
                    }
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
