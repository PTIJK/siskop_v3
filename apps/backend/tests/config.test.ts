import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createStaffSession, setupTenant } from "./helpers.js";

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

const KASIR_ROLE = {
  name: "Kasir",
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
  it("lists the 4 seed roles and creates a new one", async () => {
    const admin = await setupTenant();
    const list = await request(app()).get("/api/config/roles").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.data).toHaveLength(4);

    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(KASIR_ROLE);
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("Kasir");
  });

  it("updates a role's permissions", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(KASIR_ROLE);

    const res = await request(app())
      .put(`/api/config/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ permissions: { ...KASIR_ROLE.permissions, loans: { read: true } } });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions.loans.read).toBe(true);
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
      .send(KASIR_ROLE);

    const res = await request(app())
      .delete(`/api/config/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
  });

  it("lets a Manager list roles but not create one — Manager only has roles.read", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const list = await request(app()).get("/api/config/roles").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(list.status).toBe(200);

    const created = await request(app())
      .post("/api/config/roles")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send(KASIR_ROLE);
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
