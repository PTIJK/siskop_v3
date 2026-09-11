import type { SubscriptionPackage } from "./platform";
import type { RegisterTenantRequest } from "./user";

export type PublicPackage = Pick<
  SubscriptionPackage,
  "id" | "name" | "price" | "modules" | "maxUsers" | "maxMembers" | "maxSavingConfigs" | "whitelabelEnabled"
>;
export interface PackageCatalog {
  packages: PublicPackage[];
  checkoutAvailable: boolean;
}
export type OnboardingRegistration = Omit<RegisterTenantRequest, "adminEmail" | "password" | "slug" | "firstUnit"> & {
  packageId: string;
  idToken: string;
};
/** Immutable registration details used by the confirmation email. No credentials. */
export interface RegistrationConfirmation {
  orderId: string;
  email: string;
  adminName: string;
  tenantName: string;
  packageName: string;
  amount: string;
  authProvider: string;
}
export interface FirebaseSignInRequest { idToken: string }
export type OnboardingSignInResponse =
  | { next: "checkout"; order: OnboardingStatus }
  | { next: "dashboard"; session: import("./user").LoginResponse };
export interface OnboardingCompletion { next: "login" }
export interface OnboardingStatus {
  id: string;
  status: "PENDING" | "PAID";
  tenantName: string;
  slug: string;
  packageName: string;
  amount: string;
  paidAt: string | null;
  checkout: null | {
    status: "CREATING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED" | "FAILED";
    url: string | null;
    expiresAt: string | null;
  };
}
