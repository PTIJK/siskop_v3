import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db } from "../../lib/db.js";

interface Sample {
  hour: Date;
  routeGroup: string;
  durations: number[];
  errors: number;
}

/** In-memory samples since the last flush, keyed `${hourIso}|${routeGroup}`. */
let buffer = new Map<string, Sample>();

/** Per key per flush window; extra samples still count but no longer feed the percentiles. */
const MAX_SAMPLES = 5_000;
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
  const key = `${hour.toISOString()}|${routeGroup}`;
  let sample = buffer.get(key);
  if (!sample) {
    sample = { hour, routeGroup, durations: [], errors: 0 };
    buffer.set(key, sample);
  }
  if (sample.durations.length < MAX_SAMPLES) sample.durations.push(durationMs);
  if (status >= 500) sample.errors += 1;
}

/** Writes and clears the buffer. A failed write drops that window rather than blocking requests. */
export async function flushMetrics(): Promise<void> {
  if (buffer.size === 0) return;
  const batch = buffer;
  buffer = new Map();
  for (const sample of batch.values()) {
    const sorted = [...sample.durations].sort((a, b) => a - b);
    const n = sorted.length;
    const p50 = Math.round(percentile(sorted, 50));
    const p95 = Math.round(percentile(sorted, 95));
    try {
      await db.$transaction(async (tx) => {
        const where = { hour_routeGroup: { hour: sample.hour, routeGroup: sample.routeGroup } };
        const existing = await tx.requestMetricHourly.findUnique({ where });
        if (!existing) {
          await tx.requestMetricHourly.create({
            data: { hour: sample.hour, routeGroup: sample.routeGroup, count: n, errors5xx: sample.errors, p50Ms: p50, p95Ms: p95 }
          });
          return;
        }
        const total = existing.count + n;
        await tx.requestMetricHourly.update({
          where,
          data: {
            count: total,
            errors5xx: existing.errors5xx + sample.errors,
            p50Ms: Math.round((existing.p50Ms * existing.count + p50 * n) / total),
            p95Ms: Math.round((existing.p95Ms * existing.count + p95 * n) / total)
          }
        });
      });
    } catch (err) {
      console.error("request metrics flush failed", err);
    }
  }
}

export function routeGroupOf(req: Request): string {
  const path = req.route?.path;
  if (path === undefined) return "unmatched";
  return `${req.method} ${req.baseUrl}${String(path)}`.slice(0, MAX_GROUP_LENGTH);
}

/** Times every request and buffers it under its route pattern. Never blocks or fails a request. */
export function requestMetrics(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (SKIPPED_PATHS.has(req.originalUrl.split("?")[0] ?? "")) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      recordRequest(hourOf(new Date()), routeGroupOf(req), ms, res.statusCode);
    });
    next();
  };
}

/** Periodic flush for the running server. The timer is unref'd so it never keeps the process alive. */
export function startMetricsFlush(intervalMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => void flushMetrics(), intervalMs);
  timer.unref();
  return timer;
}
