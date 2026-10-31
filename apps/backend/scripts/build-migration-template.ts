/**
 * Writes the two migration workbook templates to docs/migration/ (or the directory given).
 * The builder lives in src/modules/migration/template.ts so the backend can serve the same files.
 *
 * Run: pnpm --filter backend exec tsx scripts/build-migration-template.ts [outDir]
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemplate } from "../src/modules/migration/template.js";

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "migration");

for (const mode of ["SISTEM", "LAPORAN"] as const) {
  const file = path.join(dir, `SISKOP-Template-Migrasi-${mode === "SISTEM" ? "Sistem" : "Laporan"}.xlsx`);
  await writeFile(file, await buildTemplate(mode));
  console.log(`wrote ${file}`);
}
