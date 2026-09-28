import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
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
  "../prisma/migrations/20260926063500_backfill_market_role_permissions/migration.sql"
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

/** Simulates a tenant provisioned before F3 existed — its seed roles never got a "market" key at all. */
async function stripMarketKey(tenantId: string, roleId: string) {
  const role = await db.role.findFirstOrThrow({ where: { id: roleId, tenantId } });
  const perms = role.permissions as Record<string, unknown>;
  delete perms.market;
  await db.role.update({ where: { id: roleId, tenantId }, data: { permissions: perms as unknown as Prisma.InputJsonValue } });
}

async function roleByName(tenantId: string, name: string) {
  return db.role.findFirstOrThrow({ where: { tenantId, name } });
}

describe("the migration that backfills market permissions onto pre-existing tenants", () => {
  it("grants Super Admin and Manager full market CRUD when the key is missing", async () => {
    const admin = await setupTenant();
    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    const manager = await roleByName(admin.user.tenantId, "Manager");
    await stripMarketKey(admin.user.tenantId, superAdmin.id);
    await stripMarketKey(admin.user.tenantId, manager.id);

    await runBackfill();

    const updatedSuperAdmin = await db.role.findUniqueOrThrow({ where: { id: superAdmin.id } });
    const updatedManager = await db.role.findUniqueOrThrow({ where: { id: manager.id } });
    expect((updatedSuperAdmin.permissions as Record<string, unknown>).market).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
    expect((updatedManager.permissions as Record<string, unknown>).market).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
  });

  it("grants Teller and Viewer market.read only", async () => {
    const admin = await setupTenant();
    const teller = await roleByName(admin.user.tenantId, "Teller");
    const viewer = await roleByName(admin.user.tenantId, "Viewer");
    await stripMarketKey(admin.user.tenantId, teller.id);
    await stripMarketKey(admin.user.tenantId, viewer.id);

    await runBackfill();

    const updatedTeller = await db.role.findUniqueOrThrow({ where: { id: teller.id } });
    const updatedViewer = await db.role.findUniqueOrThrow({ where: { id: viewer.id } });
    expect((updatedTeller.permissions as Record<string, unknown>).market).toEqual({ read: true });
    expect((updatedViewer.permissions as Record<string, unknown>).market).toEqual({ read: true });
  });

  it("does not touch Kasir or a custom role", async () => {
    const admin = await setupTenant();
    const kasir = await roleByName(admin.user.tenantId, "Kasir");
    const custom = await db.role.create({
      data: { tenantId: admin.user.tenantId, name: "Frontliner", permissions: { dashboard: {} } as unknown as Prisma.InputJsonValue }
    });

    await runBackfill();

    const updatedKasir = await db.role.findUniqueOrThrow({ where: { id: kasir.id } });
    const updatedCustom = await db.role.findUniqueOrThrow({ where: { id: custom.id } });
    expect((updatedKasir.permissions as Record<string, unknown>).market).toBeUndefined();
    expect((updatedCustom.permissions as Record<string, unknown>).market).toBeUndefined();
  });

  it("leaves an already-explicit market value alone", async () => {
    const admin = await setupTenant();
    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    const customized = { ...(superAdmin.permissions as Record<string, unknown>), market: { read: true } };
    await db.role.update({
      where: { id: superAdmin.id, tenantId: admin.user.tenantId },
      data: { permissions: customized as unknown as Prisma.InputJsonValue }
    });

    await runBackfill();

    const updated = await db.role.findUniqueOrThrow({ where: { id: superAdmin.id } });
    expect((updated.permissions as Record<string, unknown>).market).toEqual({ read: true });
  });

  it("is idempotent", async () => {
    const admin = await setupTenant();
    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    await stripMarketKey(admin.user.tenantId, superAdmin.id);

    await runBackfill();
    await runBackfill();

    const updated = await db.role.findUniqueOrThrow({ where: { id: superAdmin.id } });
    expect((updated.permissions as Record<string, unknown>).market).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
  });
});
