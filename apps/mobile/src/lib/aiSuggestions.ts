import type { DashboardSummary } from "@siskop/types";
import { formatRupiah } from "./format";

// Ported verbatim from apps/frontend/src/lib/aiSuggestions.ts (FR-MOB-DASH-03,
// docs/06-PRD-SISKOP-Mobile-Version.md §7) — rule-based, computed client-side
// from data the dashboard already fetches. No LLM/extra API call involved
// despite the "AI" label; safe/cheap to reuse as-is.
export type SuggestionTone = "danger" | "warning" | "info" | "success";

export interface Suggestion {
  id: string;
  tone: SuggestionTone;
  text: string;
}

interface ChartPointNumeric {
  month: string;
  value: number;
}

const TREND_MONTHS = 3;
const TREND_THRESHOLD = 0.2;
const LIQUIDITY_THRESHOLD = 0.9;

function average(points: ChartPointNumeric[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}

function trendChange(points: ChartPointNumeric[]): number | null {
  if (points.length < TREND_MONTHS * 2) return null;
  const recent = average(points.slice(-TREND_MONTHS));
  const prior = average(points.slice(-TREND_MONTHS * 2, -TREND_MONTHS));
  if (prior <= 0) return null;
  return (recent - prior) / prior;
}

export function buildAiSuggestions(
  summary: DashboardSummary | undefined,
  loanChart: ChartPointNumeric[],
  paymentChart: ChartPointNumeric[]
): Suggestion[] {
  if (!summary) return [];

  const suggestions: Suggestion[] = [];
  const totalSavings = parseFloat(summary.totalSavings);
  const totalActiveLoans = parseFloat(summary.totalActiveLoans);

  if (summary.overdueCount > 0) {
    suggestions.push({
      id: "overdue",
      tone: "danger",
      text: `${summary.overdueCount} pinjaman berstatus MACET. Prioritaskan penagihan segera untuk mencegah kerugian bertambah.`
    });
  }

  if (totalSavings > 0 && totalActiveLoans > totalSavings * LIQUIDITY_THRESHOLD) {
    suggestions.push({
      id: "liquidity",
      tone: "warning",
      text: `Pinjaman aktif (${formatRupiah(totalActiveLoans)}) mendekati atau melebihi total simpanan (${formatRupiah(
        totalSavings
      )}). Pertimbangkan memperketat plafon pinjaman baru atau menggalang simpanan tambahan.`
    });
  }

  const loanTrend = trendChange(loanChart);
  if (loanTrend !== null && loanTrend >= TREND_THRESHOLD) {
    suggestions.push({
      id: "loan-trend-up",
      tone: "info",
      text: `Pencairan pinjaman naik ${Math.round(loanTrend * 100)}% dibanding 3 bulan sebelumnya. Pastikan likuiditas kas mencukupi untuk permintaan berikutnya.`
    });
  } else if (loanTrend !== null && loanTrend <= -TREND_THRESHOLD) {
    suggestions.push({
      id: "loan-trend-down",
      tone: "info",
      text: `Pencairan pinjaman turun ${Math.round(Math.abs(loanTrend) * 100)}% dibanding 3 bulan sebelumnya. Evaluasi apakah diperlukan promosi produk pinjaman.`
    });
  }

  const paymentTrend = trendChange(paymentChart);
  if (paymentTrend !== null && paymentTrend <= -TREND_THRESHOLD) {
    suggestions.push({
      id: "payment-trend-down",
      tone: "warning",
      text: `Penerimaan angsuran turun ${Math.round(Math.abs(paymentTrend) * 100)}% dibanding 3 bulan sebelumnya. Periksa kemungkinan peningkatan risiko kredit macet.`
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: "healthy",
      tone: "success",
      text: "Tidak ada indikasi risiko signifikan dari data saat ini. Kondisi operasional koperasi terlihat stabil."
    });
  }

  return suggestions.slice(0, 4);
}
