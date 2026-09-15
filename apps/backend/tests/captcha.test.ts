import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCaptcha } from "../src/lib/captcha.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyCaptcha", () => {
  it("returns true when Turnstile reports success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyCaptcha("some-token", "203.0.113.5");

    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("1x0000000000000000000000000000000AA");
    expect(body.get("response")).toBe("some-token");
    expect(body.get("remoteip")).toBe("203.0.113.5");
  });

  it("returns false when Turnstile reports failure", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "2x0000000000000000000000000000000AA");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }))
    );

    expect(await verifyCaptcha("bad-token")).toBe(false);
  });

  it("fails closed when TURNSTILE_SECRET_KEY is not configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyCaptcha("some-token")).toBe(false);
  });

  it("fails closed on an empty token without calling the network", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyCaptcha("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the network call throws", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(await verifyCaptcha("some-token")).toBe(false);
  });

  it("fails closed on a non-2xx response", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    expect(await verifyCaptcha("some-token")).toBe(false);
  });
});
