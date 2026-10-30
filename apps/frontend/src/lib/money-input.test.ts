import { describe, expect, it } from "vitest";
import { digitsToNumber, formatMoneyInput, groupThousands, MONEY_MAX_DIGITS, reformatWithCaret, toDigits } from "./money-input";

describe("money input helpers", () => {
  it("groups thousands with dots while typing", () => {
    expect(groupThousands("")).toBe("");
    expect(groupThousands("5")).toBe("5");
    expect(groupThousands("1250")).toBe("1.250");
    expect(groupThousands("1250000")).toBe("1.250.000");
    expect(groupThousands("1000000000")).toBe("1.000.000.000");
  });

  it("stores pure digits regardless of what was pasted or typed", () => {
    expect(toDigits("Rp 1.250.000")).toBe("1250000");
    expect(toDigits("1,250.50")).toBe("125050");
    expect(toDigits("abc")).toBe("");
  });

  it("drops leading zeros but keeps a lone zero", () => {
    expect(toDigits("000123")).toBe("123");
    expect(toDigits("0")).toBe("0");
    expect(toDigits("00")).toBe("0");
  });

  it("caps the amount length", () => {
    expect(toDigits("9".repeat(30))).toHaveLength(MONEY_MAX_DIGITS);
  });

  it("formats a stored value for display", () => {
    expect(formatMoneyInput("1250000")).toBe("1.250.000");
    expect(formatMoneyInput("")).toBe("");
  });

  it("converts to a number only for comparisons", () => {
    expect(digitsToNumber("1250000")).toBe(1250000);
    expect(digitsToNumber("")).toBe(0);
  });

  it("keeps the caret after the typed digit when a separator appears", () => {
    // "999" + typing "1" at the end -> raw "9991" -> "9.991"
    const r = reformatWithCaret("9991", 4);
    expect(r.display).toBe("9.991");
    expect(r.caret).toBe(5);
    expect(r.digits).toBe("9991");
  });

  it("keeps the caret in place when editing in the middle", () => {
    // "1.250.000" with a "3" typed after the first digit: raw "13.250.000", caret 2
    const r = reformatWithCaret("13.250.000", 2);
    expect(r.display).toBe("13.250.000");
    expect(r.caret).toBe(2);
  });

  it("handles deleting everything", () => {
    expect(reformatWithCaret("", 0)).toEqual({ digits: "", display: "", caret: 0 });
  });
});
