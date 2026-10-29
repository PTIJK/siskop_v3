import { useQuery } from "@tanstack/react-query";
import type { PricingLimits, TenantSubscriptionInfo } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { isFeatureLocked, quotaHint, type QuotaHint } from "@/lib/entitlements";
import { useAuth } from "@/stores/auth";

export const SUBSCRIPTION_KEY = ["config", "subscription"] as const;

/**
 * The koperasi's own subscription: package, status, features, limits, usage,
 * and the invoice to pay. Platform admins have no koperasi, so it is not fetched
 * for them. Null data means the tenant has no subscription yet.
 */
export function useSubscription() {
  const isTenantUser = useAuth((s) => s.user !== null && s.user.role !== "super_admin");
  return useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: () => apiFetch<TenantSubscriptionInfo | null>("/config/subscription"),
    enabled: isTenantUser,
    staleTime: 60_000
  });
}

export function useEntitlements() {
  const { data, isPending } = useSubscription();
  return {
    info: data ?? null,
    isLoading: isPending,
    /** True only when the server enforces and the package lacks the feature. */
    isLocked: (key: string) => isFeatureLocked(data, key),
    quota: (item: keyof PricingLimits): QuotaHint | null => quotaHint(data, item)
  };
}
