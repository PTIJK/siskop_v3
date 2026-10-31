import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, UNIT } from "./migration-fixtures.js";

describe("readWorkbook", () => {
  it("detects SISTEM and skips # rows and blank rows", async () => {
    const buf = await fixtureWorkbook("SISTEM", {
      "1_Koperasi": [KOPERASI],
      "2_Unit": [UNIT],
      "3_Anggota": [ANGGOTA("3578012345670001", "Siti"), {}]
    });
    const r = await readWorkbook(buf);
    expect(r.mode).toBe("SISTEM");
    expect(r.sheets["3_Anggota"]).toHaveLength(1);
    expect(r.sheets["3_Anggota"]![0]).toMatchObject({ row: 4, v: { nik: "3578012345670001", fullName: "Siti" } });
  });

  it("detects LAPORAN by 9_Neraca", async () => {
    const r = await readWorkbook(await fixtureWorkbook("LAPORAN", {}));
    expect(r.mode).toBe("LAPORAN");
  });

  it("rejects a non-xlsx buffer", async () => {
    await expect(readWorkbook(Buffer.from("not a zip"))).rejects.toMatchObject({ code: "MIGRATION_FILE_INVALID" });
  });

  it("flags a numeric NIK cell (Excel loses the last digits)", async () => {
    const buf = await fixtureWorkbook("SISTEM", { "3_Anggota": [{ ...ANGGOTA("x", "Siti"), nik: 3578012345670001 }] });
    const r = await readWorkbook(buf);
    expect(r.issues.some((i) => i.sheet === "3_Anggota" && i.column === "nik" && i.severity === "error")).toBe(true);
  });

  it("flags a formula cell", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("PETUNJUK");
    const ws = wb.addWorksheet("9_Neraca");
    ws.addRow(["reportName", "accountCode", "amount", "unitCode"]);
    ws.addRow(["Kas", "1-1000", { formula: "1+1", result: 2 }, null]);
    const r = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.issues.some((i) => i.sheet === "9_Neraca" && i.message.includes("rumus"))).toBe(true);
  });

  it("reports a file with both sheet 9 variants", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("9_Neraca").addRow(["reportName"]);
    wb.addWorksheet("9_Saldo_Awal_Jurnal").addRow(["accountCode"]);
    const r = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.mode).toBeNull();
    expect(r.issues.some((i) => i.sheet === "(file)")).toBe(true);
  });
});
