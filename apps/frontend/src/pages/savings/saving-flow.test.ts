import { describe, expect, it } from "vitest";
import { balanceAfter, canReview, defaultAccountId, validateAmount, type AccountOption } from "./saving-flow";

const pokok: AccountOption = { id: "p", name: "Simpanan Pokok", type: "POKOK", balance: "100000" };
const wajib: AccountOption = { id: "w", name: "Simpanan Wajib", type: "WAJIB", balance: "250000" };
const sukarela: AccountOption = { id: "s", name: "Simpanan Sukarela", type: "SUKARELA", balance: "1500000" };

describe("defaultAccountId", () => {
  it("prefers sukarela for a deposit, then wajib, then pokok", () => {
    expect(defaultAccountId([pokok, wajib, sukarela], "setor")).toBe("s");
    expect(defaultAccountId([pokok, wajib], "setor")).toBe("w");
    expect(defaultAccountId([pokok], "setor")).toBe("p");
  });

  it("picks a withdrawable account with money, never pokok if there is another choice", () => {
    expect(defaultAccountId([pokok, wajib, sukarela], "tarik")).toBe("s");
    expect(defaultAccountId([pokok, wajib, { ...sukarela, balance: "0" }], "tarik")).toBe("w");
  });

  it("falls back to the first account when nothing has a balance, and to null when there are none", () => {
    expect(defaultAccountId([{ ...pokok, balance: "0" }], "tarik")).toBe("p");
    expect(defaultAccountId([], "setor")).toBeNull();
  });
});

describe("validateAmount", () => {
  it("says nothing before the user types", () => {
    expect(validateAmount("setor", "", 0)).toBeUndefined();
  });

  it("rejects zero", () => {
    expect(validateAmount("setor", "0", 0)).toBe("Nominal harus lebih dari nol.");
  });

  it("rejects a withdrawal above the balance and names the balance", () => {
    const message = validateAmount("tarik", "2000000", 1_500_000);
    expect(message).toContain("Saldo tidak cukup");
    expect(message).toContain("1.500.000");
  });

  it("allows withdrawing exactly the balance, and any deposit", () => {
    expect(validateAmount("tarik", "1500000", 1_500_000)).toBeUndefined();
    expect(validateAmount("setor", "999999999", 0)).toBeUndefined();
  });
});

describe("balanceAfter and canReview", () => {
  it("adds a deposit and subtracts a withdrawal", () => {
    expect(balanceAfter("setor", 1_000_000, "250000")).toBe(1_250_000);
    expect(balanceAfter("tarik", 1_000_000, "250000")).toBe(750_000);
  });

  it("only allows review with an account and a valid amount", () => {
    expect(canReview("setor", "50000", 0, "s")).toBe(true);
    expect(canReview("setor", "", 0, "s")).toBe(false);
    expect(canReview("setor", "50000", 0, null)).toBe(false);
    expect(canReview("tarik", "2000000", 1_500_000, "s")).toBe(false);
  });
});
