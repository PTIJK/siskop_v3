import type { ConsolidatedReport } from "@siskop/types";
import { apiFetch } from "./client";

// Unit CRUD is NOT duplicated here — it already lives inline in
// pages/config/UnitsTab.tsx (`apiFetch<CooperativeUnit[]>("/config/units")`,
// `apiPost`/`apiPut` against the same path) and pages/ksu/UnitsPage.tsx reuses
// that exact pattern directly. This file only adds the one KSU-specific
// endpoint that doesn't already exist elsewhere: the consolidated report.

export function getConsolidatedReport() {
  return apiFetch<ConsolidatedReport>("/ksu/consolidated");
}
