import type { Prisma } from "@prisma/client";
import { db } from "./db.js";

export interface IdempotentResult {
  status: number;
  envelope: Record<string, unknown>;
}

/**
 * Deduplicates a retried write from a flaky mobile connection (koperasi
 * pasar F6 plan) — a client resends the same key when it never saw the
 * response to an earlier attempt. `key` absent (no `Idempotency-Key` header
 * sent) is a plain passthrough, so this is opt-in per route.
 *
 * Race window accepted by design: two truly concurrent requests for the same
 * (tenantId, userId, key) could both miss the initial lookup and both run
 * `fn`, same as this codebase's other check-then-write patterns (e.g.
 * createMarket's duplicate-name check). Not a real risk here — the mobile
 * client that sends this header submits one request at a time, disabling its
 * button while in flight, so a retry only ever follows a completed or failed
 * prior attempt, never a live one.
 */
export async function withIdempotency(
  tenantId: string,
  userId: string,
  key: string | null,
  fn: () => Promise<IdempotentResult>
): Promise<IdempotentResult> {
  if (!key) return fn();

  const existing = await db.idempotencyKey.findFirst({ where: { tenantId, userId, key } });
  if (existing) {
    return { status: existing.responseStatus, envelope: existing.responseBody as Record<string, unknown> };
  }

  const result = await fn();
  await db.idempotencyKey.create({
    data: {
      tenantId,
      userId,
      key,
      responseStatus: result.status,
      responseBody: result.envelope as Prisma.InputJsonValue
    }
  });
  return result;
}
