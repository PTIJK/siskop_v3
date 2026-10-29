import type { CooperativeType } from "@siskop/types";
import { validationError } from "../errors.js";

/**
 * Which package feature a first unit type needs. Pasar management is modelled
 * as a JASA unit (docs/2026-09-26-koperasi-pasar-dev-plan.md), so Pasar maps to it.
 * KSP needs nothing. Types absent here (Produsen, Pemasaran) have no feature in
 * the matrix, so self-registration does not offer them.
 */
const NEEDS: Partial<Record<CooperativeType, { feature: string; label: string }>> = {
  KONSUMEN: { feature: "unit_konsumen", label: "Konsumen" },
  JASA: { feature: "unit_pasar", label: "Pasar" }
};

/** Rejects a registration whose business type the chosen package does not include. */
export function assertFirstUnitAllowed(type: CooperativeType, features: readonly string[]): void {
  if (type === "KSP") return;
  const need = NEEDS[type];
  if (!need) throw validationError(`Jenis koperasi ${type} belum tersedia untuk pendaftaran mandiri`);
  if (!features.includes(need.feature)) {
    throw validationError(`Paket ini tidak mencakup unit ${need.label}. Pilih paket Medium atau lebih tinggi, atau Custom dengan unit ${need.label}.`);
  }
}
