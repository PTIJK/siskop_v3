import type { AuthClaims, Permissions } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";

// Bounded rather than paginated: this feeds a Topbar bell dropdown, not a
// list page, and per-tenant notification volume is naturally small (one row
// per self-registration submission today). Revisit with real pagination if a
// future notification type makes that assumption wrong.
const RECENT_LIMIT = 50;

export interface CreateTenantNotificationInput {
  tenantId: string;
  /** Plain string, not a Prisma enum — see TenantNotification in schema.prisma. */
  type: string;
  title: string;
  message: string;
  permissionModule: string;
  permissionAction: string;
  relatedId?: string;
}

/**
 * Takes an explicit client (db, or a caller's `tx`) rather than always using
 * the module-level `db` — same convention as lib/journal.ts's post* helpers —
 * so a notification raised as a side effect of some other write (e.g. a new
 * MemberRegistrationRequest) commits atomically with it instead of on a
 * separate connection.
 */
export async function createTenantNotification(client: TxClient | typeof db, input: CreateTenantNotificationInput) {
  return client.tenantNotification.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      title: input.title,
      message: input.message,
      permissionModule: input.permissionModule,
      permissionAction: input.permissionAction,
      relatedId: input.relatedId
    }
  });
}

/** Same permission shape requirePermission (middleware/rbac.ts) checks — a
 * notification is visible only to callers whose Permissions blob grants the
 * exact module.action it was raised under. */
function isVisibleTo(auth: AuthClaims, permissionModule: string, permissionAction: string): boolean {
  const modulePerms = auth.permissions[permissionModule as keyof Permissions] as Record<string, boolean> | undefined;
  return modulePerms?.[permissionAction] === true;
}

export async function listNotificationsForUser(auth: AuthClaims) {
  const recent = await db.tenantNotification.findMany({
    where: { tenantId: auth.tenantId },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    include: { reads: { where: { userId: auth.userId }, select: { id: true } } }
  });

  const items = recent
    .filter((n) => isVisibleTo(auth, n.permissionModule, n.permissionAction))
    .map(({ reads, ...notification }) => ({ ...notification, read: reads.length > 0 }));

  const unreadCount = items.filter((n) => !n.read).length;
  return { items, unreadCount };
}

export async function markNotificationRead(tenantId: string, userId: string, id: string): Promise<void> {
  const notification = await db.tenantNotification.findFirst({ where: { id, tenantId } });
  if (!notification) throw notFound("Notifikasi tidak ditemukan");

  await db.tenantNotificationRead.upsert({
    where: { notificationId_userId: { notificationId: id, userId } },
    update: {},
    create: { notificationId: id, userId }
  });
}
