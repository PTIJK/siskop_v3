import { describe, expect, it } from "vitest";
import type { PublicPricingCatalog } from "@siskop/types";
import {
  buildRegistration,
  formatTaxRate,
  parseDeepLink,
  priceOf,
  requiredCustomFeatures,
  startingSelection,
  stepProblems,
  unitAllowed,
  yearlySaving,
  type RegistrationForm
} from "./registration";

const pkg = (code: string, monthly: string | null, yearly: string | null, isCustom = false): PublicPricingCatalog["packages"][number] => ({
  code,
  name: code,
  isCustom,
  sortOrder: 1,
  priceMonthly: monthly,
  priceYearly: yearly,
  limits: { members: 50, users: 1, savingTypes: 2, loanTypes: 2 },
  features: []
});

const catalog = {
  version: 1,
  currency: "IDR",
  packages: [pkg("free", null, null), pkg("small", "500000", "5000000"), pkg("medium", "1000000", "10000000"), pkg("custom", null, null, true)],
  features: [],
  volumeAddons: [],
  supportPlans: [],
  settings: {
    yearlyMultiplier: 10,
    enabledCycles: ["MONTHLY", "YEARLY"],
    defaultPackageCode: "free",
    customEnabled: true,
    customBaseLimits: { members: 50, users: 1, savingTypes: 2, loanTypes: 2 },
    addonsOnFixedPackages: true,
    taxRate: "0.1100"
  }
} as PublicPricingCatalog;

const form = (over: Partial<RegistrationForm> = {}): RegistrationForm => ({
  tenantName: "Koperasi Sejahtera",
  registrationNo: "123/BH/2026",
  type: "KONVENSIONAL",
  address: "Jl. Merdeka No. 1",
  unitType: "KSP",
  adminName: "Budi Santoso",
  method: "password",
  email: "budi@koperasi.id",
  password: "rahasia123",
  confirmPassword: "rahasia123",
  ...over
});

describe("unitAllowed", () => {
  it("allows KSP on any package", () => {
    expect(unitAllowed("KSP", [])).toBe(true);
  });

  it("allows Konsumen and Pasar only when the package includes the unit", () => {
    expect(unitAllowed("KONSUMEN", ["unit_ksp"])).toBe(false);
    expect(unitAllowed("KONSUMEN", ["unit_konsumen"])).toBe(true);
    expect(unitAllowed("JASA", ["unit_konsumen"])).toBe(false);
    expect(unitAllowed("JASA", ["unit_pasar"])).toBe(true);
  });
});

describe("requiredCustomFeatures", () => {
  it("names the unit feature a Custom selection must carry", () => {
    expect(requiredCustomFeatures("KSP")).toEqual([]);
    expect(requiredCustomFeatures("KONSUMEN")).toEqual(["unit_konsumen"]);
    expect(requiredCustomFeatures("JASA")).toEqual(["unit_pasar"]);
  });
});

describe("priceOf and yearlySaving", () => {
  it("returns the price for the cycle, or null for a free package", () => {
    expect(priceOf(catalog.packages[1]!, "MONTHLY")).toBe("500000");
    expect(priceOf(catalog.packages[1]!, "YEARLY")).toBe("5000000");
    expect(priceOf(catalog.packages[0]!, "MONTHLY")).toBeNull();
  });

  it("shows the yearly saving against twelve monthly payments, rounded", () => {
    expect(yearlySaving(catalog.packages[1]!)).toBe(17);
    expect(yearlySaving(catalog.packages[0]!)).toBeNull();
    expect(yearlySaving(catalog.packages[3]!)).toBeNull();
  });
});

describe("parseDeepLink", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("reads a known package and cycle", () => {
    expect(parseDeepLink(q("package=small&cycle=yearly"), catalog)).toEqual({ packageCode: "small", cycle: "YEARLY" });
  });

  it("ignores an unknown package or a cycle the owner has not enabled", () => {
    expect(parseDeepLink(q("package=platinum&cycle=weekly"), catalog)).toEqual({ packageCode: null, cycle: null });
    const monthlyOnly = { ...catalog, settings: { ...catalog.settings, enabledCycles: ["MONTHLY"] } } as PublicPricingCatalog;
    expect(parseDeepLink(q("package=small&cycle=yearly"), monthlyOnly)).toEqual({ packageCode: "small", cycle: null });
  });

  it("ignores Custom when the owner has switched it off", () => {
    const off = { ...catalog, settings: { ...catalog.settings, customEnabled: false } } as PublicPricingCatalog;
    expect(parseDeepLink(q("package=custom"), off).packageCode).toBeNull();
  });
});

describe("startingSelection", () => {
  it("starts on the deep-linked package and cycle", () => {
    expect(startingSelection(catalog, { packageCode: "medium", cycle: "YEARLY" })).toEqual({
      packageCode: "medium",
      billingCycle: "YEARLY",
      featureKeys: [],
      addons: []
    });
  });

  it("falls back to the default package and the first enabled cycle", () => {
    expect(startingSelection(catalog, { packageCode: null, cycle: null })).toMatchObject({ packageCode: "free", billingCycle: "MONTHLY" });
  });
});

describe("stepProblems", () => {
  const ok = { effectiveFeatures: ["unit_ksp"] };

  it("step 1 needs a name, registration number and address", () => {
    expect(stepProblems(1, form(), ok)).toEqual([]);
    expect(stepProblems(1, form({ tenantName: " " }), ok)).toContain("Nama koperasi wajib diisi (minimal 2 karakter).");
    expect(stepProblems(1, form({ registrationNo: "" }), ok)).toContain("Nomor badan hukum wajib diisi.");
    expect(stepProblems(1, form({ address: "Jl." }), ok)).toContain("Alamat koperasi minimal 5 karakter.");
  });

  it("step 3 rejects a business type the chosen package does not include", () => {
    expect(stepProblems(3, form(), ok)).toEqual([]);
    const problems = stepProblems(3, form({ unitType: "KONSUMEN" }), ok);
    expect(problems[0]).toMatch(/Konsumen/);
    expect(stepProblems(3, form({ unitType: "KONSUMEN" }), { effectiveFeatures: ["unit_konsumen"] })).toEqual([]);
  });

  it("step 4 checks the account for password sign-up only", () => {
    expect(stepProblems(4, form(), ok)).toEqual([]);
    expect(stepProblems(4, form({ email: "bukan-email" }), ok)).toContain("Email pengelola tidak valid.");
    expect(stepProblems(4, form({ password: "pendek", confirmPassword: "pendek" }), ok)).toContain("Kata sandi minimal 8 karakter.");
    expect(stepProblems(4, form({ confirmPassword: "lain-lain-123" }), ok)).toContain("Konfirmasi kata sandi belum cocok.");
    expect(stepProblems(4, form({ method: "google", email: "", password: "", confirmPassword: "" }), ok)).toEqual([]);
  });
});

describe("buildRegistration", () => {
  it("sends a selection and the cooperative's details, never a price", () => {
    const payload = buildRegistration(
      form({ tenantName: "  Koperasi Sejahtera  ", unitType: "KONSUMEN" }),
      { packageCode: "medium", billingCycle: "YEARLY", featureKeys: [], addons: [{ itemKey: "MEMBERS", qty: 100 }], supportPlanCode: "SP1" },
      "token-123"
    );

    expect(payload).toEqual({
      subscription: { packageCode: "medium", billingCycle: "YEARLY", featureKeys: [], addons: [{ itemKey: "MEMBERS", qty: 100 }], supportPlanCode: "SP1" },
      tenantName: "Koperasi Sejahtera",
      registrationNo: "123/BH/2026",
      address: "Jl. Merdeka No. 1",
      type: "KONVENSIONAL",
      adminName: "Budi Santoso",
      firstUnit: { type: "KONSUMEN", name: "Konsumen" },
      idToken: "token-123"
    });
    expect(JSON.stringify(payload)).not.toMatch(/amount|price|total/i);
  });

  it("names the first unit after the business type", () => {
    const sel = { packageCode: "free", billingCycle: "MONTHLY" as const };
    expect(buildRegistration(form({ unitType: "KSP" }), sel, "t").firstUnit).toEqual({ type: "KSP", name: "Simpan pinjam" });
    expect(buildRegistration(form({ unitType: "JASA" }), sel, "t").firstUnit).toEqual({ type: "JASA", name: "Pengelola pasar" });
  });
});

describe("formatTaxRate", () => {
  it("shows the rate as a percentage, or nothing when there is none", () => {
    expect(formatTaxRate("0.1100")).toBe("11%");
    expect(formatTaxRate("0.115")).toBe("11,5%");
    expect(formatTaxRate(null)).toBeNull();
  });
});
