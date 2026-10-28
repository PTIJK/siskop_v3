import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  checkoutConfigured,
  verifyCallbackToken,
  validateProviderSession,
  createPaymentSession,
  getPaymentSession
} from "../src/modules/onboarding/xendit.js";

const active = {
  payment_session_id: "ps-123",
  reference_id: "attempt1",
  session_type: "PAY",
  amount: 500000,
  currency: "IDR",
  status: "ACTIVE",
  payment_link_url: "https://xen.to/test",
  expires_at: "2026-09-11T00:00:00Z"
};
const input = {
  id: "attempt1", orderId: "order1", amount: "500000", packageName: "Lengkap",
  email: "test@example.com", name: "Budi"
};
beforeEach(() => {
  vi.stubEnv("XENDIT_MODE", "test");
  vi.stubEnv("XENDIT_SECRET_KEY", "xnd_development_test-only");
  vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "callback-test");
  vi.stubEnv("JWT_SECRET", "test-jwt");
  vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Xendit checkout boundary", () => {
  it("fails closed without provider secrets and an HTTPS return origin", () => {
    vi.stubEnv("XENDIT_SECRET_KEY", "");
    expect(checkoutConfigured()).toBe(false);
    vi.stubEnv("XENDIT_SECRET_KEY", "xnd_development_test-only");
    vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "callback-test");
    vi.stubEnv("PUBLIC_APP_URL", "http://localhost:3000");
    expect(checkoutConfigured()).toBe(false);
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    expect(checkoutConfigured()).toBe(true);
  });
  it.each([
    { mode: "test", key: "xnd_production_test-only" },
    { mode: undefined, key: "xnd_production_test-only" },
    { mode: "live", key: "xnd_development_test-only" },
    { mode: "typo", key: "xnd_development_test-only" },
    { mode: "", key: "xnd_development_test-only" },
    { mode: "test", key: "unrecognized-key" },
    { mode: "test", key: "xnd_development_" }
  ])("blocks checkout and reconciliation before any provider request for $mode / $key", async ({ mode, key }) => {
    vi.stubEnv("XENDIT_MODE", mode ?? "");
    if (mode === undefined) delete process.env.XENDIT_MODE;
    vi.stubEnv("XENDIT_SECRET_KEY", key);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(checkoutConfigured()).toBe(false);
    await expect(createPaymentSession(input)).rejects.toThrow();
    await expect(getPaymentSession("ps-123")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { mode: undefined, key: "xnd_development_test-only" },
    { mode: "test", key: "xnd_development_test-only" },
    { mode: "live", key: "xnd_production_test-only" }
  ])("uses only a matching key for $mode, independently of NODE_ENV", async ({ mode, key }) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("XENDIT_MODE", mode ?? "");
    if (mode === undefined) delete process.env.XENDIT_MODE;
    vi.stubEnv("XENDIT_SECRET_KEY", key);
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(active)));
    vi.stubGlobal("fetch", fetchMock);
    expect(checkoutConfigured()).toBe(true);
    await createPaymentSession(input);
    await getPaymentSession("ps-123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${key}:`).toString("base64")}`);
    }
  });
  it("authenticates callbacks including missing or different-length tokens", () => {
    vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "callback-test");
    expect(() => verifyCallbackToken(undefined)).toThrow();
    expect(() => verifyCallbackToken("incorrect")).toThrow();
    expect(() => verifyCallbackToken("callback-test")).not.toThrow();
  });
  it("binds amount, currency, reference, session, and payment type", () => {
    expect(() =>
      validateProviderSession(active, { id: "attempt1", providerSessionId: "ps-123", amount: "500000" })
    ).not.toThrow();
    for (const change of [
      { amount: 1 },
      { currency: "USD" },
      { reference_id: "other" },
      { payment_session_id: "other" },
      { session_type: "SAVE" }
    ]) {
      expect(() =>
        validateProviderSession(
          { ...active, ...change },
          { id: "attempt1", providerSessionId: "ps-123", amount: "500000" }
        )
      ).toThrow();
    }
  });
  it("creates a one-time hosted payment using the server amount and fixed return URL", async () => {
    vi.stubEnv("XENDIT_SECRET_KEY", "xnd_development_test-only");
    vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "callback-test");
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(active), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createPaymentSession({
      id: "attempt1",
      orderId: "order1",
      amount: "500000",
      packageName: "Lengkap",
      email: "test@example.com",
      name: "Budi"
    });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.xendit.co/sessions");
    expect(JSON.parse(request.body)).toMatchObject({
      amount: 500000,
      currency: "IDR",
      country: "ID",
      session_type: "PAY",
      success_return_url: "https://siskop.example/checkout"
    });
  });
  it("accepts documented sandbox checkout links and rejects lookalike hosts", () => {
    const expected = { id: "attempt1", providerSessionId: "ps-123", amount: "500000" };
    for (const payment_link_url of [
      "https://dev.xen.to/test",
      "https://checkout-staging.xendit.co/sessions/ps-123"
    ]) {
      expect(() => validateProviderSession({ ...active, payment_link_url }, expected)).not.toThrow();
    }
    for (const payment_link_url of [
      "http://dev.xen.to/test",
      "https://dev.xen.to.example.com/test",
      "https://checkout-staging.xendit.co.example.com/test",
      "https://dev.xen.to@example.com/test"
    ]) {
      expect(() => validateProviderSession({ ...active, payment_link_url }, expected)).toThrow();
    }
  });
});
