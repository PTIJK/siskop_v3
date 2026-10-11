import { db } from "../src/lib/db.js";
import { backfillAllLoanSchedules } from "../src/modules/loans/backfill.js";

// One-off, idempotent: safe to re-run — a loan that already has a schedule
// (backfilled before, or created since koperasi pasar F2) is left alone.
try {
  const result = await backfillAllLoanSchedules();
  console.info(`Backfilled ${result.processed} loan(s), skipped ${result.skipped} already-scheduled, ${result.failed} failed.`);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
