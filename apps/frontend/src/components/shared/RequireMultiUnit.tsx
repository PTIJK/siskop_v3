import { Navigate } from "react-router-dom";
import { useIsMultiUnit } from "@/hooks/useIsMultiUnit";
import { PageLoading } from "./LoadingSpinner";

/**
 * Gates a KSU-only route (Unit Usaha, Laporan Konsolidasi, per-member SHU
 * statement) on the tenant having 2+ active CooperativeUnits, via the same
 * useIsMultiUnit() hook Sidebar.tsx uses for its nav items — so nav and
 * routes can never disagree (CLAUDE.md rule 2b: KSU is `units.length > 1`,
 * never a type).
 *
 * Renders nothing but a loading state while the underlying /config/units
 * query is still pending, so a single-unit tenant is never flash-redirected
 * before the query has even resolved. Once resolved false (or on error —
 * fail closed rather than exposing KSU pages we couldn't confirm are safe
 * to show), redirects to /dashboard rather than rendering the page or
 * 404ing, mirroring how AppLayout already redirects a platform admin out of
 * routes outside their scope.
 */
export function RequireMultiUnit({ children }: { children: React.ReactNode }) {
  const { data: multiUnit, isPending } = useIsMultiUnit();

  if (isPending) return <PageLoading />;
  if (!multiUnit) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
