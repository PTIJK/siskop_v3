import { describe, it, expect } from "vitest";
import type { SavingStatement } from "@siskop/types";
import { savingStatementCsv, savingStatementFilename } from "../src/modules/savings/statement-export.js";
import { savingStatementQuerySchema } from "../src/modules/savings/schema.js";

const STATEMENT: SavingStatement = {
  saving: { id: "s1", configName: "Simpanan Sukarela", type: "SUKARELA", member: { fullName: "Budi", memberId: "AGT/0001" } },
  period: { from: "2026-02-01", to: "2026-02-28" },
  openingBalance: "150000",
  totalDebit: "30000",
  totalCredit: "1250.5",
  closingBalance: "121250.5",
  rows: [
    {
      id: "t1",
      date: new Date(2026, 1, 5, 9).toISOString(),
      type: "WITHDRAWAL",
      note: 'Tarik "darurat", 1',
      debit: "30000",
      credit: "0",
      balance: "120000",
      createdByName: "Teller"
    },
    {
      id: "t2",
      date: new Date(2026, 1, 6, 0, 5).toISOString(),
      type: "INTEREST",
      note: "=HYPERLINK(\"x\")",
      debit: "0",
      credit: "1250.5",
      balance: "121250.5",
      createdByName: null
    }
  ]
};

describe("savingStatementCsv", () => {
  it("renders opening, rows in server-local dates, and closing totals", () => {
    const lines = savingStatementCsv(STATEMENT).trimEnd().split("\r\n");
    expect(lines).toEqual([
      "Tanggal,Jenis,Keterangan,Debit,Kredit,Saldo",
      "2026-02-01,,Saldo Awal,,,150000",
      '2026-02-05,Penarikan,"Tarik ""darurat"", 1",30000,0,120000',
      `2026-02-06,Bunga,"'=HYPERLINK(""x"")",0,1250.5,121250.5`,
      "2026-02-28,,Saldo Akhir,30000,1250.5,121250.5"
    ]);
  });

  it("builds a header-safe filename from the member number", () => {
    expect(savingStatementFilename(STATEMENT, "pdf")).toBe("rekening-koran-AGT0001-2026-02-01_2026-02-28.pdf");
  });
});

describe("savingStatementQuerySchema", () => {
  it("defaults to the current month to date", () => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const parsed = savingStatementQuerySchema.parse({});
    expect(parsed.from).toBe(`${month}-01`);
    expect(parsed.to).toBe(`${month}-${String(today.getDate()).padStart(2, "0")}`);
  });

  it("accepts a full year and rejects reversed or longer periods", () => {
    expect(savingStatementQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(savingStatementQuerySchema.safeParse({ from: "2026-03-01", to: "2026-02-01" }).success).toBe(false);
    expect(savingStatementQuerySchema.safeParse({ from: "2024-01-01", to: "2026-02-01" }).success).toBe(false);
    expect(savingStatementQuerySchema.safeParse({ from: "2026-1-1" }).success).toBe(false);
  });
});
