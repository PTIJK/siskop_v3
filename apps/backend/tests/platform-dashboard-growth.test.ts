import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getGrowth, getMembers } from "../src/modules/platform-dashboard/growth.js";
import { createMemberAs, createPlatformAdminSession, setupTenant } from "./helpers.js";

const NOW = new Date("2026-10-31T12:00:00Z");

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function backdate(table: "Tenant" | "User" | "Member", tenantId: string, at: string) {
  const column = table === "Tenant" ? '"id"' : '"tenantId"';
  await db.$executeRawUnsafe(`UPDATE "${table}" SET "createdAt" = $1 WHERE ${column} = $2`, new Date(at), tenantId);
}

describe("getGrowth", () => {
  it("counts new tenants and staff users per day, zero-filled", async () => {
    const s = await setupTenant();
    await backdate("Tenant", s.user.tenantId, "2026-10-30T08:00:00Z");
    await backdate("User", s.user.tenantId, "2026-10-29T08:00:00Z");

    const series = await getGrowth("30d", NOW);

    expect(series).toHaveLength(30);
    expect(series.find((p) => p.bucket === "2026-10-30")).toMatchObject({ tenants: 1, users: 0 });
    expect(series.find((p) => p.bucket === "2026-10-29")).toMatchObject({ tenants: 0, users: 1 });
    expect(series.find((p) => p.bucket === "2026-10-31")).toMatchObject({ tenants: 0, users: 0 });
  });

  it("does not count platform admins as users", async () => {
    const session = await createPlatformAdminSession();
    await backdate("User", session.user.tenantId, "2026-10-30T08:00:00Z");

    const series = await getGrowth("30d", NOW);

    // The tenant has one staff admin and one platform admin; only the staff admin counts.
    expect(series.find((p) => p.bucket === "2026-10-30")?.users).toBe(1);
  });

  it("buckets by month for 12m", async () => {
    const s = await setupTenant();
    await backdate("Tenant", s.user.tenantId, "2026-03-15T08:00:00Z");

    const series = await getGrowth("12m", NOW);

    expect(series).toHaveLength(12);
    expect(series.find((p) => p.bucket === "2026-03")?.tenants).toBe(1);
  });
});

describe("getMembers", () => {
  it("adds in-window members to the running total", async () => {
    const s = await setupTenant();
    await createMemberAs(s.accessToken);
    await backdate("Member", s.user.tenantId, "2026-10-15T08:00:00Z");

    const { series, total } = await getMembers("30d", NOW);

    expect(total).toBe(1);
    expect(series.find((p) => p.bucket === "2026-10-14")).toMatchObject({ newMembers: 0, totalMembers: 0 });
    expect(series.find((p) => p.bucket === "2026-10-15")).toMatchObject({ newMembers: 1, totalMembers: 1 });
    expect(series.at(-1)).toMatchObject({ newMembers: 0, totalMembers: 1 });
  });

  it("starts the running total from members created before the window", async () => {
    const s = await setupTenant();
    await createMemberAs(s.accessToken);
    await backdate("Member", s.user.tenantId, "2026-08-01T08:00:00Z");

    const { series, total } = await getMembers("30d", NOW);

    expect(total).toBe(1);
    expect(series[0]).toMatchObject({ newMembers: 0, totalMembers: 1 });
  });
});
