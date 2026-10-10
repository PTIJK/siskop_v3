import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  accountLevels,
  isContraAccount,
  orderDepthFirst,
  reportContribution,
  rollUpSums,
  type TreeAccount
} from "../src/lib/account-tree.js";

const D = (n: number | string) => new Prisma.Decimal(n);

const acct = (id: string, parentId: string | null, over: Partial<TreeAccount> = {}): TreeAccount => ({
  id,
  parentId,
  category: "ASET",
  normalBalance: "DEBIT",
  ...over
});

describe("isContraAccount", () => {
  it("is any account whose normal balance opposes its category", () => {
    expect(isContraAccount("ASET", "KREDIT")).toBe(true);
    expect(isContraAccount("ASET", "DEBIT")).toBe(false);
    expect(isContraAccount("KEWAJIBAN", "DEBIT")).toBe(true);
    expect(isContraAccount("EKUITAS", "DEBIT")).toBe(true); // e.g. Prive
    expect(isContraAccount("EKUITAS", "KREDIT")).toBe(false);
    expect(isContraAccount("PENDAPATAN", "DEBIT")).toBe(true); // e.g. Retur Penjualan
    expect(isContraAccount("BEBAN", "KREDIT")).toBe(true);
    expect(isContraAccount("BEBAN", "DEBIT")).toBe(false);
  });
});

describe("reportContribution", () => {
  it("adds a normal account's balance and subtracts a contra account's", () => {
    expect(reportContribution("ASET", "DEBIT", D(1000)).toNumber()).toBe(1000);
    expect(reportContribution("ASET", "KREDIT", D(100)).toNumber()).toBe(-100);
    expect(reportContribution("EKUITAS", "DEBIT", D(40)).toNumber()).toBe(-40);
  });
});

describe("accountLevels", () => {
  it("numbers roots 1 and each child one deeper", () => {
    const accounts = [acct("root", null), acct("mid", "root"), acct("leaf", "mid"), acct("other", null)];
    const levels = accountLevels(accounts);
    expect(levels.get("root")).toBe(1);
    expect(levels.get("mid")).toBe(2);
    expect(levels.get("leaf")).toBe(3);
    expect(levels.get("other")).toBe(1);
  });

  it("does not loop forever on a parent cycle", () => {
    const levels = accountLevels([acct("a", "b"), acct("b", "a")]);
    expect(levels.get("a")).toBeGreaterThan(0);
    expect(levels.get("b")).toBeGreaterThan(0);
  });
});

describe("orderDepthFirst", () => {
  it("puts each parent before its children, siblings by code", () => {
    const accounts = [
      { ...acct("c2", "p"), code: "1-2200" },
      { ...acct("p", null), code: "1-2000" },
      { ...acct("c1", "p"), code: "1-2100" },
      { ...acct("kas", null), code: "1-1000" }
    ];
    expect(orderDepthFirst(accounts).map((a) => a.id)).toEqual(["kas", "p", "c1", "c2"]);
  });

  it("keeps accounts whose parent is missing or cyclic instead of dropping them", () => {
    const accounts = [
      { ...acct("orphan", "ghost"), code: "9-0001" },
      { ...acct("a", "b"), code: "9-0002" },
      { ...acct("b", "a"), code: "9-0003" }
    ];
    expect(orderDepthFirst(accounts).map((a) => a.id).sort()).toEqual(["a", "b", "orphan"]);
  });
});

describe("rollUpSums", () => {
  it("sums raw debit/credit of descendants into every ancestor", () => {
    const accounts = [acct("root", null), acct("mid", "root"), acct("leaf1", "mid"), acct("leaf2", "mid")];
    const sums = new Map([
      ["leaf1", { debit: D(100), credit: D(10) }],
      ["leaf2", { debit: D(50), credit: D(0) }]
    ]);
    const rolled = rollUpSums(accounts, sums);
    expect(rolled.get("mid")).toEqual({ debit: D(150), credit: D(10) });
    expect(rolled.get("root")).toEqual({ debit: D(150), credit: D(10) });
    expect(rolled.get("leaf1")).toEqual({ debit: D(100), credit: D(10) });
  });

  it("includes a header's own postings and gives untouched accounts zero", () => {
    const accounts = [acct("root", null), acct("leaf", "root"), acct("empty", "root")];
    const rolled = rollUpSums(accounts, new Map([["root", { debit: D(5), credit: D(0) }], ["leaf", { debit: D(1), credit: D(0) }]]));
    expect(rolled.get("root")).toEqual({ debit: D(6), credit: D(0) });
    expect(rolled.get("empty")).toEqual({ debit: D(0), credit: D(0) });
  });

  it("is driven by parentId, so renumbering codes cannot change totals", () => {
    // Same tree, ids stand in for arbitrary codes: totals depend only on structure.
    const a = rollUpSums([acct("9", null), acct("1", "9")], new Map([["1", { debit: D(7), credit: D(0) }]]));
    expect(a.get("9")).toEqual({ debit: D(7), credit: D(0) });
  });

  it("ignores a parent cycle instead of recursing forever", () => {
    const rolled = rollUpSums([acct("a", "b"), acct("b", "a")], new Map([["a", { debit: D(3), credit: D(0) }]]));
    expect(rolled.get("a")?.debit.toNumber()).toBe(3);
  });
});
