import { describe, expect, it } from "vitest";
import type { PermissionAction, PermissionModule } from "@siskop/types";
import { buildNav, buildQuickActions, matchesQuery, type NavContext } from "./nav";

type Grant = Partial<Record<PermissionModule, PermissionAction[]>>;

function ctx(grants: Grant, over: Partial<NavContext> = {}): NavContext {
  return {
    isPlatformAdmin: false,
    isMultiUnit: false,
    isLocked: () => false,
    can: (module, action) => grants[module]?.includes(action) ?? false,
    ...over
  };
}

const MANAGER: Grant = {
  dashboard: ["read"],
  members: ["read", "create"],
  savings: ["read", "create"],
  loans: ["read", "create"],
  reports: ["read"],
  config: ["read"],
  expenses: ["read"],
  konsumen: ["read", "create"],
  market: ["read"]
};

const labels = (c: NavContext) => buildNav(c).flatMap((s) => s.items.map((i) => i.label));

describe("buildNav", () => {
  it("groups entries by task in the designed order", () => {
    expect(buildNav(ctx(MANAGER)).map((s) => s.label)).toEqual(["Harian", "Anggota", "Keuangan", "Laporan", "Pengaturan"]);
  });

  it("hides entries the role has no permission for", () => {
    const teller = labels(ctx({ dashboard: ["read"], members: ["read"], savings: ["read", "create"] }));
    expect(teller).toContain("Setor dan tarik");
    expect(teller).toContain("Daftar anggota");
    expect(teller).not.toContain("Pinjaman");
    expect(teller).not.toContain("Laporan keuangan");
    expect(teller).not.toContain("Pengaturan");
    // Langganan has no permission requirement, as before the redesign.
    expect(teller).toContain("Langganan");
  });

  it("keeps a package-locked entry visible but sends it to Langganan", () => {
    const sections = buildNav(ctx(MANAGER, { isLocked: (f) => f === "unit_pasar" }));
    const pasar = sections.flatMap((s) => s.items).find((i) => i.id === "pasar");
    expect(pasar?.locked).toBe(true);
    expect(pasar?.to).toBe("/langganan?fitur=unit_pasar");
    const beranda = sections.flatMap((s) => s.items).find((i) => i.id === "beranda");
    expect(beranda?.locked).toBe(false);
    expect(beranda?.to).toBe("/dashboard");
  });

  it("only shows consolidated reporting for a tenant with more than one unit", () => {
    expect(labels(ctx(MANAGER, { isMultiUnit: false }))).not.toContain("Laporan konsolidasi");
    expect(labels(ctx(MANAGER, { isMultiUnit: true }))).toContain("Laporan konsolidasi");
  });

  it("opens Pengaturan for any one of config, roles or accounting read", () => {
    expect(labels(ctx({ roles: ["read"] }))).toContain("Pengaturan");
    expect(labels(ctx({ accounting: ["read"] }))).toContain("Pengaturan");
    expect(labels(ctx({ dashboard: ["read"] }))).not.toContain("Pengaturan");
  });

  it("gives a platform admin only the platform group, whatever the tenant role allows", () => {
    const sections = buildNav(ctx(MANAGER, { isPlatformAdmin: true }));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe("Platform Admin");
    expect(sections[0]?.items.map((i) => i.href)).toEqual([
      "/platform/dashboard",
      "/platform/tenants",
      "/platform/packages",
      "/platform/pricing",
      "/platform/invoices",
      "/platform/admins"
    ]);
  });

  it("keeps every pre-redesign tenant route reachable for a fully-permitted role", () => {
    const hrefs = buildNav(ctx({ ...MANAGER, roles: ["read"], accounting: ["read"] }, { isMultiUnit: true })).flatMap((s) => s.items.map((i) => i.href));
    for (const route of [
      "/dashboard", "/members", "/piutang", "/expenses", "/savings", "/loans", "/loans/overdue", "/ksu/toko", "/market",
      "/reports", "/reports/regulatory", "/reports/accounting", "/reports/portfolio", "/reports/pasar",
      "/journal/new", "/journal/close", "/ksu/report", "/config", "/langganan"
    ]) {
      expect(hrefs).toContain(route);
    }
  });
});

describe("buildQuickActions", () => {
  it("leads with a new member for a manager", () => {
    expect(buildQuickActions(ctx(MANAGER))[0]?.label).toBe("Anggota baru");
  });

  it("leads with a deposit for a teller", () => {
    const actions = buildQuickActions(ctx({ savings: ["create"], members: ["read"] }));
    expect(actions[0]?.label).toBe("Setor simpanan");
  });

  it("leads with a new sale for a cashier who can only use the store", () => {
    const actions = buildQuickActions(ctx({ konsumen: ["read", "create"] }));
    expect(actions.map((a) => a.label)).toEqual(["Transaksi baru"]);
  });

  it("offers nothing to a read-only role or a platform admin", () => {
    expect(buildQuickActions(ctx({ dashboard: ["read"] }))).toEqual([]);
    expect(buildQuickActions(ctx(MANAGER, { isPlatformAdmin: true }))).toEqual([]);
  });

  it("never offers more than five", () => {
    expect(buildQuickActions(ctx(MANAGER)).length).toBeLessThanOrEqual(5);
  });
});

describe("matchesQuery", () => {
  it("matches every typed word, in any order, ignoring case", () => {
    expect(matchesQuery("Setor dan tarik transaksi simpanan", "TARIK setor")).toBe(true);
    expect(matchesQuery("Daftar anggota", "pinjaman")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesQuery("apa saja", "   ")).toBe(true);
  });
});
