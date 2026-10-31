import type { DashboardRange, PlatformDashboard } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { getAttention } from "./attention.js";
import { getGrowth, getMembers } from "./growth.js";
import { getPerformance } from "./performance.js";
import { getRegions } from "./regions.js";
import { getRevenue } from "./revenue.js";

/**
 * Cross-tenant by design: callers are platform admins only (platformRoutes() applies
 * requirePlatformAdmin). Nothing here accepts a tenantId.
 */
export async function getPlatformDashboard(range: DashboardRange, now: Date = new Date()): Promise<PlatformDashboard> {
  const [growth, members, regions, attention, revenue, performance, tenants, users] = await Promise.all([
    getGrowth(range, now),
    getMembers(range, now),
    getRegions(),
    getAttention(now),
    getRevenue(now),
    getPerformance(range, now),
    db.tenant.count(),
    withoutTenantScope(async () => db.user.count({ where: { isPlatformAdmin: false } }))
  ]);

  return {
    range,
    generatedAt: now.toISOString(),
    kpis: { tenants, users, members: members.total, mrr: revenue.mrr },
    performance,
    growth,
    members,
    regions,
    attention,
    revenue
  };
}
