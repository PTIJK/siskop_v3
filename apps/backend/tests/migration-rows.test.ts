import { describe, expect, it } from "vitest";
import { parseRows } from "../src/modules/migration/rows.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const base = {
  "1_Koperasi": [KOPERASI],
  "2_Unit": [UNIT],
  "4_Produk_Simpanan": [SIMPANAN_POKOK],
  "6_Produk_Pinjaman": [PINJAMAN]
};
async function parse(mode: "SISTEM" | "LAPORAN", rows: Record<string, Record<string, string | number | null>[]>) {
  return parseRows(await readWorkbook(await fixtureWorkbook(mode, { ...base, ...rows })));
}

describe("parseRows", () => {
  it("reports short NIK with sheet, row and column", async () => {
    const { issues } = await parse("SISTEM", { "3_Anggota": [ANGGOTA("123", "Siti")] });
    expect(issues).toContainEqual(expect.objectContaining({ sheet: "3_Anggota", row: 4, column: "nik", severity: "error" }));
  });

  it("parses SISTEM loans with Decimal money and keeps given values", async () => {
    const { data, issues } = await parse("SISTEM", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "7_Pinjaman": [
        {
          loanRef: "L-1",
          nik: "3578012345670001",
          productCode: "PJ",
          principalAmount: 10000000,
          totalAmount: 11200000,
          remainingAmount: 7466667,
          remainingPrincipal: 6666667,
          termMonths: 12,
          installmentAmount: 933333.33,
          disbursedAt: "2025-03-15"
        }
      ]
    });
    expect(issues.filter((i) => i.severity === "error" && i.sheet === "7_Pinjaman")).toEqual([]);
    const loan = data!.loans[0]!;
    expect(loan.remainingPrincipal.toString()).toBe("6666667");
    expect(loan.estimated).toBe(false);
    expect(loan.disbursedAt).toBe("2025-03-15");
  });

  it("LAPORAN loans get substitute values and an estimate flag", async () => {
    const { data } = await parse("LAPORAN", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "7_Pinjaman": [{ loanRef: "L-1", nik: "3578012345670001", productCode: "PJ", remainingPrincipal: 6000000, termMonths: 6 }]
    });
    const loan = data!.loans[0]!;
    expect(loan.remainingAmount.toString()).toBe("6000000");
    expect(loan.principalAmount.toString()).toBe("6000000");
    expect(loan.totalAmount.toString()).toBe("6000000");
    expect(loan.disbursedAt).toBe("2025-12-31");
    expect(loan.estimated).toBe(true);
    expect(loan.notes).toMatch(/^Migrasi dari laporan RAT: tenor dan tanggal cair estimasi\./);
  });

  it("rejects money with more than 2 decimals", async () => {
    const { issues } = await parse("SISTEM", {
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti")],
      "5_Saldo_Simpanan": [{ nik: "3578012345670001", productCode: "SP", balance: 100.123 }]
    });
    expect(issues).toContainEqual(expect.objectContaining({ sheet: "5_Saldo_Simpanan", column: "balance" }));
  });
});
