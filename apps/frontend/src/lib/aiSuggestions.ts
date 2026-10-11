import type { CapitalDashboard, DashboardSummary, LoanQualityDashboard } from "@siskop/types";
import { formatRupiah } from "./format";

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

/** Extra dashboard data the rules can use when it has loaded; each part is optional. */
export interface SuggestionInsights {
  capital?: CapitalDashboard;
  loanQuality?: LoanQualityDashboard;
}

const TREND_MONTHS = 3;
const TREND_THRESHOLD = 0.2;
const LIQUIDITY_THRESHOLD = 0.9;
const MAX_SUGGESTIONS = 5;
/** Common prudential ceiling for non-performing loans. */
const NPL_MAX_PCT = 5;
/** Share of outstanding already "dalam perhatian" that signals the next wave of NPL. */
const KOL_WATCH_PCT = 10;
/** WOCCU PEARLS benchmark for institutional capital / total assets. */
const CAPITAL_RATIO_MIN_PCT = 10;
const BMPP_USAGE_WARN_PCT = 80;
const AUDIT_EARLY_WARN_PCT = 80;

const TONE_RANK: Record<SuggestionTone, number> = { danger: 0, warning: 1, info: 2, success: 3 };

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

/** "7.50" → "7,5" */
function percent(value: string | number): string {
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function loanQualitySuggestions(quality: LoanQualityDashboard): Suggestion[] {
  const suggestions: Suggestion[] = [];
  if (quality.nplRatio !== null && Number(quality.nplRatio) > NPL_MAX_PCT) {
    suggestions.push({
      id: "npl",
      tone: "danger",
      text: `Rasio pinjaman bermasalah (NPL) ${percent(quality.nplRatio)}% melampaui batas wajar ${NPL_MAX_PCT}%. Perketat penagihan kolektibilitas kurang lancar ke bawah dan evaluasi penyaluran pinjaman baru.`
    });
  }

  const outstanding = Number(quality.totalOutstanding);
  const watch = quality.byKol.find((k) => k.category === "DALAM_PERHATIAN");
  if (watch && outstanding > 0 && (Number(watch.outstanding) / outstanding) * 100 > KOL_WATCH_PCT) {
    suggestions.push({
      id: "kol-watch",
      tone: "warning",
      text: `${watch.count} pinjaman (${percent((Number(watch.outstanding) / outstanding) * 100)}% dari outstanding) berstatus dalam perhatian. Hubungi peminjam sebelum turun ke kurang lancar.`
    });
  }
  return suggestions;
}

function capitalSuggestions(capital: CapitalDashboard): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (capital.rasioModalSendiriAset !== null && Number(capital.rasioModalSendiriAset) < CAPITAL_RATIO_MIN_PCT) {
    suggestions.push({
      id: "capital-ratio",
      tone: "warning",
      text: `Modal sendiri hanya ${percent(capital.rasioModalSendiriAset)}% dari total aset (acuan minimal ${CAPITAL_RATIO_MIN_PCT}%). Perkuat modal lewat simpanan wajib atau penyisihan cadangan dari SHU.`
    });
  }

  const nearLimit = capital.bmpp.topBorrowers.filter((b) => b.usagePct !== null && Number(b.usagePct) >= BMPP_USAGE_WARN_PCT);
  if (nearLimit.length > 0) {
    const names = nearLimit.map((b) => `${b.memberName} (${percent(b.usagePct!)}%)`).join(", ");
    suggestions.push({
      id: "bmpp-usage",
      tone: "warning",
      text: `${nearLimit.length} peminjam sudah memakai ≥${BMPP_USAGE_WARN_PCT}% batas konsentrasi pinjaman (BMPP): ${names}. Tahan penambahan plafon untuk mereka.`
    });
  }

  if (capital.konsentrasiSimpanan.length > 0) {
    const top = capital.konsentrasiSimpanan[0]!;
    suggestions.push({
      id: "capital-concentration",
      tone: "info",
      text: `${capital.konsentrasiSimpanan.length} anggota memegang lebih dari 20% modal sendiri (tertinggi ${top.memberName}, ${percent(top.pctOfModalSendiri)}%). Permenkop UKM 8/2023 membatasi simpanan pokok+wajib per anggota maksimal 20%.`
    });
  }

  if (capital.audit.applies && capital.audit.reached) {
    suggestions.push({
      id: "audit-required",
      tone: "info",
      text: `Modal sendiri ${formatRupiah(capital.modalSendiri)} telah mencapai ambang ${formatRupiah(capital.audit.threshold)} — laporan keuangan tahunan wajib diaudit akuntan publik terdaftar. Siapkan penunjukan KAP.`
    });
  } else if (capital.audit.applies && Number(capital.audit.progressPct) >= AUDIT_EARLY_WARN_PCT) {
    suggestions.push({
      id: "audit-approaching",
      tone: "info",
      text: `Modal sendiri sudah ${percent(capital.audit.progressPct)}% dari ambang audit wajib ${formatRupiah(capital.audit.threshold)}. Mulai siapkan anggaran audit akuntan publik.`
    });
  }
  return suggestions;
}

/**
 * Rule-based dashboard insights derived from data already loaded on screen.
 * `insights` is optional: until the capital / loan-quality data arrives (or
 * if it fails), the original summary-and-trend rules run on their own.
 */
export function buildAiSuggestions(
  summary: DashboardSummary | undefined,
  loanChart: ChartPointNumeric[],
  paymentChart: ChartPointNumeric[],
  insights: SuggestionInsights = {}
): Suggestion[] {
  if (!summary) return [];

  const suggestions: Suggestion[] = [];
  // Liquidity is judged against what members can actually withdraw: simpanan
  // pokok/wajib are equity, locked in while the member stays.
  const withdrawable = parseFloat(summary.savingsLiability ?? summary.totalSavings);
  const totalActiveLoans = parseFloat(summary.totalActiveLoans);

  if (summary.overdueCount > 0) {
    suggestions.push({
      id: "overdue",
      tone: "danger",
      text: `${summary.overdueCount} pinjaman berstatus MACET. Prioritaskan penagihan segera untuk mencegah kerugian bertambah.`
    });
  }

  if (withdrawable > 0 && totalActiveLoans > withdrawable * LIQUIDITY_THRESHOLD) {
    suggestions.push({
      id: "liquidity",
      tone: "warning",
      text: `Pinjaman aktif (${formatRupiah(totalActiveLoans)}) mendekati atau melebihi simpanan yang bisa ditarik anggota (${formatRupiah(
        withdrawable
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

  if (insights.loanQuality) suggestions.push(...loanQualitySuggestions(insights.loanQuality));
  if (insights.capital) suggestions.push(...capitalSuggestions(insights.capital));

  if (suggestions.length === 0) {
    suggestions.push({
      id: "healthy",
      tone: "success",
      text: "Tidak ada indikasi risiko signifikan dari data saat ini. Kondisi operasional koperasi terlihat stabil."
    });
  }

  // Stable sort: within a tone, rules keep the order they were written in.
  return [...suggestions].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]).slice(0, MAX_SUGGESTIONS);
}
