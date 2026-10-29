import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEED_PATH = resolve(__dirname, "../../../docs/package-modules/pricing.seed.json");

/**
 * The real seed file, parsed. The shipped seed has PPN at 11%, which would
 * change every total in tests that are about package prices, so by default the
 * rate is cleared here; the seed's own tests read the file untouched and cover
 * the VAT default.
 */
export function seedJson({ withVat = false }: { withVat?: boolean } = {}) {
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  if (!withVat) seed.settings.taxRate = null;
  return seed;
}
