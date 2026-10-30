import type { CapitalDashboard, DashboardSummary, LoanQualityDashboard, PasarDashboard, TenantSubscriptionInfo } from "@siskop/types";
import { formatTanggalPendek } from "@/lib/format";

export type AttentionTone = "bad" | "warn" | "info";

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  /** The number the card leads with. */
  count: number;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
}

/** Everything the panel can use. A missing source (not loaded, no permission, not in the package) is simply left out. */
export interface AttentionInput {
  summary?: DashboardSummary;
  quality?: LoanQualityDashboard;
  capital?: CapitalDashboard;
  pasar?: PasarDashboard;
  subscription?: TenantSubscriptionInfo | null;
  /** Self-registrations waiting for review; undefined when the caller may not see them or it has not loaded. */
  pendingRegistrations?: number;
  canSeeLoans: boolean;
  /** Where a link goes: the page itself, or Langganan when the package locks it. */
  route: (href: string, feature?: string) => string;
}

const CAPITAL_RATIO_MIN_PCT = 10;
const TONE_RANK: Record<AttentionTone, number> = { bad: 0, warn: 1, info: 2 };

function pct(value: string | null): string {
  return value === null ? "" : Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

/**
 * "Perlu perhatian hari ini": only real figures the API already returns, ordered
 * by risk (design.md §10). Nothing here is invented; a task appears only when
 * its number is above zero.
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.canSeeLoans && input.summary && input.summary.overdueCount > 0) {
    items.push({
      id: "macet",
      tone: "bad",
      count: input.summary.overdueCount,
      title: "Pinjaman macet",
      detail: `${input.summary.overdueCount} pinjaman berstatus KOL 5 Macet. Hubungi peminjam atau tinjau penyelesaiannya.`,
      actionLabel: "Lihat anggota menunggak",
      to: "/loans/overdue"
    });
  }

  if (input.canSeeLoans && input.quality) {
    const watch = input.quality.byKol
      .filter((k) => k.category === "DALAM_PERHATIAN" || k.category === "KURANG_LANCAR" || k.category === "DIRAGUKAN")
      .reduce((sum, k) => sum + k.count, 0);
    if (watch > 0) {
      const npl = input.quality.nplRatio !== null ? ` Rasio NPL saat ini ${pct(input.quality.nplRatio)}%.` : "";
      items.push({
        id: "mulai-terlambat",
        tone: "warn",
        count: watch,
        title: "Pinjaman mulai terlambat",
        detail: `${watch} pinjaman berstatus KOL 2 sampai 4. Tindak lanjuti sebelum turun ke macet.${npl}`,
        actionLabel: "Lihat kualitas portofolio",
        to: input.route("/reports/portfolio", "portfolio_quality")
      });
    }
  }

  if (input.pendingRegistrations !== undefined && input.pendingRegistrations > 0) {
    items.push({
      id: "pendaftaran",
      tone: "info",
      count: input.pendingRegistrations,
      title: "Pendaftaran anggota menunggu",
      detail: `${input.pendingRegistrations} pendaftaran mandiri belum ditinjau. Periksa KTP lalu setujui atau tolak.`,
      actionLabel: "Tinjau pendaftaran",
      to: "/members"
    });
  }

  if (input.pasar && input.pasar.batchBelumDiverifikasi > 0) {
    items.push({
      id: "batch-pasar",
      tone: "warn",
      count: input.pasar.batchBelumDiverifikasi,
      title: "Setoran kolektor belum diverifikasi",
      detail: `${input.pasar.batchBelumDiverifikasi} batch setoran sudah diserahkan dan menunggu diverifikasi.`,
      actionLabel: "Buka laporan pasar",
      to: input.route("/reports/pasar", "reports_market")
    });
  }

  if (input.subscription?.openInvoice) {
    const invoice = input.subscription.openInvoice;
    items.push({
      id: "tagihan",
      tone: input.subscription.status === "PAST_DUE" ? "bad" : "warn",
      count: 1,
      title: "Tagihan langganan belum dibayar",
      detail: `Faktur ${invoice.number} jatuh tempo ${formatTanggalPendek(invoice.dueDate)}.`,
      actionLabel: "Lihat tagihan",
      to: "/langganan"
    });
  }

  if (input.capital) {
    const ratio = input.capital.rasioModalSendiriAset;
    if (ratio !== null && Number(ratio) < CAPITAL_RATIO_MIN_PCT) {
      items.push({
        id: "modal",
        tone: "warn",
        count: 1,
        title: "Rasio modal sendiri rendah",
        detail: `Modal sendiri ${pct(ratio)}% dari total aset, di bawah acuan ${CAPITAL_RATIO_MIN_PCT}%.`,
        actionLabel: "Lihat laporan regulasi",
        to: input.route("/reports/regulatory", "reports_regulatory")
      });
    }
    if (input.capital.konsentrasiSimpanan.length > 0) {
      items.push({
        id: "konsentrasi",
        tone: "warn",
        count: input.capital.konsentrasiSimpanan.length,
        title: "Simpanan terlalu terpusat",
        detail: `${input.capital.konsentrasiSimpanan.length} anggota memiliki simpanan pokok dan wajib di atas 20% modal sendiri.`,
        actionLabel: "Lihat laporan regulasi",
        to: input.route("/reports/regulatory", "reports_regulatory")
      });
    }
  }

  // Stable sort by risk, keeping the order above within a tone.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] || a.index - b.index)
    .map(({ item }) => item);
}
