import type { DashboardRange } from "@siskop/types";

export type Granularity = "day" | "month";

export interface Bucket {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month), an Asia/Jakarta calendar date. */
  key: string;
  /** Inclusive start of the bucket: Jakarta midnight as a UTC instant. */
  start: Date;
}

const DAY_MS = 86_400_000;
/** Asia/Jakarta is UTC+7 with no DST. Buckets follow the Jakarta calendar, like the rest of the app's reports. */
export const JAKARTA_OFFSET_MS = 7 * 3_600_000;

/** `d` shifted so its UTC fields read as the Jakarta wall clock. */
export const jakartaWallClock = (d: Date): Date => new Date(d.getTime() + JAKARTA_OFFSET_MS);

export const granularityOf = (range: DashboardRange): Granularity => (range === "12m" ? "month" : "day");

const bucketCount = (range: DashboardRange): number => (range === "30d" ? 30 : range === "90d" ? 90 : 12);

/** The last `count` Jakarta calendar months ending with `now`'s month, oldest first. */
export function monthBuckets(now: Date, count: number): Bucket[] {
  const local = jakartaWallClock(now);
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - i, 1);
    out.push({ key: new Date(wall).toISOString().slice(0, 7), start: new Date(wall - JAKARTA_OFFSET_MS) });
  }
  return out;
}

/** Zero-filled, oldest-first buckets for a dashboard range. */
export function buildBuckets(range: DashboardRange, now: Date): Bucket[] {
  if (granularityOf(range) === "month") return monthBuckets(now, bucketCount(range));
  const local = jakartaWallClock(now);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const out: Bucket[] = [];
  for (let i = bucketCount(range) - 1; i >= 0; i--) {
    const wall = today - i * DAY_MS;
    out.push({ key: new Date(wall).toISOString().slice(0, 10), start: new Date(wall - JAKARTA_OFFSET_MS) });
  }
  return out;
}

/** One value per bucket: the sparse row if present, else `empty(key)`. */
export function fill<T>(buckets: Bucket[], byKey: Map<string, T>, empty: (key: string) => T): T[] {
  return buckets.map((b) => byKey.get(b.key) ?? empty(b.key));
}
