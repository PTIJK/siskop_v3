import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
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

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260925110000_modal_sendiri_adjustment/migration.sql"
);

function backfillStatements(): string[] {
  const block = readFileSync(migration, "utf8").split("-- backfill:start")[1]?.split("-- backfill:end")[0] ?? "";
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runBackfill() {
  for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);
}

async function setModalDisetor(tenantId: string, value: string) {
  await db.tenant.update({ where: { id: tenantId }, data: { modalDisetor: new Prisma.Decimal(value) } });
}

const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");

describe("the migration of the manual modal disetor into an opening-balance adjustment", () => {
  it("keeps the declared figure: adjustment = modal disetor − Modal Sendiri already in the ledger", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await setModalDisetor(tenantId, "10000000.50");
    await postEquity(tenantId, "SIMPANAN_POKOK", "3000000");
    await postEquity(tenantId, "MODAL_PENYERTAAN", "99000000"); // not Modal Sendiri

    await runBackfill();

    const rows = await db.modalSendiriAdjustment.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount.toFixed(2)).toBe("7000000.50");
    expect(rows[0]!.unitId).toBeNull();
    expect((await getModalSendiri(tenantId, FAR_FUTURE)).total.toFixed(2)).toBe("10000000.50");
  });

  it("dates the adjustment from the tenant's creation, so past year ends see it too", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await setModalDisetor(tenantId, "5000000");

    await runBackfill();

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const row = await db.modalSendiriAdjustment.findFirstOrThrow({ where: { tenantId } });
    expect(row.effectiveDate.toISOString().slice(0, 10)).toBe(tenant.createdAt.toISOString().slice(0, 10));
  });

  it("adds nothing when the ledger already covers the declared figure, or none was declared", async () => {
    const covered = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    await setModalDisetor(covered.user.tenantId, "1000000");
    await postEquity(covered.user.tenantId, "SIMPANAN_WAJIB", "2000000");
    const undeclared = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    await runBackfill();

    expect(await db.modalSendiriAdjustment.count({ where: { tenantId: covered.user.tenantId } })).toBe(0);
    expect(await db.modalSendiriAdjustment.count({ where: { tenantId: undeclared.user.tenantId } })).toBe(0);
  });

  it("is idempotent", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.user.tenantId, "5000000");

    await runBackfill();
    await runBackfill();

    expect(await db.modalSendiriAdjustment.count({ where: { tenantId: admin.user.tenantId } })).toBe(1);
  });
});
