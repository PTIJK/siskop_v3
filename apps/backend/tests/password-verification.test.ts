import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPassword } from "../src/lib/password.js";

describe("password verification compatibility", () => {
  it("accepts existing bcryptjs hashes, including Unicode and passwords longer than 72 bytes", async () => {
    for (const password of ["ordinary-password", "kata-sandi-🔐", "a".repeat(80), "before\0after"]) {
      const hash = await bcrypt.hash(password, 4);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword("incorrect", hash)).toBe(false);
      expect(await verifyPassword(password, hash)).toBe(await bcrypt.compare(password, hash));
    }
  });

  it("rejects malformed Unicode instead of treating it as a replacement character", async () => {
    const hash = await bcrypt.hash("a\uFFFDb", 4);
    expect(await verifyPassword("a\uD800b", hash)).toBe(false);
    expect(await verifyPassword("a\uFFFDb", hash)).toBe(true);
  });

  it("does not newly accept unsupported bcrypt prefixes", async () => {
    const hash = (await bcrypt.hash("password", 4)).replace(/^\$2a\$/, "$2x$");
    await expect(verifyPassword("password", hash)).rejects.toThrow();
  });

  it("rejects the existing dummy and malformed hashes", async () => {
    for (const hash of ["$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva", "invalid"]) {
      expect(await verifyPassword("wrong", hash)).toBe(await bcrypt.compare("wrong", hash));
    }
  });
});
