import { describe, expect, it } from "vitest";
import { maskNik } from "./format";

describe("maskNik", () => {
  it("keeps the first and last four digits of a 16-digit NIK", () => {
    expect(maskNik("3174010101900012")).toBe("3174••••••••0012");
  });

  it("leaves short values alone rather than inventing masking", () => {
    expect(maskNik("1234")).toBe("1234");
  });
});
