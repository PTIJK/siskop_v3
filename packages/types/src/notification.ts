// Tenant + permission-scoped in-app notifications — distinct from the
// platform-admin-only Notification/NotificationRead (see schema.prisma). A
// notification is visible only to callers whose Permissions blob grants
// permissionModule.permissionAction, the same shape requirePermission checks.

export const TenantNotificationType = {
  MEMBER_REGISTRATION_PENDING: "MEMBER_REGISTRATION_PENDING"
} as const;

export type TenantNotificationType = (typeof TenantNotificationType)[keyof typeof TenantNotificationType];

export interface TenantNotification {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  message: string;
  permissionModule: string;
  permissionAction: string;
  relatedId?: string | null;
  createdAt: string;
  /** Whether the current caller has read this notification — per-user, not global. */
  read: boolean;
}
