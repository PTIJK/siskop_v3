import type { BillingCycle } from "./pricing.js";

export type InvoiceType = "REGISTRATION" | "RENEWAL" | "ADDON" | "SUPPORT";
export type InvoiceStatus = "OPEN" | "PAID" | "EXPIRED" | "VOID";
export type PaymentMethod = "BANK_TRANSFER" | "CASH" | "OTHER";

/** One row of the platform owner's invoice list. Money is a decimal string. */
export interface PlatformInvoice {
  id: string;
  number: string;
  type: InvoiceType;
  status: InvoiceStatus;
  tenant: { id: string; name: string; slug: string };
  packageName: string;
  billingCycle: BillingCycle;
  subtotal: string;
  /** Fraction (0.1100), or null when no VAT applied. */
  taxRate: string | null;
  taxAmount: string;
  total: string;
  dueDate: string;
  createdAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
}

export interface PlatformInvoicePayment {
  id: string;
  method: string;
  /** The bank or gateway reference the owner typed in. */
  reference: string | null;
  amount: string;
  paidAt: string;
}

export interface PlatformInvoiceDetail extends PlatformInvoice {
  payments: PlatformInvoicePayment[];
  /** The owner's published bank-transfer text, so the invoice can be explained to the koperasi. */
  paymentInstructions: string | null;
}

export interface PlatformInvoiceList {
  items: PlatformInvoice[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformInvoiceQuery {
  status?: InvoiceStatus;
  tenantId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface MarkInvoicePaidInput {
  /** Defaults to BANK_TRANSFER. */
  method?: PaymentMethod;
  reference?: string;
  /** When the money arrived (ISO). Defaults to now; cannot be in the future. */
  paidAt?: string;
}

export interface MarkInvoicePaidResult {
  invoice: PlatformInvoiceDetail;
  /** True when the invoice was already paid: nothing was recorded this time. */
  alreadyPaid: boolean;
}
