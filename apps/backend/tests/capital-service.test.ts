import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getModalSendiri } from "../src/modules/reports/capital-service.js";
import { postEquity, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const AS_OF = new Date("2026-06-30T23:59:59Z");

async function tenant(slug = "demo") {
  const admin = await setupTenant(slug === "demo" ? {} : { slug, registrationNo: `KOP-${slug.toUpperCase()}` });
  return admin.user.tenantId;
}

async function addAdjustment(
  tenantId: string,
  amount: string,
  effectiveDate: string,
  opts: { unitId?: string | null; createdAt?: Date } = {}
) {
  await db.modalSendiriAdjustment.create({
    data: {
      tenantId,
      unitId: opts.unitId ?? null,
      effectiveDate: new Date(`${effectiveDate}T00:00:00Z`),
      amount,
      reason: "Saldo awal sebelum SISKOP",
      createdBy: "test",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {})
    }
  });
}

describe("getModalSendiri (Permenkop UKM 8/2023 Pasal 1 angka 23)", () => {
  it("is zero for a tenant with no ledger and no adjustment", async () => {
    const tenantId = await tenant();

    const result = await getModalSendiri(tenantId, AS_OF);

    expect(result.total.toString()).toBe("0");
    expect(result.gl.toString()).toBe("0");
    expect(result.adjustment.toString()).toBe("0");
  });

  it("sums pokok, wajib, modal tetap, cadangan and hibah — to the sen", async () => {
    const tenantId = await tenant();
    await postEquity(tenantId, "SIMPANAN_POKOK", "1000000.10");
    await postEquity(tenantId, "SIMPANAN_WAJIB", "2000000.20");
    await postEquity(tenantId, "MODAL_TETAP", "300000");
    await postEquity(tenantId, "CADANGAN_UMUM", "400000");
    await postEquity(tenantId, "CADANGAN_RISIKO", "50000");
    await postEquity(tenantId, "HIBAH", "6000.01");

    const result = await getModalSendiri(tenantId, AS_OF);

    expect(result.total.toFixed(2)).toBe("3756000.31");
    expect(result.byClass.SIMPANAN_WAJIB.toFixed(2)).toBe("2000000.20");
    expect(result.byClass.HIBAH.toFixed(2)).toBe("6000.01");
  });

  it("excludes modal penyertaan, SHU and other equity", async () => {
    const tenantId = await tenant();
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000);
    await postEquity(tenantId, "MODAL_PENYERTAAN", 50_000_000);
    await postEquity(tenantId, "SHU", 7_000_000);
    await postEquity(tenantId, "EKUITAS_LAIN", 3_000_000);

    const result = await getModalSendiri(tenantId, AS_OF);

    expect(result.total.toFixed(2)).toBe("1000000.00");
  });

  it("nets withdrawals (debits) against deposits", async () => {
    const tenantId = await tenant();
    await postEquity(tenantId, "SIMPANAN_WAJIB", 5_000_000);
    await postEquity(tenantId, "SIMPANAN_WAJIB", -1_250_000);

    const result = await getModalSendiri(tenantId, AS_OF);

    expect(result.total.toFixed(2)).toBe("3750000.00");
  });

  it("ignores entries dated after asOf", async () => {
    const tenantId = await tenant();
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: new Date("2026-06-30T10:00:00Z") });
    await postEquity(tenantId, "SIMPANAN_POKOK", 9_000_000, { entryDate: new Date("2026-07-01T00:00:00Z") });

    const result = await getModalSendiri(tenantId, AS_OF);

    expect(result.total.toFixed(2)).toBe("1000000.00");
  });

  it("never counts another tenant's ledger", async () => {
    const tenantA = await tenant("tenant-a");
    const tenantB = await tenant("tenant-b");
    await postEquity(tenantB, "SIMPANAN_POKOK", 9_000_000);

    const result = await getModalSendiri(tenantA, AS_OF);

    expect(result.total.toString()).toBe("0");
  });

  it("filters by unit, and units plus the unallocated bucket add back up to the consolidated figure", async () => {
    const tenantId = await tenant();
    const ksp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    const toko = await db.cooperativeUnit.create({ data: { tenantId, type: "KONSUMEN", name: "Toko" } });
    await postEquity(tenantId, "MODAL_TETAP", 4_000_000, { unitId: ksp.id });
    await postEquity(tenantId, "MODAL_TETAP", 1_000_000, { unitId: toko.id });
    await postEquity(tenantId, "SIMPANAN_POKOK", 500_000, { unitId: null });

    const [consolidated, kspOnly, tokoOnly] = await Promise.all([
      getModalSendiri(tenantId, AS_OF),
      getModalSendiri(tenantId, AS_OF, ksp.id),
      getModalSendiri(tenantId, AS_OF, toko.id)
    ]);

    expect(kspOnly.total.toFixed(2)).toBe("4000000.00");
    expect(tokoOnly.total.toFixed(2)).toBe("1000000.00");
    expect(consolidated.total.toFixed(2)).toBe("5500000.00");
  });

  describe("opening-balance adjustment", () => {
    it("adds the latest adjustment effective on or before asOf to the ledger figure", async () => {
      const tenantId = await tenant();
      await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000);
      await addAdjustment(tenantId, "2000000", "2026-01-01");
      await addAdjustment(tenantId, "3000000", "2026-03-01");
      await addAdjustment(tenantId, "9000000", "2026-07-01"); // after asOf

      const result = await getModalSendiri(tenantId, AS_OF);

      expect(result.gl.toFixed(2)).toBe("1000000.00");
      expect(result.adjustment.toFixed(2)).toBe("3000000.00");
      expect(result.total.toFixed(2)).toBe("4000000.00");
    });

    it("breaks a same-day tie with the most recently recorded adjustment", async () => {
      const tenantId = await tenant();
      await addAdjustment(tenantId, "1000000", "2026-01-01", { createdAt: new Date("2026-01-02T00:00:00Z") });
      await addAdjustment(tenantId, "1500000", "2026-01-01", { createdAt: new Date("2026-01-03T00:00:00Z") });

      const result = await getModalSendiri(tenantId, AS_OF);

      expect(result.adjustment.toFixed(2)).toBe("1500000.00");
    });

    it("scopes adjustments per unit, and the consolidated figure takes the latest of each scope", async () => {
      const tenantId = await tenant();
      const ksp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
      await addAdjustment(tenantId, "700000", "2026-01-01", { unitId: null });
      await addAdjustment(tenantId, "100000", "2026-01-01", { unitId: ksp.id });
      await addAdjustment(tenantId, "250000", "2026-02-01", { unitId: ksp.id });

      const [consolidated, kspOnly] = await Promise.all([
        getModalSendiri(tenantId, AS_OF),
        getModalSendiri(tenantId, AS_OF, ksp.id)
      ]);

      expect(kspOnly.adjustment.toFixed(2)).toBe("250000.00");
      expect(consolidated.adjustment.toFixed(2)).toBe("950000.00");
    });
  });
});
