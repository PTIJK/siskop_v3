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
  "../prisma/migrations/20260926100500_backfill_collections_role_permissions/migration.sql"
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

/** Simulates a tenant provisioned before F4 existed: no "collections" key, and no Kolektor role at all. */
async function stripCollectionsAndKolektor(tenantId: string) {
  const roles = await db.role.findMany({ where: { tenantId } });
  for (const role of roles) {
    if (role.name === "Kolektor") {
      await db.role.delete({ where: { id: role.id, tenantId } });
      continue;
    }
    const perms = role.permissions as Record<string, unknown>;
    delete perms.collections;
    await db.role.update({ where: { id: role.id, tenantId }, data: { permissions: perms as unknown as Prisma.InputJsonValue } });
  }
}

async function roleByName(tenantId: string, name: string) {
  return db.role.findFirst({ where: { tenantId, name } });
}

describe("the migration that backfills collections permissions and the Kolektor role onto pre-existing tenants", () => {
  it("grants Super Admin and Manager full collections CRUD when the key is missing", async () => {
    const admin = await setupTenant();
    await stripCollectionsAndKolektor(admin.user.tenantId);

    await runBackfill();

    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    const manager = await roleByName(admin.user.tenantId, "Manager");
    expect((superAdmin?.permissions as Record<string, unknown>).collections).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
    expect((manager?.permissions as Record<string, unknown>).collections).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
  });

  it("grants Teller read+update and Viewer read only", async () => {
    const admin = await setupTenant();
    await stripCollectionsAndKolektor(admin.user.tenantId);

    await runBackfill();

    const teller = await roleByName(admin.user.tenantId, "Teller");
    const viewer = await roleByName(admin.user.tenantId, "Viewer");
    expect((teller?.permissions as Record<string, unknown>).collections).toEqual({ read: true, update: true });
    expect((viewer?.permissions as Record<string, unknown>).collections).toEqual({ read: true });
  });

  it("does not touch Kasir", async () => {
    const admin = await setupTenant();
    await stripCollectionsAndKolektor(admin.user.tenantId);

    await runBackfill();

    const kasir = await roleByName(admin.user.tenantId, "Kasir");
    expect((kasir?.permissions as Record<string, unknown>).collections).toBeUndefined();
  });

  it("inserts a Kolektor role scoped to the tenant with create+read collections only", async () => {
    const admin = await setupTenant();
    await stripCollectionsAndKolektor(admin.user.tenantId);
    expect(await roleByName(admin.user.tenantId, "Kolektor")).toBeNull();

    await runBackfill();

    const kolektor = await roleByName(admin.user.tenantId, "Kolektor");
    expect(kolektor?.tenantId).toBe(admin.user.tenantId);
    expect((kolektor?.permissions as Record<string, unknown>).collections).toEqual({ create: true, read: true });
    expect((kolektor?.permissions as Record<string, unknown>).members).toEqual({});
  });

  it("leaves an already-explicit collections value alone", async () => {
    const admin = await setupTenant();
    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    const customized = { ...(superAdmin!.permissions as Record<string, unknown>), collections: { read: true } };
    await db.role.update({
      where: { id: superAdmin!.id, tenantId: admin.user.tenantId },
      data: { permissions: customized as unknown as Prisma.InputJsonValue }
    });

    await runBackfill();

    const updated = await db.role.findUniqueOrThrow({ where: { id: superAdmin!.id } });
    expect((updated.permissions as Record<string, unknown>).collections).toEqual({ read: true });
  });

  it("is idempotent", async () => {
    const admin = await setupTenant();
    await stripCollectionsAndKolektor(admin.user.tenantId);

    await runBackfill();
    const kolektorCountAfterFirst = await db.role.count({ where: { tenantId: admin.user.tenantId, name: "Kolektor" } });
    await runBackfill();
    const kolektorCountAfterSecond = await db.role.count({ where: { tenantId: admin.user.tenantId, name: "Kolektor" } });

    expect(kolektorCountAfterFirst).toBe(1);
    expect(kolektorCountAfterSecond).toBe(1);
    const superAdmin = await roleByName(admin.user.tenantId, "Super Admin");
    expect((superAdmin?.permissions as Record<string, unknown>).collections).toEqual({
      create: true,
      read: true,
      update: true,
      delete: true
    });
  });
});
