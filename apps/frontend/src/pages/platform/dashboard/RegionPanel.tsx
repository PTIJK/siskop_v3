import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RegionRow } from "@siskop/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { topRegions } from "./dashboardView";

const METRICS = [
  { key: "users", label: "Pengguna" },
  { key: "members", label: "Anggota" },
  { key: "tenants", label: "Koperasi" }
] as const;

export function RegionPanel({ regions }: { regions: RegionRow[] }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("users");
  const rows = topRegions(regions, 10);
  const label = METRICS.find((m) => m.key === metric)?.label ?? "";
  const height = Math.max(220, rows.length * 28 + 32);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sebaran wilayah</CardTitle>
        <p className="text-xs text-muted-foreground">Berdasarkan provinsi koperasi</p>
        <div className="flex gap-1 pt-2" role="group" aria-label="Ukuran sebaran">
          {METRICS.map((m) => (
            <Button key={m.key} size="sm" variant={metric === m.key ? "default" : "outline"} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>
              {m.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Belum ada koperasi.</p>
        ) : (
          <div role="img" aria-label={`Sebaran ${label} per provinsi: ${rows.map((r) => `${r.name} ${r[metric]}`).join(", ")}`} style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => Number(v).toLocaleString("id-ID")} />
                <Bar dataKey={metric} name={label} fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
