import { config } from "dotenv";

// Integration tests truncate tables, so they must never reach the dev database.
// dotenv does not overwrite variables already present in the environment, so CI
// — which exports DATABASE_URL itself — wins, and locally `.env.test` (test DB)
// is read before `.env` (dev DB) and therefore takes precedence.
config({ path: ".env.test" });
config({ path: ".env" });
