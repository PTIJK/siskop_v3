import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/lib/db.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";

// Usage: tsx prisma/seed-pricing.ts [path/to/pricing.seed.json]
// The same file shape is used by the owner import/export, so seed and import cannot drift.
const file = resolve(process.argv[2] ?? "../../docs/package-modules/pricing.seed.json");

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "(DATABASE_URL not set)";
  }
}

async function main() {
  console.log(`Seeding pricing catalog into ${target()} from ${file}`);
  const result = await loadPricingSeed(db, parsePricingSeed(JSON.parse(readFileSync(file, "utf8"))));
  console.log(result.skipped ? `Version ${result.version} already published; nothing written.` : `Published pricing version ${result.version}.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
