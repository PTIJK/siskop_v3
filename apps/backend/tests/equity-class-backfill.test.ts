import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/lib/db.js";
import { setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260925100100_account_equity_class_backfill/migration.sql"
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

type Category = "ASET" | "EKUITAS";

async function account(tenantId: string, code: string, name: string, category: Category = "EKUITAS") {
  return db.account.create({
    data: { tenantId, code, name, category, normalBalance: category === "ASET" ? "DEBIT" : "KREDIT" }
  });
}

/** Posts Kas (debit) against `creditAccountId` for `amount`. */
async function postCredit(tenantId: string, kasId: string, creditAccountId: string, amount: number) {
  await db.journalEntry.create({
    data: {
      tenantId,
      entryDate: new Date("2026-01-15T00:00:00Z"),
      sourceType: "MANUAL",
      description: "Setoran",
      lines: {
        create: [
          { tenantId, accountId: kasId, debit: amount, credit: 0 },
          { tenantId, accountId: creditAccountId, debit: 0, credit: amount }
        ]
      }
    }
  });
}

async function reclassNotifications(tenantId: string) {
  return db.tenantNotification.findMany({ where: { tenantId, type: "EQUITY_RECLASS_REVIEW" } });
}

describe("the migration's equity-class backfill", () => {
  it("classifies the standard equity accounts by code and renames the old combined cadangan account", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await account(tenantId, "3-1000", "Simpanan Pokok");
    await account(tenantId, "3-1100", "Simpanan Wajib");
    await account(tenantId, "3-2000", "Cadangan / Modal Penyertaan");
    await account(tenantId, "3-3000", "SHU Tahun Berjalan");
    await account(tenantId, "3-3100", "SHU Tahun Lalu Belum Dibagi");

    await runBackfill();

    const byCode = new Map(
      (await db.account.findMany({ where: { tenantId } })).map((a) => [a.code, { name: a.name, equityClass: a.equityClass }])
    );
    expect(byCode.get("3-1000")?.equityClass).toBe("SIMPANAN_POKOK");
    expect(byCode.get("3-1100")?.equityClass).toBe("SIMPANAN_WAJIB");
    expect(byCode.get("3-2000")).toEqual({ name: "Cadangan Umum", equityClass: "CADANGAN_UMUM" });
    expect(byCode.get("3-3000")?.equityClass).toBe("SHU");
    expect(byCode.get("3-3100")?.equityClass).toBe("SHU");
  });

  it("leaves template-coded accounts whose name differs from the template unclassified", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    // prisma/seed-ksu-demo.ts's layout: same codes, different meaning.
    await account(tenantId, "3-1000", "Modal Kerja");
    await account(tenantId, "3-2000", "Simpanan Pokok");

    await runBackfill();

    const accounts = await db.account.findMany({ where: { tenantId } });
    expect(accounts.map((a) => a.equityClass)).toEqual([null, null]);
    expect(accounts.find((a) => a.code === "3-2000")?.name).toBe("Simpanan Pokok");
  });

  it("keeps a tenant's own name and equity class, and ignores non-EKUITAS accounts sharing a template code", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const cadangan = await account(tenantId, "3-2000", "Dana Cadangan Koperasi");
    await db.account.update({ where: { id: cadangan.id, tenantId }, data: { equityClass: "CADANGAN_RISIKO" } });
    await account(tenantId, "3-1000", "Kas Kecil", "ASET");

    await runBackfill();

    const accounts = await db.account.findMany({ where: { tenantId } });
    expect(accounts.find((a) => a.code === "3-2000")).toMatchObject({
      name: "Dana Cadangan Koperasi",
      equityClass: "CADANGAN_RISIKO"
    });
    expect(accounts.find((a) => a.code === "3-1000")?.equityClass).toBeNull();
  });

  it("asks for a reclass review only where the old combined account holds a balance, once", async () => {
    const withBalance = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const empty = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const kasA = await account(withBalance.user.tenantId, "1-1000", "Kas", "ASET");
    const cadanganA = await account(withBalance.user.tenantId, "3-2000", "Cadangan / Modal Penyertaan");
    await postCredit(withBalance.user.tenantId, kasA.id, cadanganA.id, 2_500_000);
    await account(empty.user.tenantId, "3-2000", "Cadangan / Modal Penyertaan");

    await runBackfill();
    await runBackfill();

    const notifications = await reclassNotifications(withBalance.user.tenantId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ permissionModule: "accounting", permissionAction: "update", relatedId: cadanganA.id });
    expect(await reclassNotifications(empty.user.tenantId)).toHaveLength(0);
  });
});
