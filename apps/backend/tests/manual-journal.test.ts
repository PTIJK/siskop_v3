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

/** Account ids of the auto-provisioned standard COA, by code. */
async function accountIds(tenantId: string) {
  const accounts = await db.account.findMany({ where: { tenantId } });
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  return {
    kas: id("1-1000"),
    piutang: id("1-1100"),
    penyisihan: id("1-1190"),
    bebanPenyisihan: id("5-3000"),
    asetTetapHeader: id("1-2000"),
    pendapatanLain: id("4-9000")
  };
}

function post(token: string, body: Record<string, unknown>) {
  return request(app()).post("/api/journal").set(bearer(token)).send(body);
}

const validBody = (a: Awaited<ReturnType<typeof accountIds>>, over: Record<string, unknown> = {}) => ({
  entryDate: "2026-09-30",
  description: "Penyisihan piutang September",
  entryType: "PENYESUAIAN",
  lines: [
    { accountId: a.bebanPenyisihan, debit: 100_000 },
    { accountId: a.penyisihan, credit: 100_000 }
  ],
  ...over
});

describe("POST /api/journal", () => {
  it("books a balanced manual entry with a per-tenant running number", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);

    const first = await post(admin.accessToken, validBody(a));
    const second = await post(admin.accessToken, validBody(a, { description: "Koreksi lain" }));

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ entryNo: 1, entryType: "PENYESUAIAN", sourceType: "MANUAL", unitId: null });
    expect(first.body.data.lines).toHaveLength(2);
    expect(second.body.data.entryNo).toBe(2);
    const stored = await db.journalEntry.findFirstOrThrow({ where: { id: first.body.data.id, tenantId: admin.user.tenantId } });
    expect(stored.createdById).toBe(admin.user.id);
  });

  it("numbers each tenant independently", async () => {
    const admin = await setupTenant();
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" });
    await post(admin.accessToken, validBody(await accountIds(admin.user.tenantId)));

    const res = await post(other.accessToken, validBody(await accountIds(other.user.tenantId)));

    expect(res.body.data.entryNo).toBe(1);
  });

  it("counts a PENYESUAIAN entry in the Neraca (contra reduces Aset)", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);
    await post(admin.accessToken, {
      entryDate: "2026-09-01",
      description: "Modal awal",
      entryType: "UMUM",
      lines: [
        { accountId: a.kas, debit: 1_000_000 },
        { accountId: a.pendapatanLain, credit: 1_000_000 }
      ]
    });
    await post(admin.accessToken, validBody(a));

    const neraca = await request(app())
      .get("/api/reports/regulatory/neraca")
      .query({ asOfDate: "2026-09-30" })
      .set(bearer(admin.accessToken));

    expect(neraca.body.data.aset.total).toBe("900000");
    expect(neraca.body.data.balanced).toBe(true);
  });

  it("rejects an unbalanced entry", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);

    const res = await post(
      admin.accessToken,
      validBody(a, {
        lines: [
          { accountId: a.bebanPenyisihan, debit: 100_000 },
          { accountId: a.penyisihan, credit: 90_000 }
        ]
      })
    );

    expect(res.status).toBe(422);
    expect(await db.journalEntry.count({ where: { tenantId: admin.user.tenantId } })).toBe(0);
  });

  it.each([
    ["a single line", (a: Awaited<ReturnType<typeof accountIds>>) => [{ accountId: a.kas, debit: 5 }]],
    [
      "a line with both debit and credit",
      (a: Awaited<ReturnType<typeof accountIds>>) => [
        { accountId: a.kas, debit: 5, credit: 5 },
        { accountId: a.pendapatanLain, credit: 0 }
      ]
    ],
    [
      "a zero-amount line",
      (a: Awaited<ReturnType<typeof accountIds>>) => [
        { accountId: a.kas, debit: 0 },
        { accountId: a.pendapatanLain, credit: 0 }
      ]
    ],
    [
      "a negative amount",
      (a: Awaited<ReturnType<typeof accountIds>>) => [
        { accountId: a.kas, debit: -5 },
        { accountId: a.pendapatanLain, credit: -5 }
      ]
    ]
  ])("rejects %s", async (_label, makeLines) => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);

    const res = await post(admin.accessToken, validBody(a, { lines: makeLines(a) }));

    expect(res.status).toBe(422);
  });

  it("rejects a header account and an account from another tenant", async () => {
    const admin = await setupTenant();
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" });
    const a = await accountIds(admin.user.tenantId);
    const foreign = await accountIds(other.user.tenantId);

    const header = await post(
      admin.accessToken,
      validBody(a, {
        lines: [
          { accountId: a.asetTetapHeader, debit: 10 },
          { accountId: a.kas, credit: 10 }
        ]
      })
    );
    const cross = await post(
      admin.accessToken,
      validBody(a, {
        lines: [
          { accountId: foreign.kas, debit: 10 },
          { accountId: a.kas, credit: 10 }
        ]
      })
    );

    expect(header.status).toBe(422);
    expect(cross.status).toBe(404);
  });

  it("books to a unit of the tenant and rejects another tenant's unit", async () => {
    const admin = await setupTenant();
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" });
    const a = await accountIds(admin.user.tenantId);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const foreignUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: other.user.tenantId } });

    const ok = await post(admin.accessToken, validBody(a, { unitId: unit.id }));
    const cross = await post(admin.accessToken, validBody(a, { unitId: foreignUnit.id }));

    expect(ok.status).toBe(201);
    expect(ok.body.data.unitId).toBe(unit.id);
    expect(cross.status).toBe(404);
  });

  it("403s a role without accounting permission", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await post(viewer.accessToken, validBody(a));

    expect(res.status).toBe(403);
  });
});

describe("POST /api/journal/:id/reverse", () => {
  it("books a mirror entry that cancels the original and links back to it", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);
    const original = (await post(admin.accessToken, validBody(a))).body.data;

    const res = await request(app())
      .post(`/api/journal/${original.id}/reverse`)
      .set(bearer(admin.accessToken))
      .send({ entryDate: "2026-10-01" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ reversalOfId: original.id, entryNo: 2, entryType: "PENYESUAIAN" });
    const net = await db.journalLine.groupBy({ by: ["accountId"], where: { tenantId: admin.user.tenantId }, _sum: { debit: true, credit: true } });
    for (const row of net) expect(Number(row._sum.debit)).toBe(Number(row._sum.credit));
  });

  it("refuses a second reversal (409) and reversing a reversal (422)", async () => {
    const admin = await setupTenant();
    const a = await accountIds(admin.user.tenantId);
    const original = (await post(admin.accessToken, validBody(a))).body.data;
    const reversal = await request(app()).post(`/api/journal/${original.id}/reverse`).set(bearer(admin.accessToken)).send({});

    const again = await request(app()).post(`/api/journal/${original.id}/reverse`).set(bearer(admin.accessToken)).send({});
    const reverseReversal = await request(app()).post(`/api/journal/${reversal.body.data.id}/reverse`).set(bearer(admin.accessToken)).send({});

    expect(again.status).toBe(409);
    expect(reverseReversal.status).toBe(422);
  });

  it("only reverses manual entries, never a system-posted one", async () => {
    const admin = await setupTenant();
    const system = await db.journalEntry.create({
      data: { tenantId: admin.user.tenantId, entryDate: new Date(), sourceType: "POS_SALE", description: "Penjualan" }
    });

    const res = await request(app()).post(`/api/journal/${system.id}/reverse`).set(bearer(admin.accessToken)).send({});

    expect(res.status).toBe(422);
  });

  it("404s another tenant's entry", async () => {
    const admin = await setupTenant();
    const other = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" });
    const entry = (await post(other.accessToken, validBody(await accountIds(other.user.tenantId)))).body.data;

    const res = await request(app()).post(`/api/journal/${entry.id}/reverse`).set(bearer(admin.accessToken)).send({});

    expect(res.status).toBe(404);
  });
});
