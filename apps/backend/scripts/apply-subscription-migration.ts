import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/lib/db.js";
import { applySubscriptionMigration } from "../src/lib/pricing/migration.js";

// WRITES TO THE DATABASE. The one-off move of live tenants to TenantSubscription.
// Run `pricing:migration-plan` first and review it with the owner; run this against a
// staging copy before production. Safe to repeat: tenants already migrated are skipped.
//
// Usage: tsx scripts/apply-subscription-migration.ts <mapping.json> --confirm [--allow-feature-loss]
// mapping.json is the owner-approved table: { "<legacySubscriptionPackageId>": "small", "none": "free" }
const args = process.argv.slice(2);
const mappingPath = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--confirm");
const allowFeatureLoss = args.includes("--allow-feature-loss");

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "(DATABASE_URL not set)";
  }
}

async function main() {
  if (!mappingPath) throw new Error("Usage: apply-subscription-migration.ts <mapping.json> --confirm [--allow-feature-loss]");
  const mapping = JSON.parse(readFileSync(resolve(mappingPath), "utf8")) as Record<string, string>;
  console.log(`Target database: ${target()}`);
  if (!confirmed) {
    throw new Error("Refusing to write without --confirm. Review `pnpm pricing:migration-plan` first, then add --confirm.");
  }

  const result = await applySubscriptionMigration(db, { mapping, allowFeatureLoss });

  console.log(`\nCreated ${result.created}, already migrated ${result.alreadyMigrated}`);
  for (const u of result.unmapped) console.log(`UNMAPPED (not changed): ${u.tenantName}`);
  for (const s of result.skippedInactive) console.log(`INACTIVE (skipped): ${s.tenantName}`);
  for (const b of result.blockedByFeatureLoss) {
    console.log(`BLOCKED (would lose access): ${b.tenantName} -> ${b.targetPackageCode}: ${b.featuresLost.join(", ")}`);
  }
  for (const f of result.failed) console.log(`FAILED: ${f.tenantName}: ${f.reason}`);
  if (result.blockedByFeatureLoss.length > 0) console.log("\nRe-run with --allow-feature-loss only once the owner has accepted those losses.");
  if (result.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
