import { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import type { Granularity } from "./buckets.js";

type CountedTable = "Tenant" | "User" | "Member" | "AuditLog";

/**
 * Rows created since `since`, grouped into UTC day/month buckets keyed like
 * buckets.ts (`YYYY-MM-DD` / `YYYY-MM`). Cross-tenant by design: callers are
 * platform-admin only. `extra` is a trusted SQL fragment, never user input.
 */
export async function countPerBucket(
  table: CountedTable,
  granularity: Granularity,
  since: Date,
  extra: Prisma.Sql = Prisma.empty
): Promise<Map<string, number>> {
  const format = granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const rows = await db.$queryRaw<{ bucket: string; n: bigint }[]>(Prisma.sql`
    SELECT to_char(date_trunc(${granularity}::text, "createdAt"), ${format}::text) AS bucket, COUNT(*) AS n
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "createdAt" >= ${since} ${extra}
    GROUP BY 1
  `);
  return new Map(rows.map((r) => [r.bucket, Number(r.n)]));
}
