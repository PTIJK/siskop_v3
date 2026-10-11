import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";

/**
 * Gates `/kolektor` to a role with the `collections` permission (koperasi
 * pasar F4/F6) — a deliberate, narrow exception to Fase 1's otherwise
 * uniform "every logged-in mobile session sees the same tabs" scope
 * (BottomNav.tsx), documented in docs/06-PRD-SISKOP-Mobile-Version.md's
 * "Kolektor write exception" section. Every other mobile route stays
 * unguarded, matching that Fase 1 decision.
 */
export function RequireCollectionsAccess({ children }: { children: ReactNode }) {
  const canCollect = useAuth((s) => !!s.user?.permissions.collections?.read);
  if (!canCollect) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
