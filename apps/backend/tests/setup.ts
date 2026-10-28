import { config } from "dotenv";
import { inject } from "vitest";
import { poolDatabase, testWorkerCount } from "./database-isolation.js";

// Integration tests truncate tables, so they must never reach the dev database.
// dotenv does not overwrite variables already present in the environment, so CI
// — which exports DATABASE_URL itself — wins, and locally `.env.test` (test DB)
// is read before `.env` (dev DB) and therefore takes precedence.
config({ path: ".env.test" });
config({ path: ".env" });

const workers = testWorkerCount();
if (workers > 1) {
  // VITEST_POOL_ID is the bounded, exclusive Tinypool slot (not the globally
  // increasing VITEST_WORKER_ID). This runs before test modules create Prisma.
  process.env.DATABASE_URL = poolDatabase(inject("siskopTestDatabases"), process.env.VITEST_POOL_ID, workers);
}
