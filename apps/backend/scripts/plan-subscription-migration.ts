import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/lib/db.js";
import { planSubscriptionMigration } from "../src/lib/pricing/migration.js";

// DRY RUN ONLY. Reads tenants and prints what a migration to TenantSubscription would do.
// Usage: tsx scripts/plan-subscription-migration.ts <mapping.json> [--out plan.json]
// mapping.json: { "<legacySubscriptionPackageId>": "small", "none": "free" }
// It is the owner-approved mapping; tenants without an entry are listed as unmapped, never guessed.
const args = process.argv.slice(2);
const mappingPath = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "(DATABASE_URL not set)";
  }
}

async function main() {
  if (!mappingPath) throw new Error("Usage: plan-subscription-migration.ts <mapping.json> [--out plan.json]");
  const mapping = JSON.parse(readFileSync(resolve(mappingPath), "utf8")) as Record<string, string>;
  console.log(`DRY RUN against ${target()} - nothing will be written.`);

  const plan = await planSubscriptionMigration(db, { mapping });

  console.log(`\n${plan.rows.length} planned, ${plan.unmapped.length} unmapped, ${plan.alreadyMigrated} already migrated\n`);
  console.table(
    plan.rows.map((r) => ({
      tenant: r.tenantName,
      from: r.legacyPackageName ?? "(none)",
      to: r.targetPackageCode,
      amount: r.amountPerCycle,
      due: r.nextBillingDate?.slice(0, 10) ?? "-",
      overrides: Object.keys(r.limitOverrides).join(",") || "-",
      lost: r.featuresLost.length,
      gained: r.featuresGained.length
    }))
  );
  for (const u of plan.unmapped) console.log(`UNMAPPED: ${u.tenantName} (legacy package ${u.legacyPackageId ?? "none"})`);

  if (outPath) {
    writeFileSync(resolve(outPath), JSON.stringify(plan, null, 2));
    console.log(`\nFull plan written to ${resolve(outPath)}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
