import { OAuth2Client } from "google-auth-library";
import { unauthorized } from "../lib/errors.js";

const verifier = new OAuth2Client();
const schedulerEmail = "siskop-scheduler-invoker@siskop-d0f8c.iam.gserviceaccount.com";

/** Cloud Run IAM handles this on Google; an external receiver must verify it. */
export async function verifySchedulerIdentity(authorization: string | undefined, readinessOnly = false): Promise<void> {
  if (process.env.SISKOP_HOSTING !== "contabo") return;
  try {
    const audience = process.env.SCHEDULER_OIDC_AUDIENCE;
    if (!audience || !authorization?.startsWith("Bearer ")) throw new Error("Missing scheduler identity");
    const ticket = await verifier.verifyIdToken({ idToken: authorization.slice(7), audience });
    const payload = ticket.getPayload();
    const allowedEmail = payload?.email === schedulerEmail || (readinessOnly && payload?.email === "siskop-cloud-build@siskop-d0f8c.iam.gserviceaccount.com");
    if (!payload || !allowedEmail || payload.email_verified !== true ||
        !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss) || !payload.sub) {
      throw new Error("Unexpected scheduler identity");
    }
  } catch {
    throw unauthorized("Invalid scheduler identity");
  }
}
