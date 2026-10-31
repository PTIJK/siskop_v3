import type { PlatformDashboard } from "@siskop/types";
import { formatAngkaRingkas, formatRupiah } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCards({ kpis }: { kpis: PlatformDashboard["kpis"] }) {
  const items = [
    { label: "Koperasi", value: kpis.tenants.toLocaleString("id-ID") },
    { label: "Pengguna staf", value: kpis.users.toLocaleString("id-ID") },
    { label: "Anggota", value: kpis.members.toLocaleString("id-ID") },
    { label: "MRR", value: formatRupiah(Number(kpis.mrr)), hint: formatAngkaRingkas(Number(kpis.mrr)) }
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
