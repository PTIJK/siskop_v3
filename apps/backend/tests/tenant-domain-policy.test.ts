import { describe, expect, it } from "vitest";
import { classifyHost, nextRenameAt, parseSlug, renameEligibility } from "../src/modules/tenant-domains/policy.js";

const base = "koperasi.inovasijayakarsa.id";
describe("tenant address policy", () => {
  it("accepts only a single tenant label under the configured namespace", () => {
    expect(classifyHost(`Lini-Usaha.${base}:443`, base)).toEqual({ kind: "tenant", slug: "lini-usaha" });
    expect(classifyHost(base, base)).toEqual({ kind: "central" });
    for (const host of [`a.b.${base}`, `a.${base}.evil.test`, `a.evil.test`, `a.${base}@evil.test`, `a.${base},evil.test`]) {
      expect(classifyHost(host, base).kind).toBe("invalid");
    }
    expect(classifyHost("app." + base, base).kind).toBe("reserved");
  });
  it("validates and normalizes names; reserves infrastructure and punycode names", () => {
    expect(parseSlug(" Lini-Usaha ")).toBe("lini-usaha");
    for (const slug of ["", "a".repeat(64), "-name", "name-", "a.b", "a_b", "www", "AUTH", "xn--test", "mail"]) {
      expect(() => parseSlug(slug)).toThrow();
    }
  });
  it("uses 365 elapsed days, allows the boundary, and does not reset on renewal", () => {
    const last = new Date("2024-02-29T12:00:00Z");
    expect(nextRenameAt(last)?.toISOString()).toBe("2025-02-28T12:00:00.000Z");
    const facts = { enabled: true, entitled: true, active: true, lastChangedAt: last };
    expect(renameEligibility(facts, new Date("2025-02-28T11:59:59Z"))).toBe("cooldown");
    expect(renameEligibility(facts, new Date("2025-02-28T12:00:00Z"))).toBeNull();
    expect(renameEligibility({ ...facts, lastChangedAt: null })).toBeNull();
    expect(renameEligibility({ ...facts, entitled: false })).toBe("package");
    expect(renameEligibility({ ...facts, enabled: false })).toBe("unavailable");
    expect(renameEligibility({ ...facts, active: false })).toBe("inactive");
  });
});
