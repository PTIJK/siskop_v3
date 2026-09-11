import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";

/**
 * Day 5 KSU spike: thin HTTP routes over the Day 4 service functions
 * (getMemberUnitStatement / checkUnitSegregation), which until now were
 * service-layer only — see modules/ksu/routes.ts. Same auth/entitlement/
 * permission gate as the existing GET /api/ksu/consolidated route; tenantId
 * comes only from authClaims, and memberId/unitId path params are validated
 * as belonging to the caller's tenant by the underlying service functions
 * (both already tested at the service layer in tests/ksu-member-statement.test.ts
 * — these tests only prove the HTTP wiring, not the business logic again).
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/ksu/members/:memberId/statement", () => {
  it("returns a real per-unit SHU statement for a member in the caller's own tenant", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .get(`/api/ksu/members/${member.id}/statement`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.memberId).toBe(member.id);
    expect(res.body.data.units).toEqual([expect.objectContaining({ unitId: unit.id, unitName: unit.name })]);
  });

  it("404s for a member id belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);

    const res = await request(app())
      .get(`/api/ksu/members/${memberB.id}/statement`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("404s for a member id that does not exist at all", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/ksu/members/does-not-exist/statement")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/ksu/units/:unitId/segregation", () => {
  it("returns a real segregation status for a unit in the caller's own tenant", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .get(`/api/ksu/units/${unit.id}/segregation`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unitId).toBe(unit.id);
    expect(res.body.data.status).toBe("OK");
    expect(res.body.data.thresholdRp).toBe(5_000_000_000);
  });

  it("404s for a unit id belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });

    const res = await request(app())
      .get(`/api/ksu/units/${unitB.id}/segregation`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("404s for a unit id that does not exist at all", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/ksu/units/does-not-exist/segregation")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
  });
});
