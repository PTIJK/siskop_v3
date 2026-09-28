import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";
import { postCollectionBatchVerification } from "../src/lib/journal.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function accountByName(tenantId: string, name: string) {
  return db.account.findFirstOrThrow({ where: { tenantId, name } });
}

describe("postCollectionBatchVerification", () => {
  it("rejects when Buat COA Standar hasn't been run yet", async () => {
    const admin = await setupTenant();
    // Provisioning now runs the standard COA (incl. SYSTEM/COLLECTOR_CASH)
    // automatically, so a fresh tenant no longer naturally lacks it — remove
    // the mapping to simulate a tenant that somehow still doesn't have it.
    await db.accountMapping.deleteMany({
      where: { tenantId: admin.user.tenantId, sourceType: "SYSTEM", transactionKind: "COLLECTOR_CASH" }
    });

    await expect(
      db.$transaction((tx) =>
        postCollectionBatchVerification(tx, {
          tenantId: admin.user.tenantId,
          batchId: "batch-1",
          entryDate: new Date(),
          received: "90000",
          expected: "100000",
          description: "Verifikasi setoran"
        })
      )
    ).rejects.toThrow();
  });

  it("books a shortfall to Piutang Kolektor and discharges Kas di Kolektor at the expected amount", async () => {
    const admin = await setupTenant();
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);

    await db.$transaction((tx) =>
      postCollectionBatchVerification(tx, {
        tenantId: admin.user.tenantId,
        batchId: "batch-1",
        entryDate: new Date(),
        received: "90000",
        expected: "100000",
        description: "Verifikasi setoran"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "COLLECTION_BATCH", sourceId: "batch-1" },
      include: { lines: true }
    });
    expect(entry.unitId).toBeNull();
    expect(entry.status).toBe("POSTED");

    const totalDebit = entry.lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
    const totalCredit = entry.lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
    expect(totalDebit.toString()).toBe(totalCredit.toString());

    const kasDiKolektor = await accountByName(admin.user.tenantId, "Kas di Kolektor");
    const piutangKolektor = await accountByName(admin.user.tenantId, "Piutang Kolektor");
    const kas = await accountByName(admin.user.tenantId, "Kas");

    const lineFor = (accountId: string) => entry.lines.find((l) => l.accountId === accountId);
    expect(lineFor(kas.id)?.debit.toString()).toBe("90000");
    expect(lineFor(piutangKolektor.id)?.debit.toString()).toBe("10000");
    expect(lineFor(kasDiKolektor.id)?.credit.toString()).toBe("100000");
  });

  it("books a surplus to Selisih Kas instead", async () => {
    const admin = await setupTenant();
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);

    await db.$transaction((tx) =>
      postCollectionBatchVerification(tx, {
        tenantId: admin.user.tenantId,
        batchId: "batch-2",
        entryDate: new Date(),
        received: "105000",
        expected: "100000",
        description: "Verifikasi setoran"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "COLLECTION_BATCH", sourceId: "batch-2" },
      include: { lines: true }
    });
    const selisihKas = await accountByName(admin.user.tenantId, "Selisih Kas");
    const piutangKolektor = await accountByName(admin.user.tenantId, "Piutang Kolektor");

    expect(entry.lines.find((l) => l.accountId === selisihKas.id)?.credit.toString()).toBe("5000");
    expect(entry.lines.some((l) => l.accountId === piutangKolektor.id)).toBe(false);
  });

  it("books neither Piutang Kolektor nor Selisih Kas when received exactly matches expected", async () => {
    const admin = await setupTenant();
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);

    await db.$transaction((tx) =>
      postCollectionBatchVerification(tx, {
        tenantId: admin.user.tenantId,
        batchId: "batch-3",
        entryDate: new Date(),
        received: "100000",
        expected: "100000",
        description: "Verifikasi setoran"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "COLLECTION_BATCH", sourceId: "batch-3" },
      include: { lines: true }
    });
    expect(entry.lines).toHaveLength(2);
  });
});
