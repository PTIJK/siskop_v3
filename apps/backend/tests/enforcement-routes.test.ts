import { describe, expect, it } from "vitest";
import { featuresForRequest, isStatusExempt } from "../src/middleware/enforcement.js";

describe("featuresForRequest: the spec's enforcement map", () => {
  const cases: [string, string, string[]][] = [
    // Reports: one key each.
    ["GET", "/reports/financial", ["reports_financial"]],
    ["GET", "/reports/financial/pdf", ["reports_financial"]],
    ["GET", "/reports/rat", ["reports_financial"]],
    ["GET", "/reports/regulatory/neraca", ["reports_regulatory"]],
    ["PUT", "/reports/regulatory/calk/narrative", ["reports_regulatory"]],
    ["GET", "/reports/pasar/rekap-kolektor/csv", ["reports_market"]],
    ["GET", "/reports/accounting/buku-besar/abc", ["accounting_book"]],
    ["GET", "/reports/portfolio/par", ["portfolio_quality"]],
    ["GET", "/reports/export/neraca", ["reports"]],
    ["GET", "/ksu/consolidated", ["reports_consolidated"]],
    ["GET", "/ksu/members/m1/statement", ["reports_consolidated"]],
    // Accounting.
    ["POST", "/journal", ["manual_journal"]],
    ["POST", "/journal/j1/reverse", ["manual_journal"]],
    ["GET", "/journal/year-close", ["period_closing"]],
    ["POST", "/journal/year-close/2026", ["period_closing"]],
    // Config.
    ["GET", "/config/accounts", ["config_coa"]],
    ["POST", "/config/accounts", ["config_coa"]],
    ["POST", "/config/accounts/generate-standard", ["coa_standard_template"]],
    ["GET", "/config/journal/unposted", ["accounting_book"]],
    ["POST", "/config/account-mappings", ["config_account_mapping"]],
    ["GET", "/config/shu-distribution", ["config_shu"]],
    ["PUT", "/config/whitelabel", ["whitelabel"]],
    ["PUT", "/config/modal-disetor", ["paid_in_capital"]],
    ["PUT", "/config/self-registration", ["self_registration"]],
    ["POST", "/config/holidays/import", ["config_holidays"]],
    ["PUT", "/config/operating-days", ["config_holidays"]],
    ["POST", "/config/units", ["config_branch_units"]],
    ["PUT", "/config/units/u1", ["config_branch_units"]],
    ["POST", "/config/roles", ["config_roles"]],
    ["GET", "/users", ["config_users"]],
    ["POST", "/users/invitations", ["config_users"]],
    ["POST", "/savings/configs", ["config_saving"]],
    ["PUT", "/savings/configs/s1", ["config_saving"]],
    ["POST", "/loans/configs", ["config_loan"]],
    ["GET", "/tenant-domain", ["workspace_address"]],
    ["PUT", "/tenant-domain", ["workspace_address"]],
    // Members, units, audit.
    ["POST", "/members", ["members"]],
    ["GET", "/members/registration-requests", ["self_registration"]],
    ["POST", "/members/registration-requests/r1/approve", ["self_registration"]],
    ["GET", "/members/self-registration-link", ["self_registration"]],
    ["GET", "/audit-log", ["audit_trail"]],
    ["GET", "/dashboard/summary", ["dashboard"]],
    ["GET", "/dashboard/pasar", ["unit_pasar"]],
    ["GET", "/konsumen/products", ["unit_konsumen"]],
    ["POST", "/konsumen/pos/sales", ["unit_konsumen"]],
    ["GET", "/konsumen/pos/credit", ["unit_konsumen", "member_receivables"]],
    ["POST", "/konsumen/pos/credit/repayments", ["unit_konsumen", "member_receivables"]],
    ["GET", "/market/markets", ["unit_pasar"]],
    ["POST", "/collections/loan-payment", ["unit_pasar"]]
  ];

  it.each(cases)("%s %s needs %j", (method, path, expected) => {
    expect(featuresForRequest(method, path)).toEqual(expected);
  });

  it("leaves the core modules open: savings and loan transactions, expenses, notifications", () => {
    for (const [method, path] of [
      ["GET", "/savings"],
      ["POST", "/savings/s1/deposit"],
      ["GET", "/savings/configs"],
      ["POST", "/loans"],
      ["GET", "/loans/configs"],
      ["POST", "/expenses"],
      ["GET", "/notifications"],
      ["GET", "/config/units"],
      ["GET", "/config/roles"],
      ["GET", "/config/subscription"]
    ] as const) {
      expect(featuresForRequest(method, path)).toEqual([]);
    }
  });

  it("ignores a query string, a trailing slash and case in the path", () => {
    expect(featuresForRequest("GET", "/reports/regulatory/neraca/?year=2026")).toEqual(["reports_regulatory"]);
    expect(featuresForRequest("GET", "/Reports/Regulatory/Neraca")).toEqual(["reports_regulatory"]);
  });

  it("does not match a path that merely starts with a module name", () => {
    expect(featuresForRequest("GET", "/membersX")).toEqual([]);
    expect(featuresForRequest("GET", "/usersettings")).toEqual([]);
  });
});

describe("isStatusExempt", () => {
  it("lets a tenant reach login, its subscription page and notifications so it can see why it is blocked", () => {
    for (const path of ["/auth/login", "/auth/refresh", "/auth/me", "/config/subscription", "/notifications", "/notifications/n1/read"]) {
      expect(isStatusExempt(path)).toBe(true);
    }
  });

  it("does not exempt tenant data", () => {
    for (const path of ["/members", "/config/units", "/config/subscriptionX", "/reports/financial"]) {
      expect(isStatusExempt(path)).toBe(false);
    }
  });
});
