import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { conflict, unauthorized, validationError } from "../../lib/errors.js";

export function checkoutConfigured(): boolean {
  try {
    const url = new URL(process.env.PUBLIC_APP_URL ?? "");
    return (
      !!process.env.XENDIT_SECRET_KEY &&
      !!process.env.XENDIT_WEBHOOK_TOKEN &&
      !!process.env.JWT_SECRET &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function verifyCallbackToken(token: string | undefined): void {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN;
  if (
    !expected ||
    !token ||
    Buffer.byteLength(expected) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  ) {
    throw unauthorized("Invalid webhook token");
  }
}
export const providerSessionSchema = z.object({
  payment_session_id: z.string().min(1),
  reference_id: z.string().min(1),
  session_type: z.literal("PAY"),
  currency: z.literal("IDR"),
  amount: z.number().positive(),
  status: z.enum(["ACTIVE", "COMPLETED", "EXPIRED", "CANCELED"]),
  payment_link_url: z.string().url().nullable().optional(),
  expires_at: z.string().datetime().optional()
});
export type ProviderSession = z.infer<typeof providerSessionSchema>;
export function validateProviderSession(
  value: unknown,
  expected: { id: string; providerSessionId: string | null; amount: string }
): ProviderSession {
  const data = providerSessionSchema.parse(value);
  if (
    data.reference_id !== expected.id ||
    (expected.providerSessionId && data.payment_session_id !== expected.providerSessionId) ||
    !new Prisma.Decimal(data.amount).equals(expected.amount)
  ) {
    throw validationError("Payment does not match checkout");
  }
  if (data.payment_link_url) {
    const url = new URL(data.payment_link_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        url.hostname === "xen.to" ||
        url.hostname === "dev.xen.to" ||
        url.hostname === "checkout.xendit.co" ||
        url.hostname.endsWith(".xendit.co")
      )
    ) {
      throw validationError("Invalid checkout URL");
    }
  }
  return data;
}
export class ProviderRequestError extends Error {
  constructor(readonly definitive: boolean) {
    super("Payment provider unavailable");
  }
}
async function requestSession(path: string, body?: unknown): Promise<unknown> {
  const secret = process.env.XENDIT_SECRET_KEY;
  if (!secret) throw conflict("Pembayaran belum tersedia. Silakan coba kembali nanti.");
  let response: Response;
  try {
    response = await fetch(`https://api.xendit.co${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new ProviderRequestError(false);
  }
  if (!response.ok) throw new ProviderRequestError([400, 401, 403, 404, 422, 429].includes(response.status));
  try {
    return await response.json();
  } catch {
    throw new ProviderRequestError(false);
  }
}
export async function createPaymentSession(input: {
  id: string;
  orderId: string;
  amount: string;
  packageName: string;
  name: string;
  email: string;
}): Promise<ProviderSession> {
  if (!checkoutConfigured()) throw conflict("Pembayaran belum tersedia. Silakan coba kembali nanti.");
  const returnUrl = new URL("/checkout", process.env.PUBLIC_APP_URL).href;
  const value = await requestSession("/sessions", {
    reference_id: input.id,
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    currency: "IDR",
    country: "ID",
    // Decimal until the provider's JSON-number boundary; IDR catalog values must be whole rupiah.
    amount: new Prisma.Decimal(input.amount).toNumber(),
    capture_method: "AUTOMATIC",
    locale: "id",
    allow_save_payment_method: "DISABLED",
    description: `SISKOP — ${input.packageName} — satu bulan akses`,
    customer: {
      reference_id: input.id,
      type: "INDIVIDUAL",
      email: input.email,
      individual_detail: { given_names: input.name.replace(/[^\p{L}\p{N} ]/gu, " ").trim() || "Pengelola" }
    },
    success_return_url: returnUrl,
    cancel_return_url: `${returnUrl}?canceled=1`,
    metadata: { order_id: input.orderId }
  });
  return validateProviderSession(value, { ...input, providerSessionId: null });
}
export async function getPaymentSession(id: string): Promise<unknown> {
  return requestSession(`/sessions/${encodeURIComponent(id)}`);
}
