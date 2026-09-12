import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRegistrationEmail, resendConfiguration, sendRegistrationEmail } from "../src/modules/onboarding/resend.js";

const confirmation = {
  orderId: "order-test", email: "admin@example.test", adminName: '<Admin & "Owner">',
  tenantName: "Koperasi <script>alert(1)</script>", packageName: "Lengkap", amount: "500000.00", authProvider: "google.com"
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("registration email provider", () => {
  it("requires server credentials and an HTTPS application origin", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(resendConfiguration()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@example.test>");
    vi.stubEnv("PUBLIC_APP_URL", "http://attacker.example");
    expect(() => resendConfiguration()).toThrow();
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    expect(resendConfiguration()?.loginUrl).toBe("https://siskop.example/login");
  });
  it("escapes customer values and includes a login link, payment reference and exact IDR amount", () => {
    const body = buildRegistrationEmail(confirmation, "SISKOP <noreply@example.test>", "https://siskop.example/login");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&lt;Admin &amp; &quot;Owner&quot;&gt;");
    expect(body.text).toContain("Rp 500.000");
    expect(body.text).toContain("Google");
    expect(body.text).toContain("order-test");
    expect(body.html).toContain('href="https://siskop.example/login"');
    const password = buildRegistrationEmail({ ...confirmation, authProvider: "password" }, "noreply@example.test", "https://siskop.example/login");
    expect(password.text).toContain("email dan kata sandi");
  });
  it("uses a stable order idempotency key and validates the provider acknowledgement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-123" })));
    vi.stubGlobal("fetch", fetchMock);
    const body = buildRegistrationEmail(confirmation, "noreply@example.test", "https://siskop.example/login");
    expect(await sendRegistrationEmail(body, "order-test", "re_test")).toBe("email-123");
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer re_test", "Idempotency-Key": "registration-complete/order-test" })
    }));
  });
  it.each([403, 429, 503])("reports HTTP %s without exposing the provider response or credentials", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider details", { status })));
    const body = buildRegistrationEmail(confirmation, "noreply@example.test", "https://siskop.example/login");
    await expect(sendRegistrationEmail(body, "order-test", "re_test")).rejects.toThrow(`RESEND_HTTP_${status}`);
  });
  it("does not treat an invalid or timed-out acknowledgement as sent", async () => {
    const body = buildRegistrationEmail(confirmation, "noreply@example.test", "https://siskop.example/login");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}')));
    await expect(sendRegistrationEmail(body, "order-test", "re_test")).rejects.toThrow("RESEND_UNCONFIRMED");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request includes a private token")));
    await expect(sendRegistrationEmail(body, "order-test", "re_test")).rejects.toThrow("RESEND_UNCONFIRMED");
  });
});
