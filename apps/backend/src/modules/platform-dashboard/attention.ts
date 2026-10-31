import { Prisma } from "@prisma/client";
import type { AttentionItem, AttentionSeverity } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

const DAY_MS = 86_400_000;
const MAX_OVERDUE_LISTED = 10;
const ERROR_RATE_THRESHOLD = 0.05;
const ERROR_RATE_MIN_REQUESTS = 20;
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

/** Null unless the window has enough traffic and at least a 5% 5xx rate. */
export function errorRateAlert(requests: number, errors: number): AttentionItem | null {
  if (requests < ERROR_RATE_MIN_REQUESTS || errors / requests < ERROR_RATE_THRESHOLD) return null;
  const pct = ((errors / requests) * 100).toFixed(1).replace(".", ",");
  return {
    id: "error-rate",
    severity: "critical",
    kind: "ERROR_RATE",
    message: `${pct}% request gagal (5xx) dalam 24 jam terakhir, dari ${requests} request`
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}`;

export async function getAttention(now: Date): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const day = new Date(now.getTime() - DAY_MS);
  const idleSince = new Date(now.getTime() - 30 * DAY_MS);
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  const [overdue, pastDue, dueSoon, idle, noRegion, metrics] = await Promise.all([
    withoutTenantScope(async () =>
      db.invoice.findMany({
        where: { status: "OPEN", dueDate: { lt: now } },
        include: { tenant: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: MAX_OVERDUE_LISTED
      })
    ),
    withoutTenantScope(async () => db.tenantSubscription.count({ where: { status: "PAST_DUE" } })),
    withoutTenantScope(async () =>
      db.tenantSubscription.count({ where: { status: "ACTIVE", nextBillingDate: { gte: now, lte: soon } } })
    ),
    db.$queryRaw<{ name: string }[]>(Prisma.sql`
      SELECT t.name FROM "Tenant" t
      WHERE t."isActive" = true AND t."createdAt" < ${idleSince}
        AND NOT EXISTS (
          SELECT 1 FROM "User" u
          WHERE u."tenantId" = t.id AND u."isPlatformAdmin" = false AND u."lastLoginAt" >= ${idleSince}
        )
      ORDER BY t.name LIMIT 50
    `),
    db.tenant.count({ where: { province: null } }),
    db.requestMetricHourly.aggregate({ where: { hour: { gte: day } }, _sum: { count: true, errors5xx: true } })
  ]);

  const rateAlert = errorRateAlert(metrics._sum.count ?? 0, metrics._sum.errors5xx ?? 0);
  if (rateAlert) items.push(rateAlert);

  for (const inv of overdue) {
    const days = Math.max(1, Math.floor((now.getTime() - inv.dueDate.getTime()) / DAY_MS));
    items.push({
      id: `invoice:${inv.id}`,
      severity: "critical",
      kind: "INVOICE_OVERDUE",
      message: `Faktur ${inv.number} (${inv.tenant.name}) lewat jatuh tempo ${days} hari`,
      href: "/platform/invoices"
    });
  }

  if (pastDue > 0) {
    items.push({
      id: "subscriptions-past-due",
      severity: "warning",
      kind: "SUBSCRIPTION_PAST_DUE",
      message: `${plural(pastDue, "langganan")} berstatus menunggak`,
      href: "/platform/tenants"
    });
  }
  if (dueSoon > 0) {
    items.push({
      id: "billing-due-soon",
      severity: "info",
      kind: "BILLING_DUE_SOON",
      message: `${plural(dueSoon, "langganan")} jatuh tempo dalam 7 hari`,
      href: "/platform/invoices"
    });
  }
  if (idle.length > 0) {
    const names = idle.slice(0, 3).map((t) => t.name).join(", ");
    const more = idle.length > 3 ? `, dan ${idle.length - 3} lainnya` : "";
    items.push({
      id: "tenants-inactive",
      severity: "warning",
      kind: "TENANT_INACTIVE",
      message: `${idle.length} koperasi aktif tanpa login 30 hari terakhir: ${names}${more}`,
      href: "/platform/tenants"
    });
  }
  if (noRegion > 0) {
    items.push({
      id: "tenants-no-region",
      severity: "info",
      kind: "TENANT_NO_REGION",
      message: `${noRegion} koperasi belum diisi wilayahnya`,
      href: "/platform/tenants"
    });
  }

  return sortAttention(items);
}
