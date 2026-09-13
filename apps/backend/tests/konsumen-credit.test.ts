import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createMemberWithPokokSaving, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";
import {
  getMemberCreditStatus,
  listOutstandingMemberCredit,
  recordCreditRepayment,
  searchMembersForCredit
} from "../src/modules/konsumen/credit.service.js";

/**
 * Phase — Konsumen/Toko "Kredit Anggota" (member store credit): service-level.
 * HTTP wiring lives in tests/konsumen-credit-routes.test.ts (same split as
 * konsumen-sale.test.ts vs konsumen-sale-routes.test.ts). Sale-side
 * eligibility enforcement (thrown from createSale) is covered in
 * tests/konsumen-sale.test.ts, not duplicated here — this file is about
 * getMemberCreditStatus/searchMembersForCredit/recordCreditRepayment
 * themselves.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string };
}

async function createAccount(accessToken: string, data: { code: string; name: string; category: string; normalBalance: string }) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
  return res.body.data as { id: string };
}

async function createAccountMapping(
  accessToken: string,
  data: { sourceType: string; transactionKind: string; debitAccountId: string; creditAccountId: string }
) {
  await request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
}

/** SYSTEM/MEMBER_CREDIT_REPAYMENT mapping — Kas debit / Piutang credit, the reverse of a MEMBER_CREDIT sale. */
async function setupRepaymentMapping(accessToken: string) {
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const piutang = await createAccount(accessToken, {
    code: "1-1400",
    name: "Piutang Anggota (Toko)",
    category: "ASET",
    normalBalance: "DEBIT"
  });
  await createAccountMapping(accessToken, {
    sourceType: "SYSTEM",
    transactionKind: "MEMBER_CREDIT_REPAYMENT",
    debitAccountId: kas.id,
    creditAccountId: piutang.id
  });
  return { kas, piutang };
}

async function seedTokoWithStock(tenant: Awaited<ReturnType<typeof setupTenant>>, stockQty = 10) {
  const tokoUnit = await createUnit(tenant.accessToken, "KONSUMEN", "Toko Koperasi");
  const product = await createProduct(tenant.user.tenantId, {
    unitId: tokoUnit.id,
    sku: "SKU-BERAS-5KG",
    name: "Beras Premium 5kg",
    sellPrice: 50_000,
    costPrice: 30_000
  });
  if (stockQty > 0) {
    await recordStockMovement(tenant.user.tenantId, product.id, { type: "IN", quantity: stockQty, reason: "Restok awal" }, tenant.user.id);
  }
  return { tokoUnit, product };
}

describe("getMemberCreditStatus", () => {
  it("computes creditLimit as 50% of total active savings balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken); // deposits 500_000

    const status = await getMemberCreditStatus(admin.user.tenantId, member.id);

    expect(status.savingsBalance.toString()).toBe("500000");
    expect(status.creditLimit.toString()).toBe("250000");
    expect(status.outstandingBalance.toString()).toBe("0");
    expect(status.availableCredit.toString()).toBe("250000");
    expect(status.hasActiveSaving).toBe(true);
    expect(status.eligible).toBe(true);
  });

  it("sums balance across multiple active saving types", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken); // 500_000 POKOK
    const wajibConfig = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Wajib", type: "WAJIB", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: wajibConfig.body.data.id, initialDeposit: 100_000 });

    const status = await getMemberCreditStatus(admin.user.tenantId, member.id);

    expect(status.savingsBalance.toString()).toBe("600000");
    expect(status.creditLimit.toString()).toBe("300000");
  });

  it("is not eligible for a member with no active savings", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);

    const status = await getMemberCreditStatus(admin.user.tenantId, member.id);

    expect(status.hasActiveSaving).toBe(false);
    expect(status.creditLimit.toString()).toBe("0");
    expect(status.eligible).toBe(false);
  });

  it("reduces availableCredit by outstanding MEMBER_CREDIT sales and restores it on repayment", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken); // limit 250_000
    const { tokoUnit, product } = await seedTokoWithStock(admin);

    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "MEMBER_CREDIT", memberId: member.id },
      admin.user.id
    );

    const afterSale = await getMemberCreditStatus(admin.user.tenantId, member.id);
    expect(afterSale.outstandingBalance.toString()).toBe("100000"); // 50_000 * 2
    expect(afterSale.availableCredit.toString()).toBe("150000");

    await recordCreditRepayment(admin.user.tenantId, { memberId: member.id, amount: 40_000 }, admin.user.id);

    const afterRepayment = await getMemberCreditStatus(admin.user.tenantId, member.id);
    expect(afterRepayment.outstandingBalance.toString()).toBe("60000");
    expect(afterRepayment.availableCredit.toString()).toBe("190000");
  });

  it("throws NOT_FOUND for a memberId outside the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberAs(tenantB.accessToken);

    await expect(getMemberCreditStatus(tenantA.user.tenantId, memberB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("searchMembersForCredit", () => {
  it("finds a member by partial name, tenant-scoped", async () => {
    const admin = await setupTenant();
    await createMemberAs(admin.accessToken, { fullName: "Siti Aminah" });

    const results = await searchMembersForCredit(admin.user.tenantId, "siti");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ fullName: "Siti Aminah" });
  });

  it("does not leak another tenant's members", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await createMemberAs(tenantB.accessToken, { fullName: "Siti Aminah" });

    const results = await searchMembersForCredit(tenantA.user.tenantId, "siti");

    expect(results).toEqual([]);
  });
});

describe("recordCreditRepayment", () => {
  it("rejects a repayment amount exceeding the outstanding balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    await expect(
      recordCreditRepayment(admin.user.tenantId, { memberId: member.id, amount: 1 }, admin.user.id)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("posts a balanced 2-line journal entry (Kas debit / Piutang credit)", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const { kas, piutang } = await setupRepaymentMapping(admin.accessToken);
    const { tokoUnit, product } = await seedTokoWithStock(admin);
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "MEMBER_CREDIT", memberId: member.id },
      admin.user.id
    );

    const repayment = await recordCreditRepayment(admin.user.tenantId, { memberId: member.id, amount: 40_000 }, admin.user.id);
    expect(repayment.outstandingBalance).toBe("60000");

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "MEMBER_CREDIT_REPAYMENT", sourceId: repayment.id }
    });
    expect(entry.status).toBe("POSTED");

    const lines = await db.journalLine.findMany({ where: { tenantId: admin.user.tenantId, journalEntryId: entry.id } });
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.accountId === kas.id);
    const credit = lines.find((l) => l.accountId === piutang.id);
    expect(Number(debit!.debit)).toBe(40_000);
    expect(Number(credit!.credit)).toBe(40_000);
  });

  it("throws NOT_FOUND for a memberId outside the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberAs(tenantB.accessToken);

    await expect(
      recordCreditRepayment(tenantA.user.tenantId, { memberId: memberB.id, amount: 1 }, tenantA.user.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * Tenant-wide "Piutang Anggota" list — powers the dedicated monitoring/
 * repayment screen (not the single-member status above). Outstanding
 * balance is derived the same way as getMemberCreditStatus, just batched
 * across every member with a MEMBER_CREDIT sale or repayment.
 */
describe("listOutstandingMemberCredit", () => {
  it("lists only members with outstanding balance greater than 0, sorted by outstanding balance descending", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Andi Wijaya", nik: "1111111111111111" });
    const memberB = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Budi Santoso", nik: "2222222222222222" });
    const { tokoUnit, product } = await seedTokoWithStock(admin, 20);

    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberA.id },
      admin.user.id
    ); // 50_000
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "MEMBER_CREDIT", memberId: memberB.id },
      admin.user.id
    ); // 150_000

    const result = await listOutstandingMemberCredit(admin.user.tenantId, { page: 1, limit: 20 });

    expect(result.items.map((i) => i.memberId)).toEqual([memberB.id, memberA.id]);
    expect(result.items[0].outstandingBalance.toString()).toBe("150000");
    expect(result.items[1].outstandingBalance.toString()).toBe("50000");
    expect(result.meta.total).toBe(2);
  });

  it("excludes a member whose credit has been fully repaid", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Andi Wijaya", nik: "1111111111111111" });
    const memberB = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Budi Santoso", nik: "2222222222222222" });
    const { tokoUnit, product } = await seedTokoWithStock(admin, 20);

    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberA.id },
      admin.user.id
    ); // 50_000
    await recordCreditRepayment(admin.user.tenantId, { memberId: memberA.id, amount: 50_000 }, admin.user.id);
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberB.id },
      admin.user.id
    ); // 50_000

    const result = await listOutstandingMemberCredit(admin.user.tenantId, { page: 1, limit: 20 });

    expect(result.items.map((i) => i.memberId)).toEqual([memberB.id]);
  });

  it("computes totalOutstanding as the tenant-wide sum, independent of pagination", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Andi Wijaya", nik: "1111111111111111" });
    const memberB = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Budi Santoso", nik: "2222222222222222" });
    const { tokoUnit, product } = await seedTokoWithStock(admin, 20);
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberA.id },
      admin.user.id
    ); // 50_000
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "MEMBER_CREDIT", memberId: memberB.id },
      admin.user.id
    ); // 150_000

    const result = await listOutstandingMemberCredit(admin.user.tenantId, { page: 1, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(2);
    expect(result.meta.totalOutstanding.toString()).toBe("200000");
  });

  it("filters by search matching the member's full name", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Andi Wijaya", nik: "1111111111111111" });
    const memberB = await createMemberWithPokokSaving(admin.accessToken, { fullName: "Budi Santoso", nik: "2222222222222222" });
    const { tokoUnit, product } = await seedTokoWithStock(admin, 20);
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberA.id },
      admin.user.id
    );
    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberB.id },
      admin.user.id
    );

    const result = await listOutstandingMemberCredit(admin.user.tenantId, { page: 1, limit: 20, search: "andi" });

    expect(result.items.map((i) => i.memberId)).toEqual([memberA.id]);
  });

  it("does not leak another tenant's outstanding credit", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);
    const { tokoUnit, product } = await seedTokoWithStock(tenantB);
    await createSale(
      tenantB.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId: memberB.id },
      tenantB.user.id
    );

    const result = await listOutstandingMemberCredit(tenantA.user.tenantId, { page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.meta.totalOutstanding.toString()).toBe("0");
  });
});
