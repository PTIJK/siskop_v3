import { describe, expect, it } from "vitest";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
async function run(extra: Record<string, Record<string, string | number | null>[]>, mode: "SISTEM" | "LAPORAN" = "SISTEM") {
  const read = await readWorkbook(
    await fixtureWorkbook(mode, {
      "1_Koperasi": [KOPERASI],
      "2_Unit": [UNIT],
      "4_Produk_Simpanan": [SIMPANAN_POKOK],
      "6_Produk_Pinjaman": [PINJAMAN],
      "3_Anggota": [ANGGOTA(NIK1, "Siti")],
      "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }],
      ...extra
    })
  );
  const parsed = parseRows(read);
  return { ...validateData(parsed.data!), parseIssues: parsed.issues };
}
const errors = (r: { issues: { severity: string; message: string }[] }) => r.issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("validateData", () => {
  it("passes a balanced SISTEM trial balance and totals it", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 100000 }] });
    expect(errors(r)).toEqual([]);
    expect(r.totals.trialDebit).toBe("100000");
    expect(r.totals.savingBalanceByType.POKOK).toBe("100000");
  });

  it("rejects an unbalanced trial balance", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 100000 }, { accountCode: "3-1000", credit: 90000 }] });
    expect(errors(r).join(" ")).toMatch(/tidak seimbang/);
  });

  it("rejects an unknown account code and a header account", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "9-9999", debit: 1 }, { accountCode: "1-2000", credit: 1 }] });
    expect(errors(r).filter((m) => /akun/i.test(m)).length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a duplicate NIK and a saving row for an unknown NIK", async () => {
    const r = await run({
      "3_Anggota": [ANGGOTA(NIK1, "Siti"), ANGGOTA(NIK1, "Siti Dua")],
      "5_Saldo_Simpanan": [{ nik: "1111111111111111", productCode: "SP", balance: 1 }]
    });
    expect(errors(r).join(" ")).toMatch(/NIK ganda/);
    expect(errors(r).join(" ")).toMatch(/tidak ada di 3_Anggota/);
  });

  it("masks NIK in messages (last 4 digits only)", async () => {
    const r = await run({ "5_Saldo_Simpanan": [{ nik: "1111111111119999", productCode: "SP", balance: 1 }] });
    const msg = errors(r).find((m) => /tidak ada di 3_Anggota/.test(m))!;
    expect(msg).toContain("9999");
    expect(msg).not.toContain("1111111111119999");
  });

  it("rejects a loan for a member without a POKOK saving", async () => {
    const r = await run({
      "5_Saldo_Simpanan": [],
      "7_Pinjaman": [
        {
          loanRef: "L-1",
          nik: NIK1,
          productCode: "PJ",
          principalAmount: 1000,
          totalAmount: 1100,
          remainingAmount: 500,
          remainingPrincipal: 400,
          termMonths: 3,
          disbursedAt: "2025-06-01"
        }
      ],
      "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 1 }, { accountCode: "3-1000", credit: 1 }]
    });
    expect(errors(r).join(" ")).toMatch(/simpanan pokok/i);
  });

  it("warns when saving subledger differs from the trial balance account", async () => {
    const r = await run({ "9_Saldo_Awal_Jurnal": [{ accountCode: "1-1000", debit: 50000 }, { accountCode: "3-1000", credit: 50000 }] });
    expect(r.issues.some((i) => i.severity === "warning" && /rekonsiliasi/i.test(i.message))).toBe(true);
  });

  it("LAPORAN: positive amount follows normal balance, so a KREDIT-normal contra account balances", async () => {
    const r = await run(
      {
        "9_Neraca": [
          { reportName: "Kas", accountCode: "1-1000", amount: 1000 },
          { reportName: "Piutang", accountCode: "1-1100", amount: 500 },
          { reportName: "Penyisihan", accountCode: "1-1190", amount: 100 },
          { reportName: "Simpanan Pokok", accountCode: "3-1000", amount: 1400 }
        ]
      },
      "LAPORAN"
    );
    expect(errors(r)).toEqual([]);
    expect(r.totals.trialDebit).toBe("1500");
    expect(r.totals.trialCredit).toBe("1500");
  });

  it("LAPORAN: a loan sheet with no remaining tenor is a parse error", async () => {
    const r = await run({ "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", remainingPrincipal: 1000 }], "9_Neraca": [] }, "LAPORAN");
    expect(r.parseIssues.some((i) => i.sheet === "7_Pinjaman" && i.column === "termMonths")).toBe(true);
  });
});
