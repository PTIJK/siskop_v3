import { config } from "dotenv";
import { afterAll, beforeAll, inject } from "vitest";
import { Server } from "node:http";
import { poolDatabase, testWorkerCount } from "./database-isolation.js";

// Integration tests truncate tables, so they must never reach the dev database.
// dotenv does not overwrite variables already present in the environment, so CI
// — which exports DATABASE_URL itself — wins, and locally `.env.test` (test DB)
// is read before `.env` (dev DB) and therefore takes precedence.
config({ path: ".env.test" });
config({ path: ".env" });

// Supertest's URL always uses 127.0.0.1, but listen(0) defaults to IPv6.
// Darwin can assign that port to a separate IPv4 server, sending requests to
// another test app. Keep auto-assigned HTTP listeners on Supertest's family.
// Explicit listener addresses and production listeners are unaffected.
const originalListen = Server.prototype.listen;
beforeAll(() => {
  Server.prototype.listen = function (this: Server, ...args: Parameters<Server["listen"]>) {
    const actual: unknown[] = [...args];
    if (actual[0] === 0 && (actual.length === 1 || typeof actual[1] === "function")) actual.splice(1, 0, "127.0.0.1");
    return Reflect.apply(originalListen, this, actual) as Server;
  } as Server["listen"];
});
afterAll(() => { Server.prototype.listen = originalListen; });

const workers = testWorkerCount();
if (workers > 1) {
  // VITEST_POOL_ID is the bounded, exclusive Tinypool slot (not the globally
  // increasing VITEST_WORKER_ID). This runs before test modules create Prisma.
  process.env.DATABASE_URL = poolDatabase(inject("siskopTestDatabases"), process.env.VITEST_POOL_ID, workers);
}
