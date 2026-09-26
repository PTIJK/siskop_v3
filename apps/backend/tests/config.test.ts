import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createPlatformAdminSession, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const ASET_HEADER = { code: "1000", name: "Aset", category: "ASET" as const, normalBalance: "DEBIT" as const, isHeader: true };
const KAS = { code: "1100", name: "Kas", category: "ASET" as const, normalBalance: "DEBIT" as const, isCashEquivalent: true };
const SIMPANAN_SUKARELA_ACC = { code: "2100", name: "Simpanan Sukarela", category: "KEWAJIBAN" as const, normalBalance: "KREDIT" as const };

async function createAccountAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...KAS, ...overrides });
  return res.body.data as { id: string; code: string };
}

// ── Units ────────────────────────────────────────────────────────────────────

describe("GET/POST/PUT /api/config/units", () => {
  it("lists the tenant's units, including the one auto-created at provisioning", async () => {
    const admin = await setupTenant();
    const res = await request(app()).get("/api/config/units").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe("KSP");
  });

  it("creates a second unit and updates its name", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/config/units")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "KONSUMEN", name: "Unit Konsumen" });
    expect(created.status).toBe(201);

    const updated = await request(app())
      .put(`/api/config/units/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Unit Konsumen Baru" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Unit Konsumen Baru");
  });

  it("rejects deactivating the tenant's only active unit", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .put(`/api/config/units/${unit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
  });

  it("allows deactivating a unit once a second active unit exists", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await request(app())
      .post("/api/config/units")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "KONSUMEN", name: "Unit Konsumen" });

    const res = await request(app())
      .put(`/api/config/units/${unit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });

  it("audits a unit deactivation with before/after isActive", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await request(app())
      .post("/api/config/units")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "KONSUMEN", name: "Unit Konsumen" });

    await request(app())
      .put(`/api/config/units/${unit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "unit.update", entityId: unit.id }
    });
    expect(log.actorUserId).toBe(admin.user.id);
    expect(log.before).toMatchObject({ isActive: true });
    expect(log.after).toMatchObject({ isActive: false });
  });

  it("writes no audit row when a unit update fails validation (rolled back atomically)", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .put(`/api/config/units/${unit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(409);

    const count = await db.auditLog.count({ where: { tenantId: admin.user.tenantId, action: "unit.update" } });
    expect(count).toBe(0);
  });

  it("rejects a viewer — config.update is not granted to that role", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/config/units")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ type: "KONSUMEN", name: "Unit Konsumen" });

    expect(res.status).toBe(403);
  });

  it("cannot update another tenant's unit", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });

    const res = await request(app())
      .put(`/api/config/units/${unitB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "Hijack" });

    expect(res.status).toBe(404);
  });
});

// ── Roles ────────────────────────────────────────────────────────────────────

// Named distinctly from the seeded "Kasir" role (tenants/provision.ts) so this
// custom-role fixture never collides with it in a tenant's role list.
const CUSTOM_ROLE = {
  name: "Frontliner",
  permissions: {
    dashboard: { read: true },
    members: { read: true },
    savings: { create: true, read: true },
    loans: {},
    reports: {},
    config: {},
    users: {},
    roles: {}
  }
};

describe("GET/POST/PUT/DELETE /api/config/roles", () => {
  it("lists the 5 seed roles and creates a new one", async () => {
    const admin = await setupTenant();
    const list = await request(app()).get("/api/config/roles").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.data).toHaveLength(5);

    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(CUSTOM_ROLE);
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("Frontliner");
  });

  it("updates a role's permissions", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(CUSTOM_ROLE);

    const res = await request(app())
      .put(`/api/config/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ permissions: { ...CUSTOM_ROLE.permissions, loans: { read: true } } });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions.loans.read).toBe(true);
  });

  it("audits role creation and updates with before/after permissions", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(CUSTOM_ROLE);

    const createLog = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "role.create", entityId: created.body.data.id }
    });
    expect(createLog.actorUserId).toBe(admin.user.id);
    expect(createLog.after).toMatchObject({ name: "Frontliner" });

    await request(app())
      .put(`/api/config/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ permissions: { ...CUSTOM_ROLE.permissions, loans: { read: true } } });

    const updateLog = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "role.update", entityId: created.body.data.id }
    });
    expect((updateLog.before as { permissions: { loans: unknown } }).permissions.loans).toEqual({});
    expect((updateLog.after as { permissions: { loans: unknown } }).permissions.loans).toEqual({ read: true });
  });

  it("writes no audit row when a role update 404s (rolled back atomically)", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/config/roles/does-not-exist")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);

    const count = await db.auditLog.count({ where: { tenantId: admin.user.tenantId, action: "role.update" } });
    expect(count).toBe(0);
  });

  it("rejects deleting a role that still has a user assigned", async () => {
    const admin = await setupTenant();
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });
    await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .delete(`/api/config/roles/${tellerRole.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(409);
  });

  it("deletes a role with no users assigned", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(CUSTOM_ROLE);

    const res = await request(app())
      .delete(`/api/config/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "role.delete", entityId: created.body.data.id }
    });
    expect(log.before).toMatchObject({ name: "Frontliner" });
  });

  it("writes no audit row when a role deletion is blocked by an assigned user", async () => {
    const admin = await setupTenant();
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });
    await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .delete(`/api/config/roles/${tellerRole.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(409);

    const count = await db.auditLog.count({ where: { tenantId: admin.user.tenantId, action: "role.delete" } });
    expect(count).toBe(0);
  });

  it("lets a Manager list roles but not create one — Manager only has roles.read", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const list = await request(app()).get("/api/config/roles").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(list.status).toBe(200);

    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send(CUSTOM_ROLE);
    expect(created.status).toBe(403);
  });

  it("cannot delete another tenant's role", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const roleB = await db.role.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId, name: "Viewer" } });

    const res = await request(app())
      .delete(`/api/config/roles/${roleB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
  });
});

// ── Accounts (Chart of Accounts) ──────────────────────────────────────────────

describe("GET/POST/PUT /api/config/accounts", () => {
  it("creates a header account and a child account under it", async () => {
    const admin = await setupTenant();
    const header = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(ASET_HEADER);
    expect(header.status).toBe(201);

    const child = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...KAS, parentId: header.body.data.id });
    expect(child.status).toBe(201);
    expect(child.body.data.parentId).toBe(header.body.data.id);
  });

  it("rejects a duplicate account code within the same tenant", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken);

    const res = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(KAS);

    expect(res.status).toBe(409);
  });

  it("rejects a parentId belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const headerB = await createAccountAs(tenantB.accessToken, ASET_HEADER);

    const res = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ ...KAS, parentId: headerB.id });

    expect(res.status).toBe(404);
  });

  it("updates an account's name", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken);

    const res = await request(app())
      .put(`/api/config/accounts/${account.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Kas Utama" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Kas Utama");
  });

  it("rejects deactivating an account that has child accounts", async () => {
    const admin = await setupTenant();
    const header = await createAccountAs(admin.accessToken, ASET_HEADER);
    await createAccountAs(admin.accessToken, { ...KAS, parentId: header.id });

    const res = await request(app())
      .put(`/api/config/accounts/${header.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
  });

  it("rejects deactivating an account referenced by an account mapping", async () => {
    const admin = await setupTenant();
    const kas = await createAccountAs(admin.accessToken);
    const simpanan = await createAccountAs(admin.accessToken, SIMPANAN_SUKARELA_ACC);
    const config = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 3, periodUnit: "YEARLY" });
    await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        sourceType: "SAVING_CONFIG",
        sourceId: config.body.data.id,
        transactionKind: "DEPOSIT",
        debitAccountId: kas.id,
        creditAccountId: simpanan.id
      });

    const res = await request(app())
      .put(`/api/config/accounts/${kas.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
  });
});

// ── Generate Standard COA ─────────────────────────────────────────────────────

const KUR_MIKRO = {
  name: "KUR Mikro",
  type: "KONVENSIONAL" as const,
  rateType: "BUNGA" as const,
  rate: 12,
  maxTermMonths: 36
};

describe("POST /api/config/accounts/generate-standard", () => {
  it("creates the full standard COA template for a fresh tenant with no configs", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.accountsCreated).toBeGreaterThan(0);
    expect(res.body.data.accountsSkipped).toBe(0);
    expect(res.body.data.mappingsCreated).toBe(0);

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(accounts.body.data.length).toBe(res.body.data.accountsCreated);
    expect(accounts.body.data.some((a: { code: string }) => a.code === "1-1000")).toBe(true);
  });

  it("is idempotent — calling it again creates nothing new", async () => {
    const admin = await setupTenant();
    const first = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const second = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(second.status).toBe(200);
    expect(second.body.data.accountsCreated).toBe(0);
    expect(second.body.data.accountsSkipped).toBe(first.body.data.accountsCreated);
    expect(second.body.data.mappingsCreated).toBe(0);
  });

  it("wires default mappings for existing saving and loan configs", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 3, periodUnit: "YEARLY" });
    await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(KUR_MIKRO);

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(201);
    // 2 mappings per saving config (deposit/withdrawal) + 4 per loan config
    // (disbursement/principal/interest/penalty).
    expect(res.body.data.mappingsCreated).toBe(2 + 4);

    const mappings = await request(app())
      .get("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(mappings.body.data).toHaveLength(6);
    const kinds = mappings.body.data.map((m: { transactionKind: string }) => m.transactionKind).sort();
    expect(kinds).toEqual(
      ["DEPOSIT", "DISBURSEMENT", "PAYMENT_INTEREST", "PAYMENT_PENALTY", "PAYMENT_PRINCIPAL", "WITHDRAWAL"].sort()
    );
  });

  it("skips an account that was already created manually, without conflicting", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, { code: "1-1000", name: "Kas Lama" });

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.accountsSkipped).toBe(1);

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const kasAccounts = accounts.body.data.filter((a: { code: string }) => a.code === "1-1000");
    expect(kasAccounts).toHaveLength(1);
    expect(kasAccounts[0].name).toBe("Kas Lama");
  });

  it("blocks a tenant with no accounting entitlement", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("rejects a Viewer — accounting.create is not granted to that role", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
  });

  it("does not touch another tenant's accounts", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    await request(app())
      .post("/api/config/accounts/generate-standard")
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    const accountsB = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${tenantB.accessToken}`);
    expect(accountsB.body.data).toHaveLength(0);
  });
});

// ── Generate Standard COA — Toko (KONSUMEN unit) wiring ───────────────────────
// Without these accounts + SYSTEM/SALE_* mappings a Toko sale posts as
// UNPOSTED_MISSING_MAPPING and never reaches Neraca/Laba Rugi for any tenant
// that didn't get them from prisma/seed-ksu-demo.ts.

const TOKO_MAPPING_KINDS = ["MEMBER_CREDIT_REPAYMENT", "SALE_COGS", "SALE_RECEIVABLE", "SALE_REVENUE", "STOCK_PURCHASE"];

async function createKonsumenUnit(accessToken: string) {
  await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type: "KONSUMEN", name: "Toko Koperasi" });
}

function generateStandard(accessToken: string) {
  return request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${accessToken}`);
}

async function listAccountCodes(accessToken: string): Promise<string[]> {
  const res = await request(app()).get("/api/config/accounts").set("Authorization", `Bearer ${accessToken}`);
  return res.body.data.map((a: { code: string }) => a.code);
}

async function listSystemMappings(accessToken: string) {
  const res = await request(app()).get("/api/config/account-mappings").set("Authorization", `Bearer ${accessToken}`);
  return (res.body.data as Array<{
    sourceType: string;
    transactionKind: string;
    debitAccountName: string;
    creditAccountName: string;
  }>).filter((m) => m.sourceType === "SYSTEM");
}

describe("POST /api/config/accounts/generate-standard — Toko (KONSUMEN unit)", () => {
  it("adds the four Toko accounts and the five SYSTEM Toko mappings when the tenant has a KONSUMEN unit", async () => {
    const admin = await setupTenant();
    await createKonsumenUnit(admin.accessToken);

    const res = await generateStandard(admin.accessToken);

    expect(res.status).toBe(201);
    expect(res.body.data.mappingsCreated).toBe(5);
    expect(await listAccountCodes(admin.accessToken)).toEqual(
      expect.arrayContaining(["1-1150", "1-1300", "4-3000", "5-4000"])
    );

    const system = await listSystemMappings(admin.accessToken);
    expect(system.map((m) => m.transactionKind).sort()).toEqual(TOKO_MAPPING_KINDS);
    const byKind = Object.fromEntries(system.map((m) => [m.transactionKind, m]));
    expect(byKind.SALE_REVENUE).toMatchObject({ debitAccountName: "Kas", creditAccountName: "Penjualan Barang Dagang" });
    expect(byKind.SALE_COGS).toMatchObject({
      debitAccountName: "Harga Pokok Penjualan",
      creditAccountName: "Persediaan Barang Dagang"
    });
    expect(byKind.SALE_RECEIVABLE).toMatchObject({
      debitAccountName: "Piutang Anggota (Toko)",
      creditAccountName: "Penjualan Barang Dagang"
    });
    expect(byKind.MEMBER_CREDIT_REPAYMENT).toMatchObject({
      debitAccountName: "Kas",
      creditAccountName: "Piutang Anggota (Toko)"
    });
    // A restock: the shelf gains goods, the koperasi pays cash (an admin can remap the credit to Utang Usaha).
    expect(byKind.STOCK_PURCHASE).toMatchObject({
      debitAccountName: "Persediaan Barang Dagang",
      creditAccountName: "Kas"
    });
  });

  it("adds no Toko accounts or SYSTEM mappings for a tenant that only has a KSP unit", async () => {
    const admin = await setupTenant();

    const res = await generateStandard(admin.accessToken);

    expect(res.body.data.mappingsCreated).toBe(0);
    const codes = await listAccountCodes(admin.accessToken);
    for (const tokoCode of ["1-1150", "1-1300", "4-3000", "5-4000"]) {
      expect(codes).not.toContain(tokoCode);
    }
    expect(await listSystemMappings(admin.accessToken)).toHaveLength(0);
  });

  it("picks Toko up on a re-run once a KONSUMEN unit is added later", async () => {
    const admin = await setupTenant();
    const first = await generateStandard(admin.accessToken);
    expect(first.body.data.mappingsCreated).toBe(0);

    await createKonsumenUnit(admin.accessToken);
    const second = await generateStandard(admin.accessToken);

    expect(second.status).toBe(201);
    // The four Toko accounts, plus Modal Tetap USP now that the koperasi is multi-unit.
    expect(second.body.data.accountsCreated).toBe(5);
    expect(second.body.data.mappingsCreated).toBe(5);
  });

  it("is idempotent — a second run creates nothing", async () => {
    const admin = await setupTenant();
    await createKonsumenUnit(admin.accessToken);
    await generateStandard(admin.accessToken);

    const second = await generateStandard(admin.accessToken);

    expect(second.status).toBe(200);
    expect(second.body.data.accountsCreated).toBe(0);
    expect(second.body.data.mappingsCreated).toBe(0);
    expect(second.body.data.mappingsSkipped).toBe(5);
  });

  it("does not create duplicate Toko accounts when the SYSTEM sale mappings were already set up by hand", async () => {
    const admin = await setupTenant();
    await createKonsumenUnit(admin.accessToken);
    const kas = await createAccountAs(admin.accessToken, { code: "1-1000", name: "Kas" });
    const penjualan = await createAccountAs(admin.accessToken, {
      code: "4-2000",
      name: "Penjualan Toko",
      category: "PENDAPATAN",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
    const hpp = await createAccountAs(admin.accessToken, {
      code: "5-1000",
      name: "HPP",
      category: "BEBAN",
      normalBalance: "DEBIT",
      isCashEquivalent: false
    });
    const persediaan = await createAccountAs(admin.accessToken, {
      code: "1-1300",
      name: "Persediaan Barang Dagang",
      category: "ASET",
      normalBalance: "DEBIT",
      isCashEquivalent: false
    });
    const piutang = await createAccountAs(admin.accessToken, {
      code: "1-1150",
      name: "Piutang Anggota (Toko)",
      category: "ASET",
      normalBalance: "DEBIT",
      isCashEquivalent: false
    });
    const manual = [
      ["SALE_REVENUE", kas.id, penjualan.id],
      ["SALE_COGS", hpp.id, persediaan.id],
      ["SALE_RECEIVABLE", piutang.id, penjualan.id],
      ["MEMBER_CREDIT_REPAYMENT", kas.id, piutang.id],
      ["STOCK_PURCHASE", persediaan.id, kas.id]
    ] as const;
    for (const [transactionKind, debitAccountId, creditAccountId] of manual) {
      await request(app())
        .post("/api/config/account-mappings")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ sourceType: "SYSTEM", transactionKind, debitAccountId, creditAccountId });
    }

    const res = await generateStandard(admin.accessToken);

    expect(res.body.data.mappingsCreated).toBe(0);
    expect(res.body.data.mappingsSkipped).toBeGreaterThanOrEqual(5);
    const codes = await listAccountCodes(admin.accessToken);
    expect(codes).not.toContain("4-3000");
    expect(codes).not.toContain("5-4000");
    // The hand-made mappings still point at the hand-made accounts.
    const system = await listSystemMappings(admin.accessToken);
    expect(system.find((m) => m.transactionKind === "SALE_REVENUE")?.creditAccountName).toBe("Penjualan Toko");
  });
});

// ── Equity classification (Permenkop UKM 8/2023 Modal Sendiri) ────────────────
// Every EKUITAS account carries an equityClass so Modal Sendiri, the Neraca
// equity grouping and the Laporan Perubahan Ekuitas columns are derived from
// the ledger instead of a hand-typed "modal disetor" figure.

async function listAccounts(accessToken: string) {
  const res = await request(app()).get("/api/config/accounts").set("Authorization", `Bearer ${accessToken}`);
  return res.body.data as Array<{ id: string; code: string; name: string; equityClass: string | null }>;
}

describe("Account.equityClass", () => {
  it("generates the split equity accounts, each with its equity class", async () => {
    const admin = await setupTenant();
    await generateStandard(admin.accessToken);

    const byCode = new Map((await listAccounts(admin.accessToken)).map((a) => [a.code, a]));
    expect(byCode.get("3-1000")?.equityClass).toBe("SIMPANAN_POKOK");
    expect(byCode.get("3-1100")?.equityClass).toBe("SIMPANAN_WAJIB");
    expect(byCode.get("3-2000")).toMatchObject({ name: "Cadangan Umum", equityClass: "CADANGAN_UMUM" });
    expect(byCode.get("3-2100")?.equityClass).toBe("CADANGAN_RISIKO");
    expect(byCode.get("3-3000")?.equityClass).toBe("SHU");
    expect(byCode.get("3-3100")?.equityClass).toBe("SHU");
    expect(byCode.get("3-4000")?.equityClass).toBe("HIBAH");
    expect(byCode.get("3-5000")?.equityClass).toBe("MODAL_PENYERTAAN");
    expect(byCode.get("3-9000")?.equityClass).toBe("EKUITAS_LAIN");
  });

  it("adds a Modal Tetap USP account only for a multi-unit (KSU) koperasi", async () => {
    const single = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const ksu = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await createKonsumenUnit(ksu.accessToken);

    await generateStandard(single.accessToken);
    await generateStandard(ksu.accessToken);

    expect((await listAccounts(single.accessToken)).some((a) => a.code === "3-6000")).toBe(false);
    expect((await listAccounts(ksu.accessToken)).find((a) => a.code === "3-6000")).toMatchObject({
      name: "Modal Tetap USP",
      equityClass: "MODAL_TETAP"
    });
  });

  it("leaves non-equity template accounts unclassified", async () => {
    const admin = await setupTenant();
    await generateStandard(admin.accessToken);

    const kas = (await listAccounts(admin.accessToken)).find((a) => a.code === "1-1000");
    expect(kas?.equityClass).toBeNull();
  });

  it("classifies an existing unclassified template equity account on re-generate", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Simpanan Pokok",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });

    await generateStandard(admin.accessToken);

    const pokok = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(pokok?.equityClass).toBe("SIMPANAN_POKOK");
  });

  it("leaves a template-coded account with a different name unclassified — the code alone can't say what it holds", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Modal Kerja",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-1000");
    expect(account).toMatchObject({ name: "Modal Kerja", equityClass: null });
  });

  it("does not overwrite an equity class the tenant already chose", async () => {
    const admin = await setupTenant();
    await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan / Modal Penyertaan",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      equityClass: "MODAL_PENYERTAAN"
    });

    await generateStandard(admin.accessToken);

    const account = (await listAccounts(admin.accessToken)).find((a) => a.code === "3-2000");
    expect(account?.equityClass).toBe("MODAL_PENYERTAAN");
  });

  it("creates an EKUITAS account with an equity class", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ code: "3-4100", name: "Hibah Pemda", category: "EKUITAS", normalBalance: "KREDIT", equityClass: "HIBAH" });

    expect(res.status).toBe(201);
    expect(res.body.data.equityClass).toBe("HIBAH");
  });

  it("rejects an equity class on a non-EKUITAS account", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...KAS, equityClass: "HIBAH" });

    expect(res.status).toBe(422);
  });

  it("updates an account's equity class and can clear it", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT"
    });

    const set = await request(app())
      .put(`/api/config/accounts/${account.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ equityClass: "CADANGAN_UMUM" });
    expect(set.status).toBe(200);
    expect(set.body.data.equityClass).toBe("CADANGAN_UMUM");

    const cleared = await request(app())
      .put(`/api/config/accounts/${account.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ equityClass: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.equityClass).toBeNull();
  });

  it("rejects setting an equity class on an existing non-EKUITAS account", async () => {
    const admin = await setupTenant();
    const kas = await createAccountAs(admin.accessToken);

    const res = await request(app())
      .put(`/api/config/accounts/${kas.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ equityClass: "CADANGAN_UMUM" });

    expect(res.status).toBe(422);
  });

  it("clears the equity class when an account moves out of EKUITAS", async () => {
    const admin = await setupTenant();
    const account = await createAccountAs(admin.accessToken, {
      code: "3-2000",
      name: "Cadangan",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      equityClass: "CADANGAN_UMUM"
    });

    const res = await request(app())
      .put(`/api/config/accounts/${account.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ category: "KEWAJIBAN" });

    expect(res.status).toBe(200);
    expect(res.body.data.equityClass).toBeNull();
  });
});

// ── Account Mappings ───────────────────────────────────────────────────────────

describe("GET/POST/DELETE /api/config/account-mappings", () => {
  async function setupMappingFixture(accessToken: string) {
    const kas = await createAccountAs(accessToken);
    const simpanan = await createAccountAs(accessToken, SIMPANAN_SUKARELA_ACC);
    const config = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 3, periodUnit: "YEARLY" });
    return { kas, simpanan, config: config.body.data as { id: string; name: string } };
  }

  it("creates a mapping and lists it with resolved names", async () => {
    const admin = await setupTenant();
    const { kas, simpanan, config } = await setupMappingFixture(admin.accessToken);

    const created = await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "DEPOSIT", debitAccountId: kas.id, creditAccountId: simpanan.id });
    expect(created.status).toBe(201);

    const list = await request(app())
      .get("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].sourceName).toBe("Simpanan Sukarela");
    expect(list.body.data[0].debitAccountName).toBe("Kas");
    expect(list.body.data[0].creditAccountName).toBe("Simpanan Sukarela");
  });

  it("updates the mapping in place when re-submitted for the same source+kind, instead of conflicting", async () => {
    const admin = await setupTenant();
    const { kas, simpanan, config } = await setupMappingFixture(admin.accessToken);
    const otherKas = await createAccountAs(admin.accessToken, { code: "1101", name: "Kas Kecil", category: "ASET", normalBalance: "DEBIT" });

    await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "DEPOSIT", debitAccountId: kas.id, creditAccountId: simpanan.id });

    const res = await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "DEPOSIT", debitAccountId: otherKas.id, creditAccountId: simpanan.id });

    expect(res.status).toBe(200);
    expect(res.body.data.debitAccountId).toBe(otherKas.id);

    const list = await request(app())
      .get("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.data).toHaveLength(1);
  });

  it("deletes a mapping", async () => {
    const admin = await setupTenant();
    const { kas, simpanan, config } = await setupMappingFixture(admin.accessToken);
    const created = await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "DEPOSIT", debitAccountId: kas.id, creditAccountId: simpanan.id });

    const res = await request(app())
      .delete(`/api/config/account-mappings/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);

    const list = await request(app())
      .get("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.data).toHaveLength(0);
  });

  // The end-to-end proof this module closes the gap: before any mapping
  // exists, a real deposit posts as UNPOSTED_MISSING_MAPPING (lib/journal.ts);
  // once a mapping exists for that config+kind, the same action posts.
  it("flips a deposit's journal entry from UNPOSTED_MISSING_MAPPING to POSTED once mapped", async () => {
    const admin = await setupTenant();
    const { kas, simpanan, config } = await setupMappingFixture(admin.accessToken);
    const member = await createMemberAs(admin.accessToken);
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 100_000 });

    const beforeEntry = await db.journalEntry.findFirst({
      where: { tenantId: admin.user.tenantId, sourceType: "SAVING_TRANSACTION" },
      orderBy: { createdAt: "desc" }
    });
    expect(beforeEntry?.status).toBe("UNPOSTED_MISSING_MAPPING");

    await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "DEPOSIT", debitAccountId: kas.id, creditAccountId: simpanan.id });

    await request(app())
      .post(`/api/savings/${saving.body.data.id}/deposit`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 50_000 });

    const afterEntry = await db.journalEntry.findFirst({
      where: { tenantId: admin.user.tenantId, sourceType: "SAVING_TRANSACTION" },
      orderBy: { createdAt: "desc" }
    });
    expect(afterEntry?.status).toBe("POSTED");
  });
});

// ── SHU Distribution ─────────────────────────────────────────────────────────

describe("GET/PUT /api/config/shu-distribution", () => {
  it("returns null when not yet configured", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("saves the allocation and rejects a mix that doesn't add up to 100%", async () => {
    const admin = await setupTenant();
    const rejected = await request(app())
      .put("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ jasaSimpananPercent: 25, jasaPinjamanPercent: 25, cadanganPercent: 40, lainnyaPercent: 5 });
    expect(rejected.status).toBe(422);

    const saved = await request(app())
      .put("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ jasaSimpananPercent: 25, jasaPinjamanPercent: 25, cadanganPercent: 40, lainnyaPercent: 10 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.cadanganPercent).toBe("40");

    const fetched = await request(app())
      .get("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(fetched.body.data.jasaSimpananPercent).toBe("25");
  });
});

// ── Accounting entitlement gate ───────────────────────────────────────────────

describe("accounting entitlement gate", () => {
  it("blocks accounts/account-mappings/shu-distribution for a tenant with no package", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const accounts = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(accounts.status).toBe(403);
    expect(accounts.body.error.code).toBe("FEATURE_NOT_ENTITLED");

    const mappings = await request(app())
      .get("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(mappings.status).toBe(403);

    const shu = await request(app())
      .get("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(shu.status).toBe(403);
  });

  it("blocks a package assigned but without the accounting module", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const admin = await setupTenant({ slug: "noaccounting", registrationNo: "KOP-NOACC" }, { entitled: false });
    const pkg = await request(app())
      .post("/api/platform/packages")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ name: "Paket Dasar", price: 0, modules: [], maxUsers: 5, maxMembers: 100 });
    await db.tenant.update({ where: { id: admin.user.tenantId }, data: { packageId: pkg.body.data.id } });

    const res = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("allows accounts once a package with the accounting module is assigned", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/config/accounts")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Whitelabel ───────────────────────────────────────────────────────────────

describe("GET/PUT /api/config/whitelabel", () => {
  it("returns null when not yet configured", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/config/whitelabel")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("saves whitelabel config for an entitled tenant", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .put("/api/config/whitelabel")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ customDomain: "koperasi-demo.test", primaryColor: "#1D4ED8", hideBranding: true });

    expect(res.status).toBe(200);
    expect(res.body.data.customDomain).toBe("koperasi-demo.test");
    expect(res.body.data.domainStatus).toBe("PENDING");
    expect(res.body.data.hideBranding).toBe(true);
  });

  it("rejects a write for a tenant whose package does not enable whitelabel", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const res = await request(app())
      .put("/api/config/whitelabel")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ primaryColor: "#1D4ED8" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("still allows reading whitelabel config for a non-entitled tenant", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const res = await request(app())
      .get("/api/config/whitelabel")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });

  it("rejects a duplicate custom domain across tenants", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await request(app())
      .put("/api/config/whitelabel")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customDomain: "shared-domain.test" });

    const res = await request(app())
      .put("/api/config/whitelabel")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ customDomain: "shared-domain.test" });
    expect(res.status).toBe(409);
  });
});

// ── Modal Disetor ────────────────────────────────────────────────────────────

describe("GET/PUT /api/config/modal-disetor", () => {
  it("returns null when not yet set", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.modalDisetor).toBeNull();
  });

  it("saves and clears the modal disetor value", async () => {
    const admin = await setupTenant();
    const saved = await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: 6_000_000 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.modalDisetor).toBe("6000000");

    const cleared = await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.modalDisetor).toBeNull();
  });

  it("rejects a negative value", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: -1 });
    expect(res.status).toBe(422);
  });

  it("is not gated by the accounting entitlement", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const res = await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: 1_000_000 });
    expect(res.status).toBe(200);
  });

  async function putModalDisetor(accessToken: string, modalDisetor: unknown) {
    return request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ modalDisetor });
  }

  it("stores a decimal string exactly, without float rounding", async () => {
    const admin = await setupTenant();
    const res = await putModalDisetor(admin.accessToken, "1234567890123.45");
    expect(res.status).toBe(200);
    expect(res.body.data.modalDisetor).toBe("1234567890123.45");
  });

  it("reports the Rp5 miliar audit threshold and whether the tenant has reached it", async () => {
    const admin = await setupTenant();

    const below = await putModalDisetor(admin.accessToken, "4999999999.99");
    expect(below.body.data.auditThreshold).toBe("5000000000");
    expect(below.body.data.auditRequired).toBe(false);

    const atThreshold = await putModalDisetor(admin.accessToken, "5000000000");
    expect(atThreshold.body.data.auditRequired).toBe(true);

    const reread = await request(app())
      .get("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(reread.body.data.auditRequired).toBe(true);

    const cleared = await putModalDisetor(admin.accessToken, null);
    expect(cleared.body.data.auditRequired).toBe(false);
  });

  it("does not flag Rp5 juta as reaching the audit threshold", async () => {
    const admin = await setupTenant();
    const res = await putModalDisetor(admin.accessToken, 5_000_000);
    expect(res.body.data.auditRequired).toBe(false);
  });

  it("rejects a value that does not fit Decimal(15,2) with 422, not a 500", async () => {
    const admin = await setupTenant();
    const res = await putModalDisetor(admin.accessToken, "99999999999999");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects more than two decimal places", async () => {
    const admin = await setupTenant();
    const res = await putModalDisetor(admin.accessToken, "1000.123");
    expect(res.status).toBe(422);
  });

  it("rejects a non-numeric string", async () => {
    const admin = await setupTenant();
    const res = await putModalDisetor(admin.accessToken, "abc");
    expect(res.status).toBe(422);
  });

  it("clears the audit notification stamp when the value drops below the threshold", async () => {
    const admin = await setupTenant();
    await putModalDisetor(admin.accessToken, "6000000000");
    await db.tenant.update({ where: { id: admin.user.tenantId }, data: { auditThresholdNotifiedAt: new Date() } });

    const stillAbove = await putModalDisetor(admin.accessToken, "7000000000");
    expect(stillAbove.body.data.auditThresholdNotifiedAt).not.toBeNull();

    const below = await putModalDisetor(admin.accessToken, "1000000");
    expect(below.body.data.auditThresholdNotifiedAt).toBeNull();
  });
});
