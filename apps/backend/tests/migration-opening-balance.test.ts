import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { openingLines } from "../src/modules/migration/opening-balance.js";

const m = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, new Prisma.Decimal(v)]));

describe("openingLines", () => {
  it("posts only the difference between target and auto journals", () => {
    // target: Kas 1000 debit, Simpanan 1000 credit. Auto already did Kas +300 debit, Simpanan 300 credit.
    const lines = openingLines(m({ kas: "1000", simp: "-1000" }), m({ kas: "300", simp: "-300" }));
    expect(lines).toEqual([
      { key: "kas", debit: new Prisma.Decimal(700), credit: new Prisma.Decimal(0) },
      { key: "simp", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(700) }
    ]);
  });

  it("reverses an auto balance the target does not mention", () => {
    const lines = openingLines(m({ bank: "50", simp: "-50" }), m({ kas: "100", simp: "-100" }));
    expect(lines).toContainEqual({ key: "kas", debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100) });
  });

  it("returns nothing when target equals auto", () => {
    expect(openingLines(m({ kas: "5", simp: "-5" }), m({ kas: "5", simp: "-5" }))).toEqual([]);
  });

  it("throws when the result would not balance", () => {
    expect(() => openingLines(m({ kas: "10" }), m({}))).toThrow(/tidak seimbang/);
  });
});
