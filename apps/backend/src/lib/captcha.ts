const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

/**
 * Verifies a Cloudflare Turnstile token server-side, for the public
 * self-registration endpoint (the first unauthenticated write path in the
 * system). Fails closed on every non-success outcome — missing secret, empty
 * token, network error, non-2xx response, or an explicit `success: false` —
 * so a captcha-provider outage or misconfiguration can never be mistaken for
 * "no captcha required" and never throws into the request handler.
 *
 * Dev/CI uses Cloudflare's published always-pass/always-fail test secrets
 * (see .env.test), so this whole path is exercisable without a real account:
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export async function verifyCaptcha(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;

    const data = (await res.json()) as TurnstileResponse;
    return data.success === true;
  } catch {
    return false;
  }
}
