import { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import type { Granularity } from "./buckets.js";

type CountedTable = "Tenant" | "User" | "Member" | "AuditLog";

/**
 * A Date parameter as UTC wall time, for comparison with a `timestamp` (without time zone)
 * column. Correct whatever the session TimeZone is.
 */
export function utcParam(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** A UTC `timestamp` column shifted to the Asia/Jakarta wall clock (UTC+7, no DST). */
export function jakartaColumn(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${column} + interval '7 hours')`;
}

/**
 * Rows created since `since`, grouped into Asia/Jakarta day/month buckets keyed like
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
    SELECT to_char(date_trunc(${granularity}::text, ${jakartaColumn(Prisma.sql`"createdAt"`)}), ${format}::text) AS bucket, COUNT(*) AS n
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "createdAt" >= ${utcParam(since)} ${extra}
    GROUP BY 1
  `);
  return new Map(rows.map((r) => [r.bucket, Number(r.n)]));
}
