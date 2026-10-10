import { describe, expect, it } from "vitest";
import { bukuBesarHref, parseDrilldown, sourceHref } from "./drilldown";

describe("sourceHref", () => {
  it("opens the loan or saving a ledger line came from", () => {
    expect(sourceHref({ kind: "LOAN", id: "abc" })).toBe("/loans/abc");
    expect(sourceHref({ kind: "SAVING", id: "xyz" })).toBe("/savings/xyz");
  });
  it("has nothing to open for sources without a detail page", () => {
    expect(sourceHref(null)).toBeNull();
  });
});

describe("bukuBesarHref", () => {
  it("links to one account's ledger for a period, keeping the unit", () => {
    const href = bukuBesarHref("acc1", { from: "2026-01-01", to: "2026-10-10", unitId: "u1" });
    expect(href).toBe("/reports/accounting?tab=buku-besar&account=acc1&from=2026-01-01&to=2026-10-10&unitId=u1");
  });
  it("omits the unit when consolidated", () => {
    expect(bukuBesarHref("acc1", { from: "2026-01-01", to: "2026-10-10", unitId: "__all__" })).not.toContain("unitId");
  });
});

describe("parseDrilldown", () => {
  it("round-trips what bukuBesarHref wrote", () => {
    const href = bukuBesarHref("acc1", { from: "2026-01-01", to: "2026-10-10", unitId: "u1" });
    const parsed = parseDrilldown(new URLSearchParams(href.split("?")[1]));
    expect(parsed).toEqual({ accountId: "acc1", from: "2026-01-01", to: "2026-10-10", unitId: "u1" });
  });
  it("is null without an account or with a malformed date, so a bad link just opens the overview", () => {
    expect(parseDrilldown(new URLSearchParams("tab=buku-besar"))).toBeNull();
    expect(parseDrilldown(new URLSearchParams("account=a&from=nope&to=2026-01-01"))).toBeNull();
  });
  it("defaults the unit to consolidated", () => {
    expect(parseDrilldown(new URLSearchParams("account=a&from=2026-01-01&to=2026-02-01"))?.unitId).toBe("__all__");
  });
});
