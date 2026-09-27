import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

interface ExpenseAccounts {
  debitAccounts: Array<{ id: string; code: string; name: string }>;
  creditAccounts: Array<{ id: string; code: string; name: string }>;
}

async function getExpenseAccounts(accessToken: string): Promise<ExpenseAccounts> {
  const res = await request(app()).get("/api/expenses/accounts").set(bearer(accessToken));
  expect(res.status).toBe(200);
  return res.body.data as ExpenseAccounts;
}

async function createExpense(accessToken: string, overrides: Record<string, unknown> = {}) {
  const { debitAccounts, creditAccounts } = await getExpenseAccounts(accessToken);
  const gaji = debitAccounts.find((a) => a.code === "5-2000")!;
  const kas = creditAccounts.find((a) => a.code === "1-1000")!;
  return request(app())
    .post("/api/expenses")
    .set(bearer(accessToken))
    .send({
      entryDate: "2026-09-27",
      description: "Gaji staf September",
      amount: 500_000,
      debitAccountId: gaji.id,
      creditAccountId: kas.id,
      ...overrides
    });
}

describe("GET /api/expenses/accounts", () => {
  it("returns BEBAN and cash-equivalent accounts for a freshly provisioned tenant, no accounting entitlement needed", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const { debitAccounts, creditAccounts } = await getExpenseAccounts(admin.accessToken);

    expect(debitAccounts.some((a) => a.code === "5-2000")).toBe(true); // Beban Operasional — Gaji
    expect(debitAccounts.every((a) => a.code.startsWith("5-"))).toBe(true);
    expect(creditAccounts.some((a) => a.code === "1-1000")).toBe(true); // Kas
    expect(creditAccounts.some((a) => a.code === "1-1010")).toBe(true); // Bank
  });
});

describe("POST /api/expenses", () => {
  it("books a balanced MANUAL_EXPENSE journal entry", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await createExpense(admin.accessToken);

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe("500000");
    expect(res.body.data.debitAccountName).toBe("Beban Operasional — Gaji");
    expect(res.body.data.creditAccountName).toBe("Kas");
    expect(res.body.data.unitId).toBeNull();

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "MANUAL_EXPENSE" },
      include: { lines: true }
    });
    expect(entry.status).toBe("POSTED");
    expect(entry.lines).toHaveLength(2);
  });

  it("rejects a debit account that isn't a BEBAN category", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const { creditAccounts } = await getExpenseAccounts(admin.accessToken);
    const kas = creditAccounts.find((a) => a.code === "1-1000")!;

    const res = await createExpense(admin.accessToken, { debitAccountId: kas.id });

    expect(res.status).toBe(422);
  });

  it("rejects a credit account that isn't cash-equivalent", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const { debitAccounts } = await getExpenseAccounts(admin.accessToken);
    const gaji = debitAccounts.find((a) => a.code === "5-2000")!;

    const res = await createExpense(admin.accessToken, { creditAccountId: gaji.id });

    expect(res.status).toBe(422);
  });

  it("rejects an account id belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" }, { entitled: false });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" }, { entitled: false });
    const { debitAccounts } = await getExpenseAccounts(tenantB.accessToken);
    const gajiB = debitAccounts.find((a) => a.code === "5-2000")!;

    const res = await createExpense(tenantA.accessToken, { debitAccountId: gajiB.id });

    expect(res.status).toBe(404);
  });

  it("accepts an optional unitId and rejects one from another tenant", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER" }, { entitled: false });
    const otherUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: other.user.tenantId } });

    const ok = await createExpense(admin.accessToken, { unitId: unit.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.unitId).toBe(unit.id);

    const cross = await createExpense(admin.accessToken, { unitId: otherUnit.id });
    expect(cross.status).toBe(404);
  });

  it("403s a Kasir, who has no expenses permission", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");
    const { debitAccounts, creditAccounts } = await getExpenseAccounts(admin.accessToken);
    const gaji = debitAccounts.find((a) => a.code === "5-2000")!;
    const kas = creditAccounts.find((a) => a.code === "1-1000")!;

    const res = await request(app())
      .post("/api/expenses")
      .set(bearer(kasir.accessToken))
      .send({
        entryDate: "2026-09-27",
        description: "Gaji staf September",
        amount: 500_000,
        debitAccountId: gaji.id,
        creditAccountId: kas.id
      });

    expect(res.status).toBe(403);
  });

  it("403s a Kasir on GET /expenses/accounts too — no expenses permission means no visibility at all", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    const res = await request(app()).get("/api/expenses/accounts").set(bearer(kasir.accessToken));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/expenses", () => {
  it("lists an expense and filters by unitId", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await createExpense(admin.accessToken, { description: "Tenant-level expense" });
    await createExpense(admin.accessToken, { description: "Unit expense", unitId: unit.id });

    const all = await request(app()).get("/api/expenses").set(bearer(admin.accessToken));
    expect(all.body.data).toHaveLength(2);

    const scoped = await request(app()).get(`/api/expenses?unitId=${unit.id}`).set(bearer(admin.accessToken));
    expect(scoped.body.data).toHaveLength(1);
    expect(scoped.body.data[0].description).toBe("Unit expense");
  });
});

describe("DELETE /api/expenses/:id", () => {
  it("deletes an expense and its journal lines", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const created = await createExpense(admin.accessToken);

    const res = await request(app()).delete(`/api/expenses/${created.body.data.id}`).set(bearer(admin.accessToken));
    expect(res.status).toBe(200);

    const entry = await db.journalEntry.findFirst({
      where: { id: created.body.data.id, tenantId: admin.user.tenantId }
    });
    expect(entry).toBeNull();
    const lines = await db.journalLine.findMany({
      where: { journalEntryId: created.body.data.id, tenantId: admin.user.tenantId }
    });
    expect(lines).toHaveLength(0);
  });

  it("404s deleting an id that isn't a MANUAL_EXPENSE entry", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const other = await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "not an expense",
        status: "POSTED"
      }
    });

    const res = await request(app()).delete(`/api/expenses/${other.id}`).set(bearer(admin.accessToken));
    expect(res.status).toBe(404);
  });
});
