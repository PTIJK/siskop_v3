// User-activity audit trail (admin/staff `User` actions only — never
// Member-portal activity, never platform-admin cross-tenant actions, which
// get their own separate feed later). Rows are never user-editable: no
// Create/Update/Delete request types exist for this entity.
export interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  /** Resolved server-side from actorUserId — null if the actor no longer exists. */
  actorName: string | null;
  /** e.g. `"role.update"`, `"auth.login_failed"`. */
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ListAuditLogQuery {
  page?: number;
  limit?: number;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  /** ISO date/datetime, inclusive lower bound on createdAt. */
  from?: string;
  /** ISO date/datetime, inclusive upper bound on createdAt. */
  to?: string;
}
