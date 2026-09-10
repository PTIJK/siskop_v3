import type { CooperativeType } from "@siskop/types";
import { Handshake, Landmark, Store, Truck, Wheat, type LucideIcon } from "lucide-react";

// Shared icon/label maps for CooperativeType, extracted out of
// components/ksu/UnitCard.tsx so pages/ksu/UnitLayout.tsx (the per-unit
// detail header) can reuse the exact same icon/label per type instead of
// re-declaring a parallel copy that could drift.
export const UNIT_TYPE_ICON: Record<CooperativeType, LucideIcon> = {
  KSP: Landmark,
  KONSUMEN: Store,
  PRODUSEN: Wheat,
  JASA: Handshake,
  PEMASARAN: Truck
};

export const UNIT_TYPE_LABEL: Record<CooperativeType, string> = {
  KSP: "Simpan Pinjam",
  KONSUMEN: "Konsumen",
  PRODUSEN: "Produsen",
  JASA: "Jasa",
  PEMASARAN: "Pemasaran"
};
