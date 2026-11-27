import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readExcelDraft } from "../src/modules/migration/excel-draft.js";

describe("tenant Excel draft reader", () => {
  it("keeps stacked savings balances and SHU distributions distinct", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Simpanan Anggota").addRows([
      ["No", "No Ang gota", "Nama", "Simpanan Pokok & Wajib"],
      [undefined, undefined, undefined, 2024, 2025, "Jumlah"],
      [1, 398, "Anggota Uji", 5310000, 600000, 5910000],
      ["Total", undefined, undefined, 5310000, 600000, 5910000],
      [undefined, "Anggota Uji", undefined, "Ketua", undefined, "Bendahara"]
    ]);
    workbook.addWorksheet("Modal SR TQ").addRows([
      ["No", "No Ang gota", "Nama", "Simpanan Sukarela, Modal dan Tab Qurban"],
      [undefined, undefined, undefined, "Modal", "Tabungan Sukarela", undefined, "Total", "Tabungan Qurban"],
      [undefined, undefined, undefined, "Modal", 2024, 2025, "Tabungan Sukarela", 2024, 2025, "Tabungan Qurban", "Jumlah"],
      [1, 398, "Anggota Uji", undefined, 117000, 0, 117000, 0, 0, 0, 117000]
    ]);
    workbook.addWorksheet("Pembagian SHU").addRows([
      ["No", "No Ang gota", "Nama", "SHU Pokok/SW", "SHU Sukarela", "SHU Pinjaman", "Total SHU"],
      [1, 398, "Anggota Uji", 296000, 8000, 3240000, 3544000]
    ]);
    workbook.addWorksheet("Pembiayaan").addRows([
      ["No", "No Ang gota", "Nama", "Pembiayaan 1", undefined, undefined, undefined, "Pembiayaan 2"],
      [undefined, undefined, undefined, "Jml Bulan", "Pokok", "Infaq", "Jumlah", "Jml Bulan", "Pokok", "Infaq", "Jumlah"],
      [1, 398, "Anggota Uji", 42, 3333350, 1800000, 140000700],
      ["Total", undefined, undefined, undefined, undefined, undefined, 140000700],
      [undefined, "Anggota Uji", undefined, "Ketua"]
    ]);
    const draft = await readExcelDraft(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(draft.counts).toMatchObject({ simpanan: 1, pinjaman: 1, lainnya: 1 });
    expect(draft.records.simpanan[0]?.fields).toEqual(expect.arrayContaining([
      { label: "Simpanan Pokok & Wajib · 2024", value: 5310000, kind: "money" },
      { label: "Simpanan Pokok & Wajib · 2025", value: 600000, kind: "money" },
      { label: "Total Simpanan Pokok & Wajib", value: 5910000, kind: "money" }
    ]));
    expect(draft.records.simpanan[0]?.fields).toContainEqual({ label: "Total Tabungan Sukarela", value: 117000, kind: "money" });
    expect(draft.records.lainnya[0]?.fields).toContainEqual({ label: "SHU Sukarela", value: 8000, kind: "money" });
    expect(draft.records.pinjaman[0]?.fields).toEqual(expect.arrayContaining([
      { label: "Pembiayaan 1 · Jml Bulan", value: 42, kind: "text" },
      { label: "Pembiayaan 1 · Pokok", value: 3333350, kind: "money" },
      { label: "Pembiayaan 1 · Infaq", value: 1800000, kind: "money" }
    ]));
  });

  it("keeps partial member data and captures balances, loan charges, and related financial tabs", async () => {
    const workbook = new ExcelJS.Workbook();
    const members = workbook.addWorksheet("Daftar Anggota");
    members.addRow(["Daftar anggota per akhir bulan"]);
    members.addRows([
      ["No.", "Nama Anggota", "NIK", "Alamat"],
      [1, "Anggota Uji", "1234567890123456", "Alamat Uji"],
      [2, "Anggota Belum Lengkap", 1234567890123456],
      [3, undefined, undefined, "Alamat saja"]
    ]);
    workbook.addWorksheet("Simpanan").addRows([
      ["Nama", "Pokok + Wajib", "Sukarela", "Tabungan Qurban", "Tabungan Pendidikan"],
      ["Anggota Uji", 700, 300, 20, { formula: "SUM(B2:C2)", result: 1000 }],
      ["Total", 700, 300, 20, 1000]
    ]);
    workbook.addWorksheet("Pembiayaan").addRows([
      ["Nama", "Pokok", "Infaq", "Infak", "Bunga", "Marjin", "Ujrah", "Bagi Hasil", "Jasa Pinjaman", "Tenor"],
      ["Anggota Uji", 500, 10, 11, 15, 20, 12, { formula: "1+1" }, 13, 8]
    ]);
    workbook.addWorksheet("9_Neraca").addRows([
      ["reportName", "accountCode", "amount"], ["Kas", "1-1000", 1250]
    ]);
    workbook.addWorksheet("Saldo Kas").addRows([["Rekening", "Saldo"], ["Kas kecil", 100]]);
    workbook.addWorksheet("Informasi tambahan").addRow(["Tutup buku", "Desember"]);

    const draft = await readExcelDraft(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(draft.counts).toEqual({ anggota: 3, simpanan: 1, pinjaman: 1, neraca: 1, kas: 1, lainnya: 1 });
    expect(draft.records.anggota[0]).toMatchObject({
      title: "Anggota Uji",
      fields: expect.arrayContaining([{ label: "NIK", value: "1234567890123456", kind: "nik" }])
    });
    expect(draft.records.anggota[1]).toMatchObject({ fields: [], notes: [expect.stringContaining("NIK perlu diperiksa")] });
    expect(draft.records.anggota[2]?.notes).toContain("Identitas anggota belum ditemukan.");
    expect(draft.records.simpanan[0]?.fields).toEqual(expect.arrayContaining([
      { label: "Pokok + Wajib", value: 700, kind: "money" },
      { label: "Sukarela", value: 300, kind: "money" },
      { label: "Tabungan Pendidikan", value: 1000, kind: "money" }
    ]));
    expect(draft.records.simpanan[0]?.notes[0]).toContain("hasil rumus");
    expect(draft.records.pinjaman[0]?.fields.filter(({ kind }) => kind === "money").map(({ label }) => label))
      .toEqual(["Pokok", "Infaq", "Infak", "Bunga", "Marjin", "Ujrah", "Jasa Pinjaman"]);
    expect(draft.records.pinjaman[0]?.fields).toContainEqual({ label: "Tenor", value: 8, kind: "text" });
    expect(draft.records.pinjaman[0]?.notes[0]).toContain("belum tersedia");
    expect(draft.records.neraca[0]).toMatchObject({ title: "Kas" });
    expect(draft.records.kas[0]).toMatchObject({ title: "Kas kecil" });
    expect(draft.limited).toBe(false);
  });

  it("reads a mixed sheet and keeps sheets with unclear headings available", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Laporan").addRows([
      ["Nama", "No Anggota", "Simpanan Pokok", "Sisa Pinjaman", "Bunga Pinjaman"],
      ["Anggota Uji", "0001", 100, 500, 10]
    ]);
    const unrecognized = workbook.addWorksheet("Catatan");
    for (let i = 1; i <= 26; i++) unrecognized.addRow(["Catatan " + i, i]);
    const draft = await readExcelDraft(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(draft.counts).toMatchObject({ anggota: 1, pinjaman: 1, simpanan: 1, lainnya: 26 });
    expect(draft.records.anggota[0]?.fields).toEqual([{ label: "No Anggota", value: "0001", kind: "text" }]);
    expect(draft.records.simpanan[0]?.fields.map((field) => field.label)).toEqual(["No Anggota", "Simpanan Pokok"]);
    expect(draft.records.pinjaman[0]?.fields.map((field) => field.label)).toEqual(["No Anggota", "Sisa Pinjaman", "Bunga Pinjaman"]);
    expect(draft.records.lainnya.at(-1)?.fields[0]?.value).toBe("Catatan 26");
  });

  it("rejects a corrupt workbook and a ZIP member whose expansion exceeds its declared size", async () => {
    await expect(readExcelDraft(Buffer.from("not Excel"))).rejects.toThrow("File Excel tidak dapat dibaca");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Anggota").addRow(["Nama", "Alamat"]);
    const forged = Buffer.from(await workbook.xlsx.writeBuffer());
    const eocd = forged.length - 22;
    let directory = forged.readUInt32LE(eocd + 16);
    while (forged.readUInt16LE(directory + 10) !== 8) {
      directory += 46 + forged.readUInt16LE(directory + 28) + forged.readUInt16LE(directory + 30) + forged.readUInt16LE(directory + 32);
    }
    forged.writeUInt32LE(1, directory + 24);
    await expect(readExcelDraft(forged)).rejects.toThrow("File Excel tidak dapat dibaca");
  });
});
