// KSU (multi-unit cooperative) consolidated reporting — response shape of
// GET /api/ksu/consolidated (apps/backend/src/modules/ksu/service.ts#getConsolidatedAssets).
// Unlike the ledger-derived regulatory reports in reports.ts, these amounts
// serialize as plain JSON numbers, not Decimal-backed strings — the service
// sums JournalLine debit/credit with `Number(...)` and returns a `number`
// directly, so callers must format with `formatRupiah(n)` on a number, never
// treat it as a Decimal string.

export interface ConsolidatedUnitAsset {
  unitId: string;
  unitName: string;
  assets: number;
}

export interface ConsolidatedReport {
  totalAssets: number;
  byUnit: ConsolidatedUnitAsset[];
}
