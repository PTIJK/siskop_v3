import { describe, expect, it } from "vitest";
import { buildBuckets, fill, granularityOf, monthBuckets } from "../src/modules/platform-dashboard/buckets.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("buildBuckets", () => {
  it("returns 30 daily buckets ending today (UTC) for 30d", () => {
    const b = buildBuckets("30d", NOW);
    expect(b).toHaveLength(30);
    expect(b[0]?.key).toBe("2026-10-02");
    expect(b[29]?.key).toBe("2026-10-31");
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
    expect(b[0]?.start.toISOString()).toBe("2025-11-01T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const b = monthBuckets(new Date("2026-02-10T00:00:00Z"), 3);
    expect(b.map((x) => x.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
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
