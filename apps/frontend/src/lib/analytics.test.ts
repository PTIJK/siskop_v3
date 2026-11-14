import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "./analytics";

describe("sanitizeUrl", () => {
  it("keeps campaign and funnel params only", () => {
    expect(
      sanitizeUrl("https://siskop.example/login?select=1&tenant=t1&membership=m1&utm_source=ig&ref=ABC&package=free")
    ).toBe("https://siskop.example/login?utm_source=ig&ref=ABC&package=free");
  });
  it("drops the query and keeps the hash-free url when nothing allowed remains", () => {
    expect(sanitizeUrl("https://siskop.example/checkout?token=secret")).toBe("https://siskop.example/checkout");
  });
  it("returns non-urls untouched", () => {
    expect(sanitizeUrl("not a url")).toBe("not a url");
  });
});
