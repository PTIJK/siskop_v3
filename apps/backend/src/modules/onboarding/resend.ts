import { z } from "zod";

export const emailPayloadSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string().email()).length(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.object({ name: z.string(), value: z.string() }))
});
export type EmailPayload = z.infer<typeof emailPayloadSchema>;

/** Null when Resend is not configured; throws when it is configured with values that cannot be trusted. */
export function resendConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return null;
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  const origin = new URL(process.env.PUBLIC_APP_URL ?? "");
  if (!z.string().email().safeParse(address).success || /[\r\n]/.test(from) || origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("RESEND_CONFIGURATION_INVALID");
  return { apiKey, from, loginUrl: new URL("/login", origin.origin).href };
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Sends one email through Resend. The idempotency key makes a retry within 24h a no-op. */
export async function sendResendEmail(payload: EmailPayload, idempotencyKey: string, apiKey: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new Error("RESEND_UNCONFIRMED");
  }
  if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);
  try {
    return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
  } catch {
    throw new Error("RESEND_UNCONFIRMED");
  }
}
