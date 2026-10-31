import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { MAX_KEYS, MAX_SAMPLES, flushMetrics, hourOf, percentile, recordRequest, requestMetrics } from "../src/modules/platform-dashboard/request-metrics.js";

beforeEach(async () => {
  await flushMetrics();
  await db.requestMetricHourly.deleteMany({});
});

describe("percentile", () => {
  it("uses nearest-rank on a sorted list", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe("hourOf", () => {
  it("truncates to the UTC hour", () => {
    expect(hourOf(new Date("2026-10-31T12:34:56Z")).toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
});

describe("flushMetrics", () => {
  it("stores count, 5xx count and percentiles per (hour, route)", async () => {
    const hour = hourOf(new Date("2026-10-31T12:00:00Z"));
    for (const ms of [10, 20, 30, 40]) recordRequest(hour, "GET /api/x", ms, 200);
    recordRequest(hour, "GET /api/x", 500, 503);

    await flushMetrics();

    const row = await db.requestMetricHourly.findFirstOrThrow({ where: { routeGroup: "GET /api/x" } });
    expect(row).toMatchObject({ count: 5, errors5xx: 1, p50Ms: 30, p95Ms: 500 });
  });

  it("merges a second flush into the same hour row", async () => {
    const hour = hourOf(new Date("2026-10-31T13:00:00Z"));
    recordRequest(hour, "GET /api/y", 100, 200);
    await flushMetrics();
    recordRequest(hour, "GET /api/y", 300, 500);
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany({ where: { routeGroup: "GET /api/y" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, errors5xx: 1, p50Ms: 200 });
  });

  it("stores the real request count past the sample cap, so error rate never exceeds 100%", async () => {
    const hour = hourOf(new Date("2026-10-31T14:00:00Z"));
    const total = MAX_SAMPLES + 1000;
    for (let i = 0; i < total; i++) recordRequest(hour, "GET /api/busy", 5, 503);

    await flushMetrics();

    const row = await db.requestMetricHourly.findFirstOrThrow({ where: { routeGroup: "GET /api/busy" } });
    expect(row).toMatchObject({ count: total, errors5xx: total, p50Ms: 5, p95Ms: 5 });
  });

  it("records new keys past the per-window cap under \"other\" in the same hour", async () => {
    const hour = hourOf(new Date("2026-10-31T15:00:00Z"));
    for (let i = 0; i < MAX_KEYS + 5; i++) recordRequest(hour, `GET /api/k${i}`, 10, 200);
    recordRequest(hour, "GET /api/k0", 10, 200);

    await flushMetrics();

    expect(await db.requestMetricHourly.count()).toBe(MAX_KEYS + 1);
    const other = await db.requestMetricHourly.findFirstOrThrow({ where: { routeGroup: "other" } });
    expect(other).toMatchObject({ count: 5, hour });
    const k0 = await db.requestMetricHourly.findFirstOrThrow({ where: { routeGroup: "GET /api/k0" } });
    expect(k0.count).toBe(2);
  });

  it("loses no sample when overlapping flushes write the same (hour, route)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hour = hourOf(new Date("2026-10-31T16:00:00Z"));
    const group = "GET /api/contended";
    const flushes: Promise<void>[] = [];
    for (let i = 0; i < 8; i++) {
      recordRequest(hour, group, i % 2 === 0 ? 100 : 300, i % 2 === 0 ? 200 : 503);
      flushes.push(flushMetrics());
    }

    await expect(Promise.all(flushes)).resolves.toBeDefined();

    const rows = await db.requestMetricHourly.findMany({ where: { hour } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 8, errors5xx: 4 });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("is a no-op with an empty buffer", async () => {
    await expect(flushMetrics()).resolves.toBeUndefined();
    expect(await db.requestMetricHourly.count()).toBe(0);
  });
});

describe("requestMetrics middleware", () => {
  it("records the route pattern, not the raw URL, and skips health checks", async () => {
    const app = express();
    const router = Router();
    router.get("/items/:id", (_req, res) => res.status(500).json({}));
    router.get("/health", (_req, res) => res.json({}));
    app.use(requestMetrics());
    app.use("/api", router);

    await request(app).get("/api/items/7");
    await request(app).get("/api/items/8");
    await request(app).get("/api/health");
    await request(app).get("/nowhere");
    await new Promise((resolve) => setImmediate(resolve));
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany({ orderBy: { routeGroup: "asc" } });
    expect(rows.map((r) => [r.routeGroup, r.count, r.errors5xx])).toEqual([
      ["GET /api/items/:id", 2, 2],
      ["unmatched", 1, 0]
    ]);
  });

  it("folds case variants of one route into a single lowercase group", async () => {
    const app = express();
    const router = Router();
    router.get("/items/:id", (_req, res) => res.json({}));
    app.use(requestMetrics());
    app.use("/api", router);

    await request(app).get("/API/items/1");
    await request(app).get("/Api/items/2");
    await request(app).get("/api/items/3");
    await new Promise((resolve) => setImmediate(resolve));
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany();
    expect(rows.map((r) => [r.routeGroup, r.count])).toEqual([["GET /api/items/:id", 3]]);
  });

  it("records a request whose connection is dropped before the response finishes, once", async () => {
    const app = express();
    app.use(requestMetrics());
    app.get("/drop", (req) => { req.socket.destroy(); });
    app.get("/ok", (_req, res) => res.json({}));

    await request(app).get("/drop").catch(() => undefined);
    await request(app).get("/ok");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushMetrics();

    const rows = await db.requestMetricHourly.findMany({ orderBy: { routeGroup: "asc" } });
    expect(rows.map((r) => [r.routeGroup, r.count])).toEqual([
      ["GET /drop", 1],
      ["GET /ok", 1]
    ]);
  });
});
