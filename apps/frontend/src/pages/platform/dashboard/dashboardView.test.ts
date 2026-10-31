import { describe, expect, it } from "vitest";
import type { RegionRow, TechnicalPoint } from "@siskop/types";
import { bucketLabel, deltaLabel, describeValue, hasTechnicalData, topRegions, totalRequests } from "./dashboardView";

describe("bucketLabel", () => {
  it("formats a day as 'D Mon' and a month as 'Mon YYYY' in Indonesian", () => {
    expect(bucketLabel("2026-10-05")).toBe("5 Okt");
    expect(bucketLabel("2026-05-30")).toBe("30 Mei");
    expect(bucketLabel("2026-08")).toBe("Agu 2026");
  });
});

describe("deltaLabel", () => {
  it("signs the change and uses a decimal comma", () => {
    expect(deltaLabel(12.5)).toBe("+12,5% dari bulan lalu");
    expect(deltaLabel(-3)).toBe("-3,0% dari bulan lalu");
    expect(deltaLabel(0)).toBe("0,0% dari bulan lalu");
  });
  it("says there is nothing to compare when null", () => {
    expect(deltaLabel(null)).toBe("Belum ada pembanding");
  });
});

describe("hasTechnicalData", () => {
  const point = (requests: number): TechnicalPoint => ({ bucket: "2026-10-01", requests, errorRate: 0, p50Ms: null, p95Ms: null });
  it("is true only when some bucket has requests", () => {
    expect(hasTechnicalData([point(0), point(0)])).toBe(false);
    expect(hasTechnicalData([point(0), point(3)])).toBe(true);
  });
});

describe("topRegions", () => {
  const row = (code: string | null, name: string): RegionRow => ({ code, name, tenants: 1, users: 1, members: 1 });
  it("keeps the first N named regions and always appends the unset row", () => {
    const rows = [row("35", "Jawa Timur"), row("32", "Jawa Barat"), row("33", "Jawa Tengah"), row(null, "Belum diisi")];
    expect(topRegions(rows, 2).map((r) => r.name)).toEqual(["Jawa Timur", "Jawa Barat", "Belum diisi"]);
  });
  it("omits the unset row when there is none", () => {
    expect(topRegions([row("35", "Jawa Timur")], 5)).toHaveLength(1);
  });
});

describe("totalRequests", () => {
  const point = (requests: number): TechnicalPoint => ({ bucket: "2026-10-01", requests, errorRate: 0, p50Ms: null, p95Ms: null });
  it("sums requests across buckets", () => {
    expect(totalRequests([point(2), point(3), point(0)])).toBe(5);
    expect(totalRequests([])).toBe(0);
  });
});

describe("describeValue", () => {
  it("says there is no data for null instead of 0", () => {
    expect(describeValue(null)).toBe("tidak ada data");
    expect(describeValue(undefined)).toBe("tidak ada data");
    expect(describeValue(0)).toBe("0");
    expect(describeValue(12)).toBe("12");
  });
});
