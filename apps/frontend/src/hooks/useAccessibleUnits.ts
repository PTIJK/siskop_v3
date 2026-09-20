import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { CooperativeUnit } from "@siskop/types";
import { apiFetch } from "@/api/client";

export const ACCESSIBLE_UNITS_KEY = ["units", "mine"] as const;

// "Which units may I open?" — GET /config/units/mine, answered from the caller's own unit
// assignment, so it works for a role with no config.read. The Toko screens used to read
// /config/units instead, which answers 403 for a Kasir (Toko-only, `config: {}`) and left
// them on "Unit usaha tidak ditemukan" with no way into their own store.
//
// Deliberately its own query key, NOT ["config", "units"]: Sidebar's useIsMultiUnit() shares
// that key and, for a Kasir, its /config/units request fails with 403 — an observer on the same
// key would inherit that error. useIsMultiUnit itself stays on the tenant-wide list on purpose
// (its `units.length > 1` is about the tenant, not about what this caller may open).
export function useAccessibleUnits() {
  return useQuery({
    queryKey: ACCESSIBLE_UNITS_KEY,
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units/mine")
  });
}

/** The unit list lives under two keys (the admin's full list and this per-caller one); after any create/edit refresh both. */
export function invalidateUnitQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["config", "units"] }),
    queryClient.invalidateQueries({ queryKey: ACCESSIBLE_UNITS_KEY })
  ]);
}
