import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { buildBuckets, fill, granularityOf, monthBuckets } from "../src/modules/platform-dashboard/buckets.js";
import { utcParam } from "../src/modules/platform-dashboard/counts.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("buildBuckets", () => {
  it("returns 30 daily buckets ending today (Asia/Jakarta) for 30d", () => {
    const b = buildBuckets("30d", NOW);
    expect(b).toHaveLength(30);
    expect(b[0]?.key).toBe("2026-10-02");
    expect(b[0]?.start.toISOString()).toBe("2026-10-01T17:00:00.000Z");
    expect(b[29]?.key).toBe("2026-10-31");
  });

  it("rolls to the next Jakarta day at 17:00 UTC", () => {
    const b = buildBuckets("30d", new Date("2026-10-31T20:00:00Z"));
    expect(b[29]?.key).toBe("2026-11-01");
    expect(b[29]?.start.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("starts the Jakarta month at 17:00 UTC on the previous day", () => {
    const b = monthBuckets(new Date("2026-10-31T20:00:00Z"), 2);
    expect(b.map((x) => x.key)).toEqual(["2026-10", "2026-11"]);
    expect(b[1]?.start.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("returns 90 daily buckets for 90d", () => {
    expect(buildBuckets("90d", NOW)).toHaveLength(90);
  });

  it("returns 12 monthly buckets for 12m, oldest first", () => {
    const b = buildBuckets("12m", NOW);
    expect(b.map((x) => x.key)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"
    ]);
    expect(b[0]?.start.toISOString()).toBe("2025-10-31T17:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const b = monthBuckets(new Date("2026-02-10T00:00:00Z"), 3);
    expect(b.map((x) => x.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("utcParam", () => {
  it("binds a Date as UTC wall time whatever the session TimeZone", async () => {
    const at = new Date("2026-10-31T20:00:00Z");
    const [row] = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/New_York'`);
      return tx.$queryRaw<{ v: string }[]>(Prisma.sql`SELECT to_char(${utcParam(at)}, 'YYYY-MM-DD HH24:MI') AS v`);
    });
    expect(row?.v).toBe("2026-10-31 20:00");
  });
});

describe("granularityOf / fill", () => {
  it("uses month granularity only for 12m", () => {
    expect(granularityOf("30d")).toBe("day");
    expect(granularityOf("90d")).toBe("day");
    expect(granularityOf("12m")).toBe("month");
  });

  it("zero-fills buckets missing from the sparse rows", () => {
    const buckets = monthBuckets(NOW, 2);
    const out = fill(buckets, new Map([["2026-10", 5]]), () => 0);
    expect(out).toEqual([0, 5]);
  });
});
