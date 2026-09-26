import { describe, it, expect } from "vitest";
import { moneySchema } from "../src/lib/money.js";
import { splitLoanPayment } from "../src/lib/journal.js";

describe("moneySchema", () => {
  const schema = moneySchema("Nominal", { positive: true });

  it.each([
    ["33333.33", "33333.33"],
    [1_000_000, "1000000"],
    ["  250.5 ", "250.5"]
  ] as const)("parses %j into Decimal %s", (input, expected) => {
    expect(schema.parse(input).toString()).toBe(expected);
  });

  it.each(["1.005", "-10", "abc", "12345678901234", 0.1 + 0.2])("rejects %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("rejects zero only when positive is required", () => {
    expect(schema.safeParse("0").success).toBe(false);
    expect(moneySchema("Denda").parse("0").toString()).toBe("0");
  });
});

describe("splitLoanPayment", () => {
  it("splits by the loan's interest ratio and the halves add back up to the payment", () => {
    // Interest ratio 60000 / 1060000 — a repeating fraction, so rounding is exercised.
    const { principal, interest } = splitLoanPayment("33333.33", "1000000", "1060000");
    expect(interest.toString()).toBe("1886.79");
    expect(principal.plus(interest).toString()).toBe("33333.33");
  });

  it("treats a zero-total loan as all principal", () => {
    const { principal, interest } = splitLoanPayment("100", "0", "0");
    expect(interest.toString()).toBe("0");
    expect(principal.toString()).toBe("100");
  });
});
