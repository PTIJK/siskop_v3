import type { Prisma } from "@prisma/client";
import type { TxClient } from "../db.js";

export interface PricingAuditEntry {
  actorId?: string | null;
  entity: string;
  entityId?: string | null;
  action: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/** Every pricing write goes through here so the owner console can show who changed what. */
export async function writePricingAudit(tx: TxClient, entry: PricingAuditEntry): Promise<void> {
  await tx.pricingAuditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      action: entry.action,
      ...(entry.before != null ? { before: entry.before } : {}),
      ...(entry.after != null ? { after: entry.after } : {})
    }
  });
}
