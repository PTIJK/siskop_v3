import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { purgeStaleAuditLogs, recordAudit } from "../src/modules/audit-log/service.js";
import { currentRequestContext, runWithRequestContext } from "../src/lib/request-context.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("request-context", () => {
  it("returns the seeded context inside runWithRequestContext, and undefined outside it", () => {
    expect(currentRequestContext()).toBeUndefined();

    const ctx = { tenantId: "t1", actorUserId: "u1", requestId: "r1", ip: null, userAgent: null };
    const result = runWithRequestContext(ctx, () => currentRequestContext());

    expect(result).toEqual(ctx);
    expect(currentRequestContext()).toBeUndefined();
  });
});

describe("recordAudit", () => {
  it("throws when called with no ambient request context and no explicit actor", async () => {
    await expect(db.$transaction((tx) => recordAudit(tx, { action: "test.noop" }))).rejects.toThrow(
      /no ambient request context/
    );
  });

  it("serializes a Prisma.Decimal in `after` as a string, never a float (CLAUDE.md rule 2)", async () => {
    const admin = await setupTenant();

    await db.$transaction((tx) =>
      runWithRequestContext(
        { tenantId: admin.user.tenantId, actorUserId: admin.user.id, requestId: randomUUID(), ip: null, userAgent: null },
        () =>
          recordAudit(tx, {
            action: "test.decimal",
            after: { principalAmount: new Prisma.Decimal("1234567890123.45") }
          })
      )
    );

    const row = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "test.decimal" }
    });
    expect(row.after).toEqual({ principalAmount: "1234567890123.45" });
  });
});

describe("GET /api/audit-log", () => {
  it("returns an empty list for a fresh tenant", async () => {
    const admin = await setupTenant();

    const res = await request(app()).get("/api/audit-log").set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 0 });
  });

  it("lists a seeded row with the actor's resolved name", async () => {
    const admin = await setupTenant();
    await db.auditLog.create({
      data: {
        tenantId: admin.user.tenantId,
        actorUserId: admin.user.id,
        action: "role.update",
        entityType: "Role",
        entityId: "role_1",
        requestId: randomUUID()
      }
    });

    const res = await request(app()).get("/api/audit-log").set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: "role.update",
      entityType: "Role",
      entityId: "role_1",
      actorUserId: admin.user.id,
      actorName: "Admin Demo"
    });
  });

  it("filters by action, actorUserId and date range", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    await db.auditLog.createMany({
      data: [
        {
          tenantId: admin.user.tenantId,
          actorUserId: admin.user.id,
          action: "role.update",
          requestId: randomUUID(),
          createdAt: new Date("2026-01-01T00:00:00Z")
        },
        {
          tenantId: admin.user.tenantId,
          actorUserId: teller.user.id,
          action: "loan.create",
          requestId: randomUUID(),
          createdAt: new Date("2026-02-01T00:00:00Z")
        }
      ]
    });

    const byAction = await request(app())
      .get("/api/audit-log?action=loan.create")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byAction.body.data).toHaveLength(1);
    expect(byAction.body.data[0].action).toBe("loan.create");

    const byActor = await request(app())
      .get(`/api/audit-log?actorUserId=${admin.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byActor.body.data).toHaveLength(1);
    expect(byActor.body.data[0].action).toBe("role.update");

    const byRange = await request(app())
      .get("/api/audit-log?from=2026-01-15T00:00:00Z")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const rangeActions = byRange.body.data.map((d: { action: string }) => d.action);
    // createStaffSession above logs in for real, so an auth.login_success row
    // (created just now) also falls inside this range — assert on presence,
    // not an exact count that would break every time login auditing does too.
    expect(rangeActions).toContain("loan.create");
    expect(rangeActions).not.toContain("role.update");
  });

  it("lets a Manager read the audit log", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const res = await request(app()).get("/api/audit-log").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(res.status).toBe(200);
  });

  it("rejects a Teller — auditLog.read is not granted to that role", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app()).get("/api/audit-log").set("Authorization", `Bearer ${teller.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("never leaks another tenant's audit rows", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await db.auditLog.create({
      data: {
        tenantId: tenantB.user.tenantId,
        actorUserId: tenantB.user.id,
        action: "role.update",
        requestId: randomUUID()
      }
    });

    const res = await request(app()).get("/api/audit-log").set("Authorization", `Bearer ${tenantA.accessToken}`);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("purgeStaleAuditLogs", () => {
  it("deletes rows older than 90 days across multiple tenants in one call", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const asOf = new Date("2026-06-01T00:00:00Z");
    const old = new Date(asOf.getTime() - 91 * 24 * 60 * 60 * 1000);
    const recent = new Date(asOf.getTime() - 10 * 24 * 60 * 60 * 1000);

    await db.auditLog.createMany({
      data: [
        { tenantId: tenantA.user.tenantId, actorUserId: tenantA.user.id, action: "old.a", requestId: randomUUID(), createdAt: old },
        { tenantId: tenantA.user.tenantId, actorUserId: tenantA.user.id, action: "recent.a", requestId: randomUUID(), createdAt: recent },
        { tenantId: tenantB.user.tenantId, actorUserId: tenantB.user.id, action: "old.b", requestId: randomUUID(), createdAt: old }
      ]
    });

    const result = await purgeStaleAuditLogs(asOf);
    expect(result.deleted).toBe(2);

    const remainingA = await db.auditLog.findMany({ where: { tenantId: tenantA.user.tenantId } });
    const remainingB = await db.auditLog.findMany({ where: { tenantId: tenantB.user.tenantId } });
    expect(remainingA.map((r) => r.action)).toEqual(["recent.a"]);
    expect(remainingB).toEqual([]);
  });

  it("pins the reason withoutTenantScope is required — a bare cross-tenant deleteMany is refused", async () => {
    await expect(db.auditLog.deleteMany({ where: { createdAt: { lt: new Date() } } })).rejects.toThrow(
      /Refusing AuditLog\.deleteMany/
    );
  });
});
