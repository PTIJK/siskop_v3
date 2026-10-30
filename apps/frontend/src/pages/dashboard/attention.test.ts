import { describe, expect, it } from "vitest";
import type { CapitalDashboard, DashboardSummary, LoanQualityDashboard } from "@siskop/types";
import { buildAttentionItems, type AttentionInput } from "./attention";

const route = (href: string, feature?: string) => (feature === "locked" ? "/langganan?fitur=locked" : href);

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return { canSeeLoans: true, route, ...over };
}

const summary = (overdueCount: number): DashboardSummary => ({
  totalSavings: "0", savingsEquity: "0", savingsLiability: "0", totalActiveLoans: "0", memberCount: 0, monthlyPayments: "0", overdueCount,
  previous: { memberCount: 0, monthlyPayments: "0" }
});

const quality = (counts: Partial<Record<LoanQualityDashboard["byKol"][number]["category"], number>>, npl: string | null = null): LoanQualityDashboard => ({
  totalOutstanding: "0",
  byKol: (["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"] as const).map((category) => ({ category, count: counts[category] ?? 0, outstanding: "0" })),
  nplRatio: npl, ldr: null, topOverdue: []
});

describe("buildAttentionItems", () => {
  it("is empty when every source is clean or missing", () => {
    expect(buildAttentionItems(input())).toEqual([]);
    expect(buildAttentionItems(input({ summary: summary(0), quality: quality({ LANCAR: 40 }) }))).toEqual([]);
  });

  it("leads with macet loans, then loans starting to slip, by risk", () => {
    const items = buildAttentionItems(input({ summary: summary(3), quality: quality({ DALAM_PERHATIAN: 4, KURANG_LANCAR: 2 }, "6.5"), pendingRegistrations: 5 }));
    expect(items.map((i) => i.id)).toEqual(["macet", "mulai-terlambat", "pendaftaran"]);
    expect(items[0]?.count).toBe(3);
    expect(items[1]?.count).toBe(6);
    expect(items[1]?.detail).toContain("NPL");
  });

  it("hides loan tasks from a role that cannot read loans", () => {
    const items = buildAttentionItems(input({ canSeeLoans: false, summary: summary(3), quality: quality({ MACET: 3, DALAM_PERHATIAN: 1 }), pendingRegistrations: 2 }));
    expect(items.map((i) => i.id)).toEqual(["pendaftaran"]);
  });

  it("sends a package-locked destination to Langganan instead of a dead page", () => {
    const items = buildAttentionItems(input({ quality: quality({ KURANG_LANCAR: 1 }), route: () => "/langganan?fitur=portfolio_quality" }));
    expect(items[0]?.to).toBe("/langganan?fitur=portfolio_quality");
  });

  it("only mentions registrations and batches when there is something to do", () => {
    expect(buildAttentionItems(input({ pendingRegistrations: 0 }))).toEqual([]);
    expect(buildAttentionItems(input({ pasar: { setoranHariIni: "0", batchBelumDiverifikasi: 0, totalTunggakan: "0" } }))).toEqual([]);
    const items = buildAttentionItems(input({ pasar: { setoranHariIni: "0", batchBelumDiverifikasi: 2, totalTunggakan: "0" } }));
    expect(items[0]?.id).toBe("batch-pasar");
  });

  it("flags an unpaid invoice, as bad when payment is overdue", () => {
    const base = { packageCode: "x", packageName: "Tumbuh", billingCycle: "MONTHLY" as const, nextBillingDate: null, features: [], limits: { members: 1, users: 1, savingTypes: 1, loanTypes: 1 }, usage: { members: 0, users: 0, savingTypes: 0, loanTypes: 0 }, enforcement: "on" as const, paymentInstructions: null, openInvoice: { number: "INV-1", type: "RENEWAL" as const, total: "100", dueDate: "2026-11-05T00:00:00.000Z" } };
    expect(buildAttentionItems(input({ subscription: { ...base, status: "ACTIVE" } }))[0]?.tone).toBe("warn");
    expect(buildAttentionItems(input({ subscription: { ...base, status: "PAST_DUE" } }))[0]?.tone).toBe("bad");
  });

  it("flags low capital ratio and concentrated savings from the capital dashboard", () => {
    const capital = { rasioModalSendiriAset: "7.2", konsentrasiSimpanan: [{ memberId: "m", memberName: "A", amount: "1", pctOfModalSendiri: "25" }] } as unknown as CapitalDashboard;
    expect(buildAttentionItems(input({ capital })).map((i) => i.id)).toEqual(["modal", "konsentrasi"]);
    const healthy = { rasioModalSendiriAset: "14", konsentrasiSimpanan: [] } as unknown as CapitalDashboard;
    expect(buildAttentionItems(input({ capital: healthy }))).toEqual([]);
  });
});
