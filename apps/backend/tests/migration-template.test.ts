import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTemplate, templateSheets } from "../src/modules/migration/template.js";

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe("migration template", () => {
  it("SISTEM has 9_Saldo_Awal_Jurnal and no 9_Neraca", async () => {
    const wb = await load(await buildTemplate("SISTEM"));
    expect(wb.getWorksheet("9_Saldo_Awal_Jurnal")).toBeDefined();
    expect(wb.getWorksheet("9_Neraca")).toBeUndefined();
    expect(wb.getWorksheet("8_Jadwal_Angsuran")).toBeDefined();
  });

  it("LAPORAN has 9_Neraca and no sheet 8", async () => {
    const wb = await load(await buildTemplate("LAPORAN"));
    expect(wb.getWorksheet("9_Neraca")).toBeDefined();
    expect(wb.getWorksheet("8_Jadwal_Angsuran")).toBeUndefined();
  });

  it("1_Koperasi carries cutoffDate and no package column", () => {
    const keys = templateSheets("SISTEM").find((s) => s.name === "1_Koperasi")!.cols.map((c) => c.key);
    expect(keys).toContain("cutoffDate");
    expect(keys).not.toContain("package");
  });

  it("row 1 of every data sheet holds the machine keys", async () => {
    const wb = await load(await buildTemplate("SISTEM"));
    for (const def of templateSheets("SISTEM")) {
      const header = (wb.getWorksheet(def.name)!.getRow(1).values as unknown[]).slice(1, def.cols.length + 1);
      expect(header).toEqual(def.cols.map((c) => c.key));
    }
  });
});
