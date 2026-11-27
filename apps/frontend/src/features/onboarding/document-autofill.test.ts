import { describe, expect, it } from "vitest";
import { readCooperativeCertificate, readRegistrationFields } from "./document-autofill";

describe("readRegistrationFields", () => {
  it("maps the certificate table and keeps its NIK separate from the legal number", () => {
    expect(readCooperativeCertificate([
      "Nomor Induk Koperasi (NIK)",
      "0000000000000",
      "NAMA KOPERASI KOPERASI CONTOH",
      "NOMOR BADAN HUKUM 123/BH/II/93",
      "ALAMAT JALAN CONTOH",
      "KECAMATAN KECAMATAN CONTOH",
      "KABUPATEN/KOTA KOTA CONTOH",
      "PROVINSI PROVINSI CONTOH"
    ].join("\n"))).toEqual({
      cooperativeNik: "0000000000000", tenantName: "KOPERASI CONTOH", registrationNo: "123/BH/II/93",
      address: "JALAN CONTOH, KECAMATAN CONTOH, KOTA CONTOH, PROVINSI CONTOH"
    });
  });
  it("reads the certificate NIK from the full photo when OCR crops the table", () => {
    expect(readCooperativeCertificate("NAMA KOPERASI KOPERASI CONTOH", "NIK – : 0000 0000 00000\r\n"))
      .toMatchObject({ tenantName: "KOPERASI CONTOH", cooperativeNik: "0000000000000" });
    expect(readCooperativeCertificate("NIK: 0000000000000000").cooperativeNik).toBeUndefined();
  });

  it("reads the decree heading without guessing an address", () => {
    expect(readRegistrationFields("cooperative", [
      "KEPUTUSAN MENTERI", "NOMOR AHU - 0000123.AH.01.26.TAHUN 2026", "TENTANG",
      "PENGESAHAN PENDIRIAN BADAN HUKUM", "KOPERASI CONTOH", "MENETAPKAN"
    ].join("\n"))).toEqual({ registrationNo: "AHU-0000123.AH.01.26.TAHUN 2026", tenantName: "KOPERASI CONTOH", address: undefined });
    expect(readRegistrationFields("cooperative", "Lampiran memuat AHU-0000123.AH.01.26").registrationNo).toBeUndefined();
  });
  it("reads the labeled KTP fields and ignores unlabeled numbers", () => {
    expect(readRegistrationFields("ktp", "NIK : 0000 0000 0000 0000\nNama : PENGURUS CONTOH\nAlamat: Contoh"))
      .toEqual({ nik: "0000000000000000", adminName: "PENGURUS CONTOH" });
    expect(readRegistrationFields("ktp", "NIK: 123\nNomor lain: 0123456789012345").nik).toBeUndefined();
    expect(readRegistrationFields("ktp", "NIK – : 0000000000000000").nik).toBe("0000000000000000");
  });

  it("reads only explicitly labeled cooperative data", () => {
    expect(readRegistrationFields("cooperative", "Nama Koperasi : Koperasi Contoh\nNo. Pengesahan: DEMO-01\nAlamat koperasi: Jalan Contoh"))
      .toEqual({ tenantName: "Koperasi Contoh", registrationNo: "DEMO-01", address: "Jalan Contoh" });
    expect(readRegistrationFields("cooperative", "Nama ketua: Contoh").tenantName).toBeUndefined();
  });

  it("reads wrapped labels and uses a valid NIK from the alternate layout", () => {
    expect(readRegistrationFields("cooperative", "Nomor SK Pengesahan:\nDEMO-02\nAlamat:")).toMatchObject({ registrationNo: "DEMO-02" });
    expect(readRegistrationFields("ktp", "NIK: 123\nNama: PENGURUS CONTOH", "NIK:\n0000000000000000"))
      .toEqual({ nik: "0000000000000000", adminName: "PENGURUS CONTOH" });
    expect(readRegistrationFields("cooperative", "Nama koperasi:\nAlamat: Jalan Contoh").tenantName).toBeUndefined();
  });
});
