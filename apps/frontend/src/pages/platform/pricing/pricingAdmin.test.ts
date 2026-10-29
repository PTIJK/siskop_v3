import { describe, expect, it } from "vitest";
import type { PricingCatalogFeature, PricingCatalogPackage, PricingChange } from "@siskop/types";
import { buildFeatureRows, describeChange, limitLabel, normaliseIdr, toggleCustomFeature, toggleFeature } from "./pricingAdmin";

const f = (key: string, over: Partial<PricingCatalogFeature> = {}): PricingCatalogFeature => ({
  key,
  name: key,
  parentKey: null,
  requires: [],
  customPrice: "0",
  priceGroup: null,
  sortOrder: 0,
  isActive: true,
  ...over
});

// reports (parent) > accounting_book, manual_journal (needs accounting_book), period_closing (needs accounting_book)
const FEATURES: PricingCatalogFeature[] = [
  f("reports", { sortOrder: 0 }),
  f("accounting_book", { parentKey: "reports", sortOrder: 1, customPrice: "150000" }),
  f("manual_journal", { parentKey: "reports", requires: ["accounting_book"], sortOrder: 2, customPrice: "150000" }),
  f("period_closing", { parentKey: "reports", requires: ["accounting_book"], sortOrder: 3, customPrice: "100000" }),
  f("members", { sortOrder: 4 })
];

const pkg = (features: string[]): PricingCatalogPackage => ({
  code: "small",
  name: "Small",
  isCustom: false,
  isPublic: true,
  sortOrder: 2,
  priceMonthly: "500000",
  priceYearly: "5000000",
  limits: { members: 500, users: 10, savingTypes: 10, loanTypes: 10 },
  features
});

describe("buildFeatureRows", () => {
  it("lists parents before their children, with depth, in sort order", () => {
    const shuffled = [FEATURES[3]!, FEATURES[4]!, FEATURES[1]!, FEATURES[0]!, FEATURES[2]!];

    const rows = buildFeatureRows(shuffled);

    expect(rows.map((r) => [r.feature.key, r.depth])).toEqual([
      ["reports", 0],
      ["accounting_book", 1],
      ["manual_journal", 1],
      ["period_closing", 1],
      ["members", 0]
    ]);
  });

  it("keeps a child whose parent is missing instead of dropping it", () => {
    const rows = buildFeatureRows([f("orphan", { parentKey: "ghost" })]);
    expect(rows.map((r) => r.feature.key)).toEqual(["orphan"]);
  });
});

describe("toggleFeature", () => {
  it("turning a feature on also turns on its parent and what it requires", () => {
    const next = toggleFeature(pkg([]), "period_closing", true, FEATURES);
    expect(next.sort()).toEqual(["accounting_book", "period_closing", "reports"]);
  });

  it("turning a feature off also turns off what depends on it", () => {
    const next = toggleFeature(pkg(["reports", "accounting_book", "manual_journal", "period_closing"]), "accounting_book", false, FEATURES);
    expect(next).toEqual(["reports"]);
  });

  it("turning a parent off turns off its children", () => {
    const next = toggleFeature(pkg(["reports", "accounting_book", "members"]), "reports", false, FEATURES);
    expect(next).toEqual(["members"]);
  });

  it("is a no-op when nothing changes", () => {
    const start = pkg(["members"]);
    expect(toggleFeature(start, "members", true, FEATURES)).toEqual(["members"]);
    expect(toggleFeature(start, "reports", false, FEATURES)).toEqual(["members"]);
  });

  it("does not loop on a requires cycle", () => {
    const cyc = [f("a", { requires: ["b"] }), f("b", { requires: ["a"] })];
    expect(toggleFeature(pkg([]), "a", true, cyc).sort()).toEqual(["a", "b"]);
  });
});

describe("toggleCustomFeature", () => {
  it("adds priced requirements and parents, but never free ones", () => {
    // reports and members are free (price 0); accounting_book is priced.
    const next = toggleCustomFeature([], "period_closing", true, FEATURES);
    expect(next.sort()).toEqual(["accounting_book", "period_closing"]);
  });

  it("removes dependants when a feature is unticked", () => {
    const next = toggleCustomFeature(["accounting_book", "manual_journal", "period_closing"], "accounting_book", false, FEATURES);
    expect(next).toEqual([]);
  });

  it("leaves unrelated selections alone", () => {
    const next = toggleCustomFeature(["accounting_book", "members"], "accounting_book", false, [...FEATURES, f("members", { customPrice: "50000" })]);
    expect(next).toEqual(["members"]);
  });

  it("is idempotent when switching on something already selected", () => {
    expect(toggleCustomFeature(["accounting_book"], "accounting_book", true, FEATURES)).toEqual(["accounting_book"]);
  });
});

describe("limitLabel", () => {
  it("shows null as unlimited", () => {
    expect(limitLabel(null)).toBe("Tanpa batas");
    expect(limitLabel(2000)).toBe("2.000");
  });
});

describe("normaliseIdr", () => {
  it("strips thousands separators and currency text", () => {
    expect(normaliseIdr("Rp 1.500.000")).toBe("1500000");
    expect(normaliseIdr("500000")).toBe("500000");
  });

  it("keeps up to two decimals after a comma", () => {
    expect(normaliseIdr("83.333,33")).toBe("83333.33");
  });

  it("returns null for empty or nonsense input", () => {
    expect(normaliseIdr("")).toBeNull();
    expect(normaliseIdr("abc")).toBeNull();
    expect(normaliseIdr("-5")).toBeNull();
  });
});

describe("describeChange", () => {
  it("describes an added, removed and changed entity in Indonesian", () => {
    const added: PricingChange = { section: "supportPlans", key: "SP3", type: "ADDED" };
    const removed: PricingChange = { section: "features", key: "ocr", type: "REMOVED" };
    expect(describeChange(added)).toBe("Paket dukungan SP3 ditambahkan");
    expect(describeChange(removed)).toBe("Fitur ocr dihapus");
  });

  it("lists changed fields with before and after", () => {
    const changed: PricingChange = {
      section: "packages",
      key: "small",
      type: "CHANGED",
      fields: [{ field: "priceMonthly", before: "500000", after: "600000" }]
    };
    expect(describeChange(changed)).toBe("Paket small: priceMonthly 500000 → 600000");
  });

  it("shows null as a dash and arrays as a count of added and removed keys", () => {
    const changed: PricingChange = {
      section: "packages",
      key: "small",
      type: "CHANGED",
      fields: [
        { field: "priceYearly", before: null, after: "6000000" },
        { field: "features", before: ["a", "b"], after: ["b", "c", "d"] }
      ]
    };
    expect(describeChange(changed)).toBe("Paket small: priceYearly - → 6000000; features +2 −1");
  });
});
