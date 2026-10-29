import type { BillingCycle, PricingSelection } from "./pricing";
import type { RegisterTenantRequest } from "./user";

/**
 * What the registration page sends. The package is a selection, never a price:
 * the server re-validates it against the published catalog and recomputes.
 */
export type OnboardingRegistration = Omit<RegisterTenantRequest, "adminEmail" | "password" | "slug" | "firstUnit"> & {
  subscription: PricingSelection;
  firstUnit?: RegisterTenantRequest["firstUnit"];
  idToken: string;
};

export interface FirebaseSignInRequest {
  idToken: string;
}

export interface RegistrationInvoice {
  number: string;
  subtotal: string;
  /** Null when the owner has set no VAT rate; taxAmount is then "0". */
  taxRate: string | null;
  taxAmount: string;
  total: string;
  status: "OPEN" | "PAID" | "EXPIRED" | "VOID";
  dueDate: string;
}

/** Where a new koperasi's registration stands. Free registrations are ACTIVE at once. */
export interface RegistrationStatus {
  tenantName: string;
  slug: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  packageName: string;
  billingCycle: BillingCycle;
  /** The invoice awaiting payment; null for a free registration. */
  invoice: RegistrationInvoice | null;
  /** The owner's bank-transfer text. Null until the owner has entered it. */
  paymentInstructions: string | null;
  /** Present once ACTIVE and tenant domains are enabled. */
  loginUrl?: string;
}

export type OnboardingSignInResponse =
  | { next: "awaiting_payment"; status: RegistrationStatus }
  | { next: "dashboard"; session: import("./user").LoginResponse };
