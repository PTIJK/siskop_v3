import type { DashboardRange } from "@siskop/types";

export type Granularity = "day" | "month";

export interface Bucket {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month). */
  key: string;
  /** Inclusive UTC start of the bucket. */
  start: Date;
}

const DAY_MS = 86_400_000;

export const granularityOf = (range: DashboardRange): Granularity => (range === "12m" ? "month" : "day");

const bucketCount = (range: DashboardRange): number => (range === "30d" ? 30 : range === "90d" ? 90 : 12);

/** The last `count` calendar months ending with `now`'s month, oldest first (UTC). */
export function monthBuckets(now: Date, count: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: start.toISOString().slice(0, 7), start });
  }
  return out;
}

/** Zero-filled, oldest-first buckets for a dashboard range. */
export function buildBuckets(range: DashboardRange, now: Date): Bucket[] {
  if (granularityOf(range) === "month") return monthBuckets(now, bucketCount(range));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: Bucket[] = [];
  for (let i = bucketCount(range) - 1; i >= 0; i--) {
    const start = new Date(today - i * DAY_MS);
    out.push({ key: start.toISOString().slice(0, 10), start });
  }
  return out;
}

/** One value per bucket: the sparse row if present, else `empty(key)`. */
export function fill<T>(buckets: Bucket[], byKey: Map<string, T>, empty: (key: string) => T): T[] {
  return buckets.map((b) => byKey.get(b.key) ?? empty(b.key));
}
