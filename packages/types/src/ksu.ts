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
  /** false for a closed unit that still carries assets — its history stays in the report. */
  isActive: boolean;
}

export interface ConsolidatedReport {
  /** Tenant-wide ASET total — ties to the Neraca's total Aset. */
  totalAssets: number;
  /**
   * Part of `totalAssets` on entries that belong to no single unit (a manual journal entry, a
   * member-credit repayment). `byUnit` + `unallocated` always adds back up to `totalAssets`.
   */
  unallocated: number;
  byUnit: ConsolidatedUnitAsset[];
}

// Response shape of GET /api/ksu/members/:memberId/statement
// (apps/backend/src/modules/ksu/service.ts#getMemberUnitStatement). Like
// ConsolidatedReport above, `shu` serializes as a plain JSON number (the
// service computes it with `Number(...)` and `round2`, never a Decimal
// string) — format with `formatRupiah(n)` on a number.
export interface MemberUnitShu {
  unitId: string;
  unitName: string;
  shu: number;
}

export interface MemberUnitStatement {
  memberId: string;
  units: MemberUnitShu[];
}
