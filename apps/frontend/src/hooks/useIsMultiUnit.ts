import { useQuery } from "@tanstack/react-query";
import type { CooperativeUnit } from "@siskop/types";
import { isMultiUnit } from "@siskop/types";
import { apiFetch } from "@/api/client";

// Same `/config/units` fetch + `["config", "units"]` cache key as
// pages/config/UnitsTab.tsx and pages/ksu/UnitsPage.tsx — TanStack Query
// dedupes/caches this across every consumer using that key, so this hook
// adds no real extra network traffic. `select` derives the KSU boolean from
// that shared CooperativeUnit[] cache using the one canonical definition
// (packages/types/src/unit.ts#isMultiUnit — CLAUDE.md rule 2b: "KSU is not
// a type — it's `units.length > 1`. Never write `if (type === 'KSU')`"), so
// App.tsx's route gate (RequireMultiUnit) and Sidebar.tsx's nav gate read
// off the exact same source of truth and can never disagree.
//
// Thin wrapper around useQuery per CLAUDE.md server-state rule — no new
// Zustand store. Callers get the full query result: `data` is
// `boolean | undefined` (undefined while pending/on error), so check
// `isPending`/`isError` before trusting a `false` as "confirmed single-unit".
export function useIsMultiUnit() {
  return useQuery({
    queryKey: ["config", "units"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units"),
    select: isMultiUnit
  });
}
