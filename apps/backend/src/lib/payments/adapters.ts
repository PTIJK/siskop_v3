/**
 * Payment providers sit behind this interface so a gateway can be connected
 * later without touching invoices, confirmPayment or the routes. Only `manual`
 * (the owner confirms a bank transfer by hand) works today; `gdc` is a stub.
 */

export interface CheckoutInvoice {
  id: string;
  number: string;
  /** Decimal string. */
  total: string;
}

export interface Checkout {
  kind: "MANUAL" | "REDIRECT";
  /** Where to send the payer, when the provider hosts the payment page. */
  paymentUrl: string | null;
  /** The provider's own reference for this checkout, stored on Invoice.gatewayRef. */
  gatewayRef: string | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** The body exactly as received: signatures are computed over these bytes. */
  rawBody: string;
}

export interface VerifiedPaymentEvent {
  /** Unique per provider; stored in WebhookEvent to drop replays. */
  eventId: string;
  invoiceId: string;
  gatewayTxnId: string;
  /** Decimal string. */
  amount: string;
  paidAt: Date;
}

export interface ProviderPayment {
  gatewayTxnId: string;
  status: "PENDING" | "PAID" | "FAILED";
  amount: string;
}

export interface PaymentAdapter {
  readonly id: string;
  createCheckout(invoice: CheckoutInvoice): Promise<Checkout>;
  /** Returns the event only if the signature checks out; throws otherwise. */
  verifyWebhook(request: WebhookRequest): Promise<VerifiedPaymentEvent>;
  getPayment(ref: string): Promise<ProviderPayment | null>;
}

export class PaymentGatewayNotConnectedError extends Error {
  constructor(readonly provider: string) {
    super(`Payment gateway "${provider}" is not connected`);
    this.name = "PaymentGatewayNotConnectedError";
  }
}

/** Bank transfer confirmed by the platform owner: nothing to redirect to, nothing to verify. */
const manualAdapter: PaymentAdapter = {
  id: "manual",
  createCheckout: async () => ({ kind: "MANUAL", paymentUrl: null, gatewayRef: null }),
  verifyWebhook: async () => {
    throw new PaymentGatewayNotConnectedError("manual");
  },
  getPayment: async () => null
};

/** Placeholder for the GDC gateway. Replace the three methods once its API docs and sandbox keys exist. */
const gdcAdapter: PaymentAdapter = {
  id: "gdc",
  createCheckout: async () => {
    throw new PaymentGatewayNotConnectedError("gdc");
  },
  verifyWebhook: async () => {
    throw new PaymentGatewayNotConnectedError("gdc");
  },
  getPayment: async () => {
    throw new PaymentGatewayNotConnectedError("gdc");
  }
};

const ADAPTERS: Record<string, PaymentAdapter> = { manual: manualAdapter, gdc: gdcAdapter };

export function getAdapter(provider: string): PaymentAdapter | undefined {
  return Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider] : undefined;
}
