import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
}

interface LinePanelProps {
  title: string;
  description: string;
  /** Each row needs a `label` for the x axis plus one numeric (or null) field per series key. */
  data: object[];
  series: LineSeries[];
  /** Shown instead of the chart when true (for example, no telemetry yet). */
  empty?: string | undefined;
  formatValue?: (n: number) => string;
}

function summarize(data: LinePanelProps["data"], series: LineSeries[]): string {
  const rows = data as Record<string, string | number | null>[];
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return "Belum ada data.";
  return series.map((s) => `${s.name}: dari ${first[s.key] ?? 0} pada ${first.label} menjadi ${last[s.key] ?? 0} pada ${last.label}`).join(". ");
}

export function LinePanel({ title, description, data, series, empty, formatValue = (n) => n.toLocaleString("id-ID") }: LinePanelProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div role="img" aria-label={`${title}. ${summarize(data, series)}`} className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatValue(v)} allowDecimals={false} />
                <Tooltip formatter={(v) => formatValue(Number(v))} />
                {series.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "5 4" : undefined}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {!empty && series.length > 1 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
