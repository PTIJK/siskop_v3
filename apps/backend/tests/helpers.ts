import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { login, registerTenant, type RegisterTenantInput } from "../src/modules/auth/service.js";

export const app = () => createApp();

export const DEFAULT_MEMBER = {
  fullName: "Budi Santoso",
  nik: "3171234567890001",
  address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
  birthPlace: "Jakarta",
  birthDate: "1985-03-15",
  occupation: "Pedagang"
};

type MemberOverrides = Partial<typeof DEFAULT_MEMBER> & { isPengurus?: boolean; isPengawas?: boolean };

/** Creates a member via the real API (not a direct DB insert) using the given access token. */
export async function createMemberAs(accessToken: string, overrides: MemberOverrides = {}) {
  const res = await request(app())
    .post("/api/members")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...DEFAULT_MEMBER, ...overrides });
  return res.body.data as { id: string };
}

/** A member with an active simpanan pokok — the precondition Loans requires before issuing any loan. */
export async function createMemberWithPokokSaving(accessToken: string, overrides: MemberOverrides = {}) {
  const member = await createMemberAs(accessToken, overrides);
  const config = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
  await request(app())
    .post("/api/savings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ memberId: member.id, savingConfigId: config.body.data.id, initialDeposit: 500_000 });
  return member;
}

export const DEFAULT_REGISTRATION: RegisterTenantInput = {
  tenantName: "KSP Demo",
  slug: "demo",
  registrationNo: "KOP-DEMO",
  address: "Jl. Demo 1",
  type: "KONVENSIONAL",
  adminName: "Admin Demo",
  adminEmail: "admin@demo.test",
  password: "rahasia123",
  firstUnit: { type: "KSP", name: "Simpan Pinjam" }
};

const TEST_PACKAGE_ID = "pkg_test_full";

/**
 * Upserted once per call (stable id), never deleted by the per-test
 * `tenant.deleteMany` reset — SubscriptionPackage has no tenantId of its own.
 */
async function ensureFullPackage(): Promise<string> {
  const pkg = await db.subscriptionPackage.upsert({
    where: { id: TEST_PACKAGE_ID },
    update: {},
    create: {
      id: TEST_PACKAGE_ID,
      name: "Paket Lengkap (Test)",
      price: 0,
      modules: ["accounting"],
      maxUsers: 100,
      maxMembers: 10_000,
      maxSavingConfigs: null,
      whitelabelEnabled: true,
      isActive: true
    }
  });
  return pkg.id;
}

/**
 * Registers a fresh tenant (+ unit, 4 seed roles, Super Admin user) and logs
 * the admin in. Defaults to a fully-entitled package (accounting + whitelabel)
 * — mirroring prisma/seed.ts's demo tenant, the primary fixture most tests are
 * written against — so tests exercising accounting/whitelabel business logic
 * don't all need to grant entitlement themselves. Pass `{ entitled: false }`
 * to get a package-less tenant instead, mirroring seed.ts's Barokah tenant,
 * for tests that specifically assert the entitlement gate itself.
 */
export async function setupTenant(
  overrides: Partial<RegisterTenantInput> = {},
  opts: { entitled?: boolean } = {}
) {
  const session = await registerTenant({ ...DEFAULT_REGISTRATION, ...overrides });
  if (opts.entitled ?? true) {
    await db.tenant.update({ where: { id: session.user.tenantId }, data: { packageId: await ensureFullPackage() } });
  }
  return session;
}

/** Creates a staff user under one of the tenant's seeded roles and logs them in. */
export async function createStaffSession(
  tenantId: string,
  slug: string,
  roleName: "Super Admin" | "Manager" | "Teller" | "Viewer" | "Kasir",
  email: string
) {
  const role = await db.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
  await db.user.create({
    data: {
      tenantId,
      roleId: role.id,
      email,
      name: roleName,
      passwordHash: await bcrypt.hash("rahasia123", 10)
    }
  });
  return login(slug, email, "rahasia123");
}

/** Registers a fresh tenant, then attaches a platform-admin user to it and logs them in. */
export async function createPlatformAdminSession(email = "platform-admin@demo.test") {
  const tenant = await setupTenant();
  const superAdminRole = await db.role.findFirstOrThrow({
    where: { tenantId: tenant.user.tenantId, name: "Super Admin" }
  });
  await db.user.create({
    data: {
      tenantId: tenant.user.tenantId,
      roleId: superAdminRole.id,
      email,
      name: "Platform Admin",
      passwordHash: await bcrypt.hash("rahasia123", 10),
      isPlatformAdmin: true
    }
  });
  return login("demo", email, "rahasia123");
}

type EquityClassName =
  | "SIMPANAN_POKOK"
  | "SIMPANAN_WAJIB"
  | "MODAL_TETAP"
  | "CADANGAN_UMUM"
  | "CADANGAN_RISIKO"
  | "HIBAH"
  | "MODAL_PENYERTAAN"
  | "SHU"
  | "EKUITAS_LAIN";

/**
 * Books `amount` of equity straight into the ledger: Kas (debit) against an
 * EKUITAS account of `equityClass` (credit; a negative amount books the
 * reverse). Creates the two accounts on first use. Lets Modal Sendiri tests
 * set up balances without going through savings configs and mappings.
 */
export async function postEquity(
  tenantId: string,
  equityClass: EquityClassName,
  amount: number | string,
  opts: { entryDate?: Date; unitId?: string | null } = {}
) {
  const kas =
    (await db.account.findFirst({ where: { tenantId, code: "T-KAS" } })) ??
    (await db.account.create({
      data: { tenantId, code: "T-KAS", name: "Kas (test)", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true }
    }));
  const code = `T-${equityClass}`;
  const equity =
    (await db.account.findFirst({ where: { tenantId, code } })) ??
    (await db.account.create({
      data: { tenantId, code, name: `${equityClass} (test)`, category: "EKUITAS", normalBalance: "KREDIT", equityClass }
    }));
  const value = Number(amount);
  const abs = Math.abs(value).toFixed(2);
  await db.journalEntry.create({
    data: {
      tenantId,
      unitId: opts.unitId ?? null,
      entryDate: opts.entryDate ?? new Date("2026-01-15T00:00:00Z"),
      sourceType: "MANUAL",
      description: `Ekuitas ${equityClass} (test)`,
      lines: {
        create:
          value >= 0
            ? [
                { tenantId, accountId: kas.id, debit: abs, credit: 0 },
                { tenantId, accountId: equity.id, debit: 0, credit: abs }
              ]
            : [
                { tenantId, accountId: equity.id, debit: abs, credit: 0 },
                { tenantId, accountId: kas.id, debit: 0, credit: abs }
              ]
      }
    }
  });
}
