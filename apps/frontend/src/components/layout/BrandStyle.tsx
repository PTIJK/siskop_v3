import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WhitelabelConfig } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/stores/auth";
import { applyBrandColor } from "@/lib/brand";

/**
 * Applies the koperasi's saved brand colour as a --brand/--ring override.
 * Only roles that may read the config can load it; everyone else keeps the
 * default indigo. A colour that fails the contrast check is never applied.
 */
export function BrandStyle() {
  const { can } = usePermissions();
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const { data } = useQuery({
    queryKey: ["config", "whitelabel"],
    queryFn: () => apiFetch<WhitelabelConfig | null>("/config/whitelabel"),
    enabled: can("config", "read") && !isPlatformAdmin,
    retry: false,
    staleTime: 5 * 60_000
  });
  useEffect(() => {
    applyBrandColor(data?.primaryColor ?? null);
    return () => applyBrandColor(null);
  }, [data?.primaryColor]);
  return null;
}
