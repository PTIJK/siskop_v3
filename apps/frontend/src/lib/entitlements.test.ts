import { describe, expect, it } from "vitest";
import type { PublicPricingCatalog, TenantSubscriptionInfo } from "@siskop/types";
import { accessNotice, isFeatureLocked, quotaHint, unlockingPackages, usageMeter } from "./entitlements";

const info = (over: Partial<TenantSubscriptionInfo> = {}): TenantSubscriptionInfo => ({
  packageCode: "free",
  packageName: "Free",
  status: "ACTIVE",
  billingCycle: "MONTHLY",
  nextBillingDate: null,
  features: ["dashboard", "members"],
  limits: { members: 50, users: 1, savingTypes: 2, loanTypes: 2 },
  usage: { members: 10, users: 1, savingTypes: 1, loanTypes: 0 },
  enforcement: "on",
  openInvoice: null,
  paymentInstructions: null,
  ...over
});

describe("isFeatureLocked", () => {
  it("locks a feature the package lacks, only when the server enforces it", () => {
    expect(isFeatureLocked(info(), "reports_regulatory")).toBe(true);
    expect(isFeatureLocked(info({ enforcement: "shadow" }), "reports_regulatory")).toBe(false);
    expect(isFeatureLocked(info({ enforcement: "off" }), "reports_regulatory")).toBe(false);
  });

  it("never locks a feature the package includes", () => {
    expect(isFeatureLocked(info(), "members")).toBe(false);
  });

  it("does not lock anything before the subscription has loaded or when there is none", () => {
    expect(isFeatureLocked(undefined, "reports_regulatory")).toBe(false);
    expect(isFeatureLocked(null, "reports_regulatory")).toBe(false);
  });
});

describe("usageMeter", () => {
  it("reports unlimited when the limit is null", () => {
    expect(usageMeter({ members: 10 }.members, null)).toEqual({ used: 10, limit: null, ratio: 0, state: "unlimited" });
  });

  it("is ok below 80%, near from 80%, full at the limit and over beyond it", () => {
    expect(usageMeter(10, 50).state).toBe("ok");
    expect(usageMeter(40, 50).state).toBe("near");
    expect(usageMeter(50, 50).state).toBe("full");
    expect(usageMeter(60, 50).state).toBe("over");
  });

  it("caps the bar at 100% even when over the limit", () => {
    expect(usageMeter(60, 50).ratio).toBe(1);
    expect(usageMeter(25, 50).ratio).toBe(0.5);
  });

  it("treats a zero limit as full", () => {
    expect(usageMeter(0, 0).state).toBe("full");
  });
});

describe("quotaHint", () => {
  it("blocks creating only when enforced and the limit is reached", () => {
    expect(quotaHint(info({ usage: { members: 50, users: 1, savingTypes: 1, loanTypes: 0 } }), "members")).toMatchObject({ blocked: true, label: "50/50" });
    expect(quotaHint(info({ usage: { members: 50, users: 1, savingTypes: 1, loanTypes: 0 }, enforcement: "shadow" }), "members")).toMatchObject({ blocked: false, label: "50/50" });
    expect(quotaHint(info(), "members")).toMatchObject({ blocked: false, label: "10/50" });
  });

  it("has nothing to show for an unlimited item or before the subscription loads", () => {
    expect(quotaHint(info({ limits: { members: null, users: 1, savingTypes: 2, loanTypes: 2 } }), "members")).toBeNull();
    expect(quotaHint(undefined, "members")).toBeNull();
  });
});

describe("unlockingPackages", () => {
  const catalog = {
    packages: [
      { code: "free", name: "Free", isCustom: false, sortOrder: 0, features: ["members"] },
      { code: "small", name: "Small", isCustom: false, sortOrder: 1, features: ["members", "reports_regulatory"] },
      { code: "medium", name: "Medium", isCustom: false, sortOrder: 2, features: ["members", "reports_regulatory", "audit_trail"] },
      { code: "custom", name: "Custom", isCustom: true, sortOrder: 4, features: [] }
    ]
  } as unknown as PublicPricingCatalog;

  it("lists the fixed packages that include the feature, cheapest first", () => {
    expect(unlockingPackages(catalog, "reports_regulatory")).toEqual(["Small", "Medium"]);
    expect(unlockingPackages(catalog, "audit_trail")).toEqual(["Medium"]);
  });

  it("is empty for a feature no fixed package has", () => {
    expect(unlockingPackages(catalog, "ocr")).toEqual([]);
  });
});

describe("accessNotice", () => {
  it("says nothing for an active subscription or while enforcement is not on", () => {
    expect(accessNotice(info())).toBeNull();
    expect(accessNotice(info({ status: "PAST_DUE", enforcement: "off" }))).toBeNull();
    expect(accessNotice(info({ status: "PAST_DUE", enforcement: "shadow" }))).toBeNull();
    expect(accessNotice(undefined)).toBeNull();
  });

  it("warns that a past-due koperasi is read-only", () => {
    expect(accessNotice(info({ status: "PAST_DUE" }))).toMatchObject({ tone: "error" });
    expect(accessNotice(info({ status: "PAST_DUE" }))?.message).toMatch(/hanya dapat dilihat/i);
  });

  it("blocks for a cancelled or unpaid subscription", () => {
    expect(accessNotice(info({ status: "CANCELLED" }))?.tone).toBe("error");
    expect(accessNotice(info({ status: "PENDING_PAYMENT" }))?.tone).toBe("error");
  });
});
