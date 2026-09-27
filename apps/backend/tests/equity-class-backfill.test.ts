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
    // Provisioning already created these with their equityClass set — reset
    // each to its pre-backfill (unclassified) state so the migration has
    // something to do. 3-2000 also carries the old combined name; the
    // migration's job is to rename it to "Cadangan Umum".
    await db.account.updateMany({ where: { tenantId, code: "3-1000" }, data: { equityClass: null } });
    await db.account.updateMany({ where: { tenantId, code: "3-1100" }, data: { equityClass: null } });
    await db.account.updateMany({
      where: { tenantId, code: "3-2000" },
      data: { name: "Cadangan / Modal Penyertaan", equityClass: null }
    });
    await db.account.updateMany({ where: { tenantId, code: "3-3000" }, data: { equityClass: null } });
    await db.account.updateMany({ where: { tenantId, code: "3-3100" }, data: { equityClass: null } });

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
    // prisma/seed-ksu-demo.ts's layout: same codes, different meaning. Reset
    // the already-provisioned rows to simulate a tenant whose accounts hold
    // something other than what the template code implies.
    await db.account.updateMany({ where: { tenantId, code: "3-1000" }, data: { name: "Modal Kerja", equityClass: null } });
    await db.account.updateMany({ where: { tenantId, code: "3-2000" }, data: { name: "Simpanan Pokok", equityClass: null } });

    await runBackfill();

    const account3_1000 = await db.account.findFirstOrThrow({ where: { tenantId, code: "3-1000" } });
    const account3_2000 = await db.account.findFirstOrThrow({ where: { tenantId, code: "3-2000" } });
    expect(account3_1000.equityClass).toBeNull();
    expect(account3_2000.equityClass).toBeNull();
    expect(account3_2000.name).toBe("Simpanan Pokok");
  });

  it("keeps a tenant's own name and equity class, and ignores non-EKUITAS accounts sharing a template code", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await db.account.updateMany({
      where: { tenantId, code: "3-2000" },
      data: { name: "Dana Cadangan Koperasi", equityClass: "CADANGAN_RISIKO" }
    });
    // Simulate 3-1000 (provisioned as "Simpanan Pokok") actually holding
    // something non-EKUITAS at this tenant — the backfill must ignore it.
    await db.account.updateMany({
      where: { tenantId, code: "3-1000" },
      data: { name: "Kas Kecil", category: "ASET", normalBalance: "DEBIT", equityClass: null }
    });

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
    // 1-1000 (Kas) and 3-2000 (Cadangan) already exist from provisioning —
    // reuse Kas as-is and reset 3-2000 to its pre-backfill combined name.
    const kasA = await db.account.findFirstOrThrow({ where: { tenantId: withBalance.user.tenantId, code: "1-1000" } });
    await db.account.updateMany({
      where: { tenantId: withBalance.user.tenantId, code: "3-2000" },
      data: { name: "Cadangan / Modal Penyertaan", equityClass: null }
    });
    const cadanganA = await db.account.findFirstOrThrow({ where: { tenantId: withBalance.user.tenantId, code: "3-2000" } });
    await postCredit(withBalance.user.tenantId, kasA.id, cadanganA.id, 2_500_000);
    await db.account.updateMany({
      where: { tenantId: empty.user.tenantId, code: "3-2000" },
      data: { name: "Cadangan / Modal Penyertaan", equityClass: null }
    });

    await runBackfill();
    await runBackfill();

    const notifications = await reclassNotifications(withBalance.user.tenantId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ permissionModule: "accounting", permissionAction: "update", relatedId: cadanganA.id });
    expect(await reclassNotifications(empty.user.tenantId)).toHaveLength(0);
  });
});
