import { describe, expect, it } from "vitest";
import { parseCents, summarizeLines, toRequestLines, type DraftLine } from "./journalForm";

const line = (accountId: string, debit = "", credit = ""): DraftLine => ({ key: accountId + debit + credit, accountId, debit, credit });

describe("parseCents", () => {
  it("reads amounts to whole sen, ignoring float noise", () => {
    expect(parseCents("100000")).toBe(10_000_000);
    expect(parseCents("0.1")).toBe(10);
    expect(parseCents("19.99")).toBe(1999);
    expect(parseCents("1.005")).toBeNull(); // more than 2 decimals is not a valid rupiah amount
  });

  it("treats blank as zero and junk or negatives as invalid", () => {
    expect(parseCents("")).toBe(0);
    expect(parseCents("  ")).toBe(0);
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("-5")).toBeNull();
  });
});

describe("summarizeLines", () => {
  it("is submittable when two or more lines balance", () => {
    const s = summarizeLines([line("a", "100"), line("b", "", "100")]);
    expect(s).toMatchObject({ totalDebit: 10_000, totalCredit: 10_000, difference: 0, canSubmit: true, error: null });
  });

  it("reports the gap when unbalanced", () => {
    const s = summarizeLines([line("a", "100"), line("b", "", "90")]);
    expect(s.difference).toBe(1_000);
    expect(s.canSubmit).toBe(false);
  });

  it("requires an account on every line and an amount on exactly one side", () => {
    expect(summarizeLines([line("a", "5"), line("", "", "5")]).canSubmit).toBe(false);
    expect(summarizeLines([line("a", "5", "5"), line("b", "", "0")]).canSubmit).toBe(false);
    expect(summarizeLines([line("a", "0"), line("b", "", "0")]).canSubmit).toBe(false);
  });

  it("needs at least two lines", () => {
    expect(summarizeLines([line("a", "5")]).canSubmit).toBe(false);
  });

  it("surfaces an invalid amount", () => {
    expect(summarizeLines([line("a", "x"), line("b", "", "5")]).error).toMatch(/jumlah/i);
  });
});

describe("toRequestLines", () => {
  it("sends only the filled side as a string", () => {
    expect(toRequestLines([line("a", "100"), line("b", "", "100")])).toEqual([
      { accountId: "a", debit: "100" },
      { accountId: "b", credit: "100" }
    ]);
  });
});
