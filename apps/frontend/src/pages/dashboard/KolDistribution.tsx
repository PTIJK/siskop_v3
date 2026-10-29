import type { LoanQualityDashboard } from "@siskop/types";
import { formatRupiahRingkas } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlossaryTerm } from "@/components/shared/GlossaryTerm";
import { KOL_ORDER, kolText } from "@/components/shared/KOLBadge";
import { KOL_COLORS } from "./chartColors";

/**
 * Loan quality by KOL level (design.md §2.4): five segments, each with its level
 * number inside, plus a written legend. Colour is never the only carrier.
 */
export function KolDistribution({ quality }: { quality: LoanQualityDashboard }) {
  const rows = KOL_ORDER.map((category) => quality.byKol.find((k) => k.category === category) ?? { category, count: 0, outstanding: "0" });
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const summary = rows.map((r) => `${kolText(r.category)} ${r.count} pinjaman`).join(", ");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>
          Kesehatan pinjaman menurut <GlossaryTerm term="KOL" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pinjaman aktif. Sebaran KOL muncul setelah pinjaman pertama dicairkan.</p>
        ) : (
          <>
            <div role="img" aria-label={`Sebaran pinjaman aktif: ${summary}`} className="flex h-9 overflow-hidden rounded-[10px]">
              {rows
                .filter((r) => r.count > 0)
                .map((r) => (
                  <div
                    key={r.category}
                    className="flex min-w-[28px] items-center justify-center text-[13px] font-extrabold text-background"
                    style={{ flexGrow: r.count, backgroundColor: KOL_COLORS[r.category] }}
                    title={`${kolText(r.category)}: ${r.count} pinjaman`}
                  >
                    <span aria-hidden="true">{KOL_ORDER.indexOf(r.category) + 1}</span>
                  </div>
                ))}
            </div>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {rows.map((r) => (
                <li key={r.category} className="flex items-center gap-2 text-[13px]">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: KOL_COLORS[r.category] }} />
                  <span className="flex-1 font-semibold">{kolText(r.category)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.count} · {formatRupiahRingkas(r.outstanding)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
