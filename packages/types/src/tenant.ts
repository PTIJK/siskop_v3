export type SubscriptionTier = "starter" | "professional" | "enterprise";

export interface Tenant {
  id: string;
  name: string;
  cooperativeId: string;
  email: string;
  phone: string;
  subscriptionTier: SubscriptionTier;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
