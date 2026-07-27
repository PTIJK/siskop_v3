export type SubscriptionTier = "starter" | "professional" | "enterprise";

export interface Tenant {
  id: string;
  name: string;
  /**
   * Hostname-safe identifier used as the login subdomain: `demo` serves
   * `demo.localhost:3000`. Distinct from `cooperativeId`, which is the
   * registry number and is not constrained to hostname characters.
   */
  slug: string;
  cooperativeId: string;
  email: string;
  phone: string;
  subscriptionTier: SubscriptionTier;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
