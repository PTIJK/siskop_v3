import { create } from "zustand";
import { ALL_UNITS } from "@/lib/unit";

interface UnitScopeState {
  /** ALL_UNITS = consolidated; otherwise one CooperativeUnit id. Only meaningful for multi-unit tenants. */
  unitId: string;
  setUnitId: (unitId: string) => void;
}

/** The topbar unit picker's choice; pages that can be cut by unit start from it. */
export const useUnitScope = create<UnitScopeState>((set) => ({
  unitId: ALL_UNITS,
  setUnitId: (unitId) => set({ unitId })
}));

/** Snapshot for places that only need a starting value (report filters keep their own state after that). */
export function currentUnitScope(): string {
  return useUnitScope.getState().unitId;
}
