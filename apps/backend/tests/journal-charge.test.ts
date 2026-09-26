import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";
import { postChargeAccrual, postChargePayment } from "../src/lib/journal.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createMarketAndGenerateCoa(accessToken: string) {
  await request(app())
    .post("/api/market/markets")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Pasar Induk" });
  await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${accessToken}`);
}

async function accountByName(tenantId: string, name: string) {
  return db.account.findFirstOrThrow({ where: { tenantId, name } });
}

async function unitIdOf(tenantId: string) {
  const market = await db.market.findFirstOrThrow({ where: { tenantId } });
  return market.unitId;
}

describe("postChargeAccrual", () => {
  it("books SEWA to Pendapatan Sewa Kios", async () => {
    const admin = await setupTenant();
    await createMarketAndGenerateCoa(admin.accessToken);
    const unitId = await unitIdOf(admin.user.tenantId);

    await db.$transaction((tx) =>
      postChargeAccrual(tx, {
        tenantId: admin.user.tenantId,
        unitId,
        chargeId: "charge-1",
        kind: "SEWA",
        amount: "100000",
        entryDate: new Date(),
        description: "Tagihan sewa kios"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_ACCRUAL", sourceId: "charge-1" },
      include: { lines: true }
    });
    expect(entry.unitId).toBe(unitId);
    expect(entry.status).toBe("POSTED");

    const piutang = await accountByName(admin.user.tenantId, "Piutang Sewa & Retribusi");
    const pendapatanSewa = await accountByName(admin.user.tenantId, "Pendapatan Sewa Kios");
    expect(entry.lines.find((l) => l.accountId === piutang.id)?.debit.toString()).toBe("100000");
    expect(entry.lines.find((l) => l.accountId === pendapatanSewa.id)?.credit.toString()).toBe("100000");
  });

  it("books RETRIBUSI to Pendapatan Retribusi instead", async () => {
    const admin = await setupTenant();
    await createMarketAndGenerateCoa(admin.accessToken);
    const unitId = await unitIdOf(admin.user.tenantId);

    await db.$transaction((tx) =>
      postChargeAccrual(tx, {
        tenantId: admin.user.tenantId,
        unitId,
        chargeId: "charge-2",
        kind: "RETRIBUSI",
        amount: "5000",
        entryDate: new Date(),
        description: "Tagihan retribusi kebersihan"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_ACCRUAL", sourceId: "charge-2" },
      include: { lines: true }
    });
    const pendapatanRetribusi = await accountByName(admin.user.tenantId, "Pendapatan Retribusi");
    expect(entry.lines.find((l) => l.accountId === pendapatanRetribusi.id)?.credit.toString()).toBe("5000");
  });
});

describe("postChargePayment", () => {
  it("books a loket payment to Kas, discharging Piutang", async () => {
    const admin = await setupTenant();
    await createMarketAndGenerateCoa(admin.accessToken);
    const unitId = await unitIdOf(admin.user.tenantId);

    await db.$transaction((tx) =>
      postChargePayment(tx, {
        tenantId: admin.user.tenantId,
        unitId,
        chargePaymentId: "payment-1",
        amount: "5000",
        entryDate: new Date(),
        description: "Pembayaran retribusi"
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_PAYMENT", sourceId: "payment-1" },
      include: { lines: true }
    });
    const kas = await accountByName(admin.user.tenantId, "Kas");
    const piutang = await accountByName(admin.user.tenantId, "Piutang Sewa & Retribusi");
    expect(entry.lines.find((l) => l.accountId === kas.id)?.debit.toString()).toBe("5000");
    expect(entry.lines.find((l) => l.accountId === piutang.id)?.credit.toString()).toBe("5000");
  });

  it("redirects a collector payment's Kas side to Kas di Kolektor", async () => {
    const admin = await setupTenant();
    await createMarketAndGenerateCoa(admin.accessToken);
    const unitId = await unitIdOf(admin.user.tenantId);

    await db.$transaction((tx) =>
      postChargePayment(tx, {
        tenantId: admin.user.tenantId,
        unitId,
        chargePaymentId: "payment-2",
        amount: "5000",
        entryDate: new Date(),
        description: "Pembayaran retribusi via kolektor",
        viaCollector: true
      })
    );

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_PAYMENT", sourceId: "payment-2" },
      include: { lines: true }
    });
    const kasDiKolektor = await accountByName(admin.user.tenantId, "Kas di Kolektor");
    const kas = await accountByName(admin.user.tenantId, "Kas");
    expect(entry.lines.find((l) => l.accountId === kasDiKolektor.id)?.debit.toString()).toBe("5000");
    expect(entry.lines.some((l) => l.accountId === kas.id)).toBe(false);
  });
});
