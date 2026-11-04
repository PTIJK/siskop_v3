import { describe, expect, it } from "vitest";
import {
  REFERRAL_CODE_ALPHABET,
  createUniqueReferralCode,
  generateReferralCode,
  isValidReferralCode,
  normalizeReferralCode
} from "../src/lib/referrals/code.js";

describe("generateReferralCode", () => {
  it("is NEX- plus 6 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^NEX-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    }
  });

  it("never uses look-alike characters", () => {
    for (const ch of ["0", "O", "1", "I", "L", "U"]) expect(REFERRAL_CODE_ALPHABET).not.toContain(ch);
  });

  it("draws characters from the injected random source", () => {
    expect(generateReferralCode(() => 0)).toBe("NEX-222222");
  });
});

describe("normalizeReferralCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeReferralCode("  nex-7k2qpm ")).toBe("NEX-7K2QPM");
  });

  it("adds the prefix when the user typed only the suffix", () => {
    expect(normalizeReferralCode("7k2qpm")).toBe("NEX-7K2QPM");
  });

  it("drops inner whitespace", () => {
    expect(normalizeReferralCode("NEX - 7K2 QPM")).toBe("NEX-7K2QPM");
  });
});

describe("isValidReferralCode", () => {
  it("accepts generated and vanity codes", () => {
    expect(isValidReferralCode("NEX-7K2QPM")).toBe(true);
    expect(isValidReferralCode("NEX-BUDI")).toBe(true);
    expect(isValidReferralCode("NEX-BUDI2026")).toBe(true);
  });

  it("rejects malformed codes", () => {
    expect(isValidReferralCode("NEX-AB")).toBe(false);
    expect(isValidReferralCode("NEX-ABCDEFGHIJKLM")).toBe(false);
    expect(isValidReferralCode("ABC-123456")).toBe(false);
    expect(isValidReferralCode("NEX-AB_CD")).toBe(false);
    expect(isValidReferralCode("nex-budi")).toBe(false);
  });
});

describe("createUniqueReferralCode", () => {
  it("retries until the code is free", async () => {
    const taken = new Set<string>();
    const draws = ["NEX-AAAAAA", "NEX-AAAAAA", "NEX-BBBBBB"];
    taken.add("NEX-AAAAAA");
    let i = 0;
    const code = await createUniqueReferralCode(async (c) => taken.has(c), { generate: () => draws[i++]! });
    expect(code).toBe("NEX-BBBBBB");
    expect(i).toBe(3);
  });

  it("gives up after the attempt limit", async () => {
    await expect(createUniqueReferralCode(async () => true, { maxAttempts: 3 })).rejects.toThrow(/unique referral code/);
  });
});
