import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../../lib/db.js";

interface Sample {
  hour: Date;
  routeGroup: string;
  /** Every request recorded, including those past the duration cap. */
  count: number;
  durations: number[];
  errors: number;
}

/** In-memory samples since the last flush, keyed `${hourIso}|${routeGroup}`. */
let buffer = new Map<string, Sample>();

/** Per key per flush window, durations kept for the percentiles. `count` and `errors` are never capped. */
export const MAX_SAMPLES = 5_000;
/** Distinct keys per flush window; any new key past this is recorded under OVERFLOW_GROUP. */
export const MAX_KEYS = 500;
const OVERFLOW_GROUP = "other";
const MAX_GROUP_LENGTH = 120;
const SKIPPED_PATHS = new Set(["/health", "/api/health"]);

export function hourOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export function recordRequest(hour: Date, routeGroup: string, durationMs: number, status: number): void {
  let key = `${hour.toISOString()}|${routeGroup}`;
  let sample = buffer.get(key);
  if (!sample && buffer.size >= MAX_KEYS) {
    routeGroup = OVERFLOW_GROUP;
    key = `${hour.toISOString()}|${routeGroup}`;
    sample = buffer.get(key);
  }
  if (!sample) {
    sample = { hour, routeGroup, count: 0, durations: [], errors: 0 };
    buffer.set(key, sample);
  }
  sample.count += 1;
  if (sample.durations.length < MAX_SAMPLES) sample.durations.push(durationMs);
  if (status >= 500) sample.errors += 1;
}

/** `hour` as UTC wall time, independent of the session TimeZone (the column is timestamp without time zone). */
function utcTimestamp(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/**
 * Writes and clears the buffer. Each sample is one atomic upsert, so overlapping flushes and
 * other instances merge instead of racing. A failed write drops that sample rather than blocking requests.
 */
export async function flushMetrics(): Promise<void> {
  if (buffer.size === 0) return;
  const batch = buffer;
  buffer = new Map();
  for (const sample of batch.values()) {
    const sorted = [...sample.durations].sort((a, b) => a - b);
    const p50 = Math.round(percentile(sorted, 50));
    const p95 = Math.round(percentile(sorted, 95));
    try {
      await db.$executeRaw`
        INSERT INTO "RequestMetricHourly" AS t ("id", "hour", "routeGroup", "count", "errors5xx", "p50Ms", "p95Ms")
        VALUES (${randomUUID()}, ${utcTimestamp(sample.hour)}, ${sample.routeGroup}, ${sample.count}, ${sample.errors}, ${p50}, ${p95})
        ON CONFLICT ("hour", "routeGroup") DO UPDATE SET
          "count" = t."count" + EXCLUDED."count",
          "errors5xx" = t."errors5xx" + EXCLUDED."errors5xx",
          "p50Ms" = ROUND((t."p50Ms"::numeric * t."count" + EXCLUDED."p50Ms"::numeric * EXCLUDED."count") / (t."count" + EXCLUDED."count"))::int,
          "p95Ms" = ROUND((t."p95Ms"::numeric * t."count" + EXCLUDED."p95Ms"::numeric * EXCLUDED."count") / (t."count" + EXCLUDED."count"))::int`;
    } catch (err) {
      console.error("request metrics flush failed", err);
    }
  }
}

/** Method plus route pattern. The mount path is the requested text, so it is lowercased (Express matches case-insensitively). */
export function routeGroupOf(req: Request): string {
  const path = req.route?.path;
  if (path === undefined) return "unmatched";
  return `${req.method} ${req.baseUrl.toLowerCase()}${String(path)}`.slice(0, MAX_GROUP_LENGTH);
}

/** Times every request, finished or aborted, and buffers it once under its route pattern. Never blocks or fails a request. */
export function requestMetrics(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      if (SKIPPED_PATHS.has(req.originalUrl.split("?")[0] ?? "")) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      recordRequest(hourOf(new Date()), routeGroupOf(req), ms, res.statusCode);
    };
    res.on("finish", record);
    res.on("close", () => {
      if (!res.writableFinished) record();
    });
    next();
  };
}

/** Periodic flush for the running server. Skips a tick while the previous flush is still writing. The timer is unref'd. */
export function startMetricsFlush(intervalMs = 60_000): NodeJS.Timeout {
  let flushing = false;
  const timer = setInterval(() => {
    if (flushing) return;
    flushing = true;
    void flushMetrics().finally(() => {
      flushing = false;
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
