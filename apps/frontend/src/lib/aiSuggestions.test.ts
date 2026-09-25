import { describe, expect, it } from "vitest";
import type { CapitalDashboard, DashboardSummary, LoanQualityDashboard } from "@siskop/types";
import { buildAiSuggestions } from "./aiSuggestions";

const SUMMARY: DashboardSummary = {
  totalSavings: "10000000",
  savingsEquity: "0",
  savingsLiability: "10000000",
  totalActiveLoans: "1000000",
  memberCount: 10,
  monthlyPayments: "0",
  overdueCount: 0,
  previous: { memberCount: 10, monthlyPayments: "0" }
};

const flat = (value: number) => Array.from({ length: 6 }, (_, i) => ({ month: `M${i}`, value }));
const rising = [100, 100, 100, 200, 200, 200].map((value, i) => ({ month: `M${i}`, value }));
const falling = [200, 200, 200, 100, 100, 100].map((value, i) => ({ month: `M${i}`, value }));

const CAPITAL: CapitalDashboard = {
  modalSendiri: "2000000000",
  komposisi: [],
  penyesuaianSaldoAwal: "0",
  trend: [],
  totalAset: "10000000000",
  rasioModalSendiriAset: "20.00",
  audit: { threshold: "5000000000", progressPct: "40.00", reached: false, applies: true },
  klasifikasi: "KSP_I",
  bmpp: { topBorrowers: [] },
  konsentrasiSimpanan: []
};

const QUALITY: LoanQualityDashboard = {
  totalOutstanding: "1000000",
  byKol: [
    { category: "LANCAR", count: 10, outstanding: "1000000" },
    { category: "DALAM_PERHATIAN", count: 0, outstanding: "0" },
    { category: "KURANG_LANCAR", count: 0, outstanding: "0" },
    { category: "DIRAGUKAN", count: 0, outstanding: "0" },
    { category: "MACET", count: 0, outstanding: "0" }
  ],
  nplRatio: "0.00",
  ldr: "10.00",
  topOverdue: []
};

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("buildAiSuggestions — existing rules (regression)", () => {
  it("returns nothing before the summary has loaded", () => {
    expect(buildAiSuggestions(undefined, [], [])).toEqual([]);
  });

  it("reports a healthy koperasi when nothing is wrong", () => {
    expect(ids(buildAiSuggestions(SUMMARY, flat(100), flat(100)))).toEqual(["healthy"]);
  });

  it("flags MACET loans as danger", () => {
    const [first] = buildAiSuggestions({ ...SUMMARY, overdueCount: 3 }, [], []);
    expect(first).toMatchObject({ id: "overdue", tone: "danger" });
    expect(first!.text).toContain("3 pinjaman");
  });

  it("flags rising and falling disbursement, and falling repayments", () => {
    expect(ids(buildAiSuggestions(SUMMARY, rising, flat(100)))).toContain("loan-trend-up");
    expect(ids(buildAiSuggestions(SUMMARY, falling, flat(100)))).toContain("loan-trend-down");
    expect(ids(buildAiSuggestions(SUMMARY, flat(100), falling))).toContain("payment-trend-down");
  });

  it("warns on liquidity when loans approach the savings members can withdraw", () => {
    const tight = { ...SUMMARY, totalActiveLoans: "9500000" };
    expect(ids(buildAiSuggestions(tight, [], []))).toContain("liquidity");
  });
});

describe("buildAiSuggestions — liquidity measured against withdrawable savings", () => {
  it("ignores simpanan pokok/wajib, which members cannot withdraw", () => {
    // 20M savings in total, but only 5M is sukarela: 6M of loans is tight.
    const summary = { ...SUMMARY, totalSavings: "20000000", savingsEquity: "15000000", savingsLiability: "5000000", totalActiveLoans: "6000000" };
    expect(ids(buildAiSuggestions(summary, [], []))).toContain("liquidity");
  });
});

describe("buildAiSuggestions — capital and loan-quality insights", () => {
  it("keeps the old behaviour when insights are missing", () => {
    expect(ids(buildAiSuggestions(SUMMARY, flat(100), flat(100), {}))).toEqual(["healthy"]);
  });

  it("treats NPL above 5% as danger", () => {
    const list = buildAiSuggestions(SUMMARY, [], [], { loanQuality: { ...QUALITY, nplRatio: "7.50" } });
    expect(list.find((s) => s.id === "npl")).toMatchObject({ tone: "danger" });
    expect(list.find((s) => s.id === "npl")!.text).toContain("7,5%");
  });

  it("warns when more than 10% of outstanding is already dalam perhatian", () => {
    const byKol = QUALITY.byKol.map((k) =>
      k.category === "LANCAR" ? { ...k, outstanding: "850000" } : k.category === "DALAM_PERHATIAN" ? { ...k, count: 2, outstanding: "150000" } : k
    );
    expect(ids(buildAiSuggestions(SUMMARY, [], [], { loanQuality: { ...QUALITY, byKol } }))).toContain("kol-watch");
  });

  it("warns when Modal Sendiri is under 10% of total assets", () => {
    const list = buildAiSuggestions(SUMMARY, [], [], { capital: { ...CAPITAL, rasioModalSendiriAset: "8.40" } });
    expect(list.find((s) => s.id === "capital-ratio")).toMatchObject({ tone: "warning" });
  });

  it("warns about borrowers at 80% or more of their BMPP limit", () => {
    const capital: CapitalDashboard = {
      ...CAPITAL,
      bmpp: {
        topBorrowers: [
          { memberId: "a", memberName: "Pak Ketua", isRelatedParty: true, principal: "90", limitPct: 10, limit: "100", usagePct: "90.00" },
          { memberId: "b", memberName: "Bu Ani", isRelatedParty: false, principal: "50", limitPct: 15, limit: "100", usagePct: "50.00" }
        ]
      }
    };
    const suggestion = buildAiSuggestions(SUMMARY, [], [], { capital }).find((s) => s.id === "bmpp-usage");
    expect(suggestion).toMatchObject({ tone: "warning" });
    expect(suggestion!.text).toContain("Pak Ketua");
    expect(suggestion!.text).not.toContain("Bu Ani");
  });

  it("notes members holding more than 20% of Modal Sendiri", () => {
    const capital = {
      ...CAPITAL,
      konsentrasiSimpanan: [{ memberId: "a", memberName: "Pak Haji", amount: "500", pctOfModalSendiri: "25.00" }]
    };
    expect(buildAiSuggestions(SUMMARY, [], [], { capital }).find((s) => s.id === "capital-concentration")).toMatchObject({
      tone: "info"
    });
  });

  it("announces the mandatory audit once Modal Sendiri reaches Rp5 miliar, and warns early from 80%", () => {
    const reached = { ...CAPITAL, audit: { ...CAPITAL.audit, reached: true, progressPct: "104.00" } };
    const near = { ...CAPITAL, audit: { ...CAPITAL.audit, progressPct: "85.00" } };
    const notKsp = { ...reached, audit: { ...reached.audit, applies: false } };
    expect(ids(buildAiSuggestions(SUMMARY, [], [], { capital: reached }))).toContain("audit-required");
    expect(ids(buildAiSuggestions(SUMMARY, [], [], { capital: near }))).toContain("audit-approaching");
    expect(ids(buildAiSuggestions(SUMMARY, [], [], { capital: notKsp }))).not.toContain("audit-required");
  });

  it("orders by severity and shows at most five", () => {
    const list = buildAiSuggestions({ ...SUMMARY, overdueCount: 1, totalActiveLoans: "9500000" }, rising, falling, {
      capital: {
        ...CAPITAL,
        rasioModalSendiriAset: "5.00",
        audit: { ...CAPITAL.audit, reached: true },
        konsentrasiSimpanan: [{ memberId: "a", memberName: "X", amount: "1", pctOfModalSendiri: "30.00" }]
      },
      loanQuality: { ...QUALITY, nplRatio: "9.00" }
    });
    expect(list).toHaveLength(5);
    const rank = { danger: 0, warning: 1, info: 2, success: 3 };
    const tones = list.map((s) => rank[s.tone]);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
    expect(ids(list).slice(0, 2).sort()).toEqual(["npl", "overdue"]);
  });
});
