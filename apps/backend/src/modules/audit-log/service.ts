import type { Prisma } from "@prisma/client";
import type { AuditLogPurgeResult } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { currentRequestContext } from "../../lib/request-context.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import type { ListAuditLogQueryInput } from "./schema.js";

const RETENTION_DAYS = 90;

export interface RecordAuditInput {
  /** e.g. `"role.update"`, `"auth.login_failed"`. */
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Only needed for events that happen before req.auth/the ambient context exist — e.g. login. */
export interface AuditActor {
  tenantId: string;
  actorUserId: string | null;
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * JSON.stringify round-trip: Prisma.Decimal defines its own toJSON() (its
 * string form), so this is what makes a Decimal snapshot land as a string in
 * the stored JSON, never a JS float (CLAUDE.md rule 2 — money is Decimal,
 * never Float/number). Call sites should pass small explicit "changed
 * fields" objects, not whole ORM rows with relations — cheaper to store and
 * avoids leaking relation data into the trail.
 */
function serializeForAudit(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Written inside the same transaction as the business mutation it describes
 * (same discipline as lib/journal.ts appending JournalLines alongside their
 * source transaction), so the audit row can never exist without the change
 * it documents, or vice versa. `explicitActor` is only for the handful of
 * events with no ambient request context yet (auth.login_success/failed run
 * before req.auth exists) — every other call site omits it and relies on
 * requireAuth having seeded the context.
 */
export async function recordAudit(tx: TxClient, input: RecordAuditInput, explicitActor?: AuditActor): Promise<void> {
  const actor = explicitActor ?? currentRequestContext();
  if (!actor) throw new Error("recordAudit: no ambient request context and no explicit actor provided");

  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.actorUserId,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      before: serializeForAudit(input.before),
      after: serializeForAudit(input.after),
      requestId: actor.requestId,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null
    }
  });
}

export async function listAuditLogs(tenantId: string, query: ListAuditLogQueryInput) {
  const { page, limit, actorUserId, action, entityType, from, to } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    tenantId,
    ...(actorUserId ? { actorUserId } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
          }
        }
      : {})
  };

  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
    db.auditLog.count({ where })
  ]);

  // Same-tenant batch name resolution, following listAccountMappings's
  // sourceName precedent (config/service.ts) — actorUserId carries no
  // relation (see schema.prisma's AuditLog comment), so the wire shape
  // denormalizes actorName here rather than making the frontend join itself.
  const actorIds = [...new Set(items.map((item) => item.actorUserId).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { tenantId, id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  return {
    items: items.map((log) => ({
      ...log,
      actorName: log.actorUserId ? nameById.get(log.actorUserId) ?? null : null
    })),
    meta: { page, limit, total }
  };
}

/**
 * 90-day retention. Deliberately cross-tenant — this is housekeeping, not a
 * per-tenant business operation, so it goes through withoutTenantScope();
 * AuditLog is in TENANT_SCOPED_MODELS (tenant-scope.ts) and a bare deleteMany
 * with no tenantId filter would otherwise be refused (see the pinning test
 * in tests/audit-log.test.ts). Called from runDailyScheduler
 * (modules/scheduler/service.ts), never its own HTTP route.
 */
export async function purgeStaleAuditLogs(asOf: Date = new Date()): Promise<AuditLogPurgeResult> {
  const cutoff = new Date(asOf.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await withoutTenantScope(() => db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }));
  return { deleted: result.count, failed: 0 };
}
