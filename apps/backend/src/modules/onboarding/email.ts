import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { buildRegistrationEmail, emailPayloadSchema, resendConfiguration, sendRegistrationEmail } from "./resend.js";

const detailsSchema = z.object({
  orderId: z.string(), email: z.string().email(), adminName: z.string(), tenantName: z.string(),
  packageName: z.string(), amount: z.string(), authProvider: z.string()
});

/** Called only with an order resolved by a signed cookie or verified payment callback. */
export async function deliverRegistrationEmail(orderId: string): Promise<void> {
  const config = resendConfiguration();
  if (!config) return; // Keep the queued record until Resend has been configured.
  const reservation = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "orderId" FROM "RegistrationEmail" WHERE "orderId" = ${orderId} FOR UPDATE`;
    const email = await tx.registrationEmail.findUnique({ where: { orderId }, include: { order: true } });
    if (!email || email.order.status !== "PAID" || ["SENT", "REVIEW"].includes(email.status)) return null;
    const now = new Date();
    if (email.leaseUntil && email.leaseUntil > now) throw new Error("REGISTRATION_EMAIL_BUSY");
    // Resend retains idempotency keys for 24h. An old uncertain response must
    // be checked by an operator, not retried after the deduplication window.
    if (email.firstAttemptAt && now.getTime() - email.firstAttemptAt.getTime() >= 23 * 60 * 60_000) {
      await tx.registrationEmail.update({ where: { orderId }, data: { status: "REVIEW", lastError: "RESEND_RETRY_WINDOW_EXPIRED", leaseUntil: null, leaseToken: null } });
      console.warn("Registration email requires delivery review", { orderId });
      return null;
    }
    const payload = email.payload ? emailPayloadSchema.parse(email.payload)
      : buildRegistrationEmail(detailsSchema.parse(email.details), config.from, config.loginUrl);
    const leaseToken = randomUUID();
    await tx.registrationEmail.update({ where: { orderId }, data: {
      status: "SENDING", payload, firstAttemptAt: email.firstAttemptAt ?? now,
      leaseUntil: new Date(now.getTime() + 60_000), leaseToken, attempts: { increment: 1 }, lastError: null
    } });
    return { payload, leaseToken };
  });
  if (!reservation) return;
  try {
    const resendId = await sendRegistrationEmail(reservation.payload, orderId, config.apiKey);
    await db.registrationEmail.updateMany({ where: { orderId, leaseToken: reservation.leaseToken }, data: {
      status: "SENT", resendId, sentAt: new Date(), leaseUntil: null, leaseToken: null, lastError: null
    } });
  } catch (error) {
    const code = error instanceof Error && /^RESEND_(HTTP_\d{3}|UNCONFIRMED)$/.test(error.message) ? error.message : "REGISTRATION_EMAIL_UNCONFIRMED";
    await db.registrationEmail.updateMany({ where: { orderId, leaseToken: reservation.leaseToken }, data: {
      status: "PENDING", leaseUntil: null, leaseToken: null, lastError: code
    } });
    throw new Error(code);
  }
}

/** Payment/completion responses remain usable if email delivery is delayed. */
export async function tryRegistrationEmail(orderId: string): Promise<void> {
  try { await deliverRegistrationEmail(orderId); }
  catch { console.warn("Registration confirmation pending; retry via payment webhook", { orderId }); }
}
