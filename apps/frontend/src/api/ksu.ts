import type { ConsolidatedReport, MemberUnitStatement } from "@siskop/types";
import { apiFetch } from "./client";

// Unit CRUD is NOT duplicated here — it already lives inline in
// pages/config/UnitsTab.tsx (`apiFetch<CooperativeUnit[]>("/config/units")`,
// `apiPost`/`apiPut` against the same path) and pages/ksu/UnitsPage.tsx reuses
// that exact pattern directly. This file only adds the KSU-specific
// endpoints that don't already exist elsewhere: the consolidated report and
// the per-member per-unit SHU statement.

export function getConsolidatedReport() {
  return apiFetch<ConsolidatedReport>("/ksu/consolidated");
}

export function getMemberStatement(memberId: string) {
  return apiFetch<MemberUnitStatement>(`/ksu/members/${memberId}/statement`);
}
