import { config } from "dotenv";
import { afterAll, beforeAll, inject } from "vitest";
import type { Server } from "node:http";
import request from "supertest";
import { poolDatabase, testWorkerCount } from "./database-isolation.js";

// Integration tests truncate tables, so they must never reach the dev database.
// dotenv does not overwrite variables already present in the environment, so CI
// — which exports DATABASE_URL itself — wins, and locally `.env.test` (test DB)
// is read before `.env` (dev DB) and therefore takes precedence.
config({ path: ".env.test" });
config({ path: ".env" });

// Supertest's default URL uses IPv4 even when listen(0) allocated an IPv6 port.
// Darwin can assign that port to another IPv4 server. Match the actual family,
// keeping Supertest's synchronous listener setup and the original Host header.
const prototype = request.Test.prototype;
const originalAddress = prototype.serverAddress;
beforeAll(() => {
  prototype.serverAddress = function (server, path) {
    const url = originalAddress.call(this, server, path);
    const address = typeof server === "object" && server !== null && "address" in server ? (server as Server).address() : null;
    if (address && typeof address !== "string" && address.family === "IPv6") {
      this.set("Host", new URL(url).host);
      return url.replace("://127.0.0.1:", "://[::1]:");
    }
    return url;
  };
});
afterAll(() => { prototype.serverAddress = originalAddress; });

const workers = testWorkerCount();
if (workers > 1) {
  // VITEST_POOL_ID is the bounded, exclusive Tinypool slot (not the globally
  // increasing VITEST_WORKER_ID). This runs before test modules create Prisma.
  process.env.DATABASE_URL = poolDatabase(inject("siskopTestDatabases"), process.env.VITEST_POOL_ID, workers);
}
