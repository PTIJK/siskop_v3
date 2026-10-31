/**
 * Builds the two migration workbook templates an admin fills in before a koperasi
 * is loaded into SISKOP: one from old-system data, one from reports (neraca, RAT)
 * — docs/migration/SISKOP-Template-Migrasi-{Sistem,Laporan}.xlsx. Companion
 * doc: docs/migration/MIGRATION-FIELD-MAPPING.md — keep both in step.
 *
 * Offline: touches no database. The only system data embedded is the standard
 * COA (src/lib/coaTemplate.ts), so the Referensi sheet always matches what a new
 * tenant is provisioned with.
 *
 * Served to platform admins by GET /api/platform/migration/templates/:mode, and
 * written to docs/migration/ by scripts/build-migration-template.ts.
 */
import ExcelJS from "exceljs";
import type { MigrationMode } from "@siskop/types";
import { COA_TEMPLATE } from "../../lib/coaTemplate.js";

/**
 * SISTEM  = koperasi punya data per transaksi/per pinjaman dari sistem lama.
 * LAPORAN = koperasi hanya punya laporan (neraca, lampiran RAT): saldo agregat.
 */
export type Mode = MigrationMode;

const VERSION = "1.1";
const NAVY = "FF1F3A5F";
const GREY = "FF6B7280";
const AMBER = "FFFEF3C7";
const BLUE = "FFE0ECFF";

export type Col = {
  key: string;
  label: string;
  required: boolean;
  width: number;
  hint: string;
  example: string | number | boolean;
  /** Excel number format; "@" forces text (NIK, kode, dates with leading zeros). */
  fmt?: string;
  /** Name of a Referensi list to attach as a dropdown. */
  list?: string;
};

export type SheetDef = { name: string; title: string; purpose: string; required: boolean; cols: Col[]; extraNote?: string };

const LISTS: Record<string, string[]> = {
  JenisKoperasi: ["SYARIAH", "KONVENSIONAL"],
  TipeUnit: ["KSP", "KONSUMEN", "PRODUSEN", "JASA", "PEMASARAN"],
  TipeSimpanan: ["POKOK", "WAJIB", "SUKARELA"],
  JenisImbalan: ["BUNGA", "BAGI_HASIL", "MARGIN", "HARIAN"],
  JenisImbalanSimpanan: ["BUNGA", "BAGI_HASIL", "MARGIN"],
  PeriodeSimpanan: ["DAILY", "MONTHLY", "YEARLY"],
  FrekuensiAngsuran: ["MONTHLY", "WEEKLY", "DAILY"],
  StatusPinjaman: ["ACTIVE", "COMPLETED", "DEFAULTED"],
  KOL: ["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"],
  YaTidak: ["YA", "TIDAK"],
  TipeJurnal: ["UMUM", "PENYESUAIAN"]
};

const SHEETS: SheetDef[] = [
  {
    name: "1_Koperasi",
    title: "Data Koperasi",
    purpose: "Identitas koperasi dan akun admin pertama. Hanya 1 baris data.",
    required: true,
    cols: [
      { key: "name", label: "Nama Koperasi", required: true, width: 38, hint: "Nama resmi sesuai akta", example: "Koperasi Simpan Pinjam Contoh Makmur" },
      { key: "slug", label: "Subdomain (slug)", required: true, width: 22, hint: "Huruf kecil, angka, tanda minus. Jadi alamat login: slug.siskop...", example: "contoh-makmur", fmt: "@" },
      { key: "registrationNo", label: "No. Badan Hukum", required: true, width: 26, hint: "Harus unik se-platform", example: "AHU-0012345.AH.01.29", fmt: "@" },
      { key: "address", label: "Alamat", required: true, width: 44, hint: "Alamat lengkap kantor", example: "Jl. Raya Contoh No. 10, Surabaya, Jawa Timur" },
      { key: "type", label: "Jenis (Syariah/Konvensional)", required: true, width: 26, hint: "Pilih dari daftar", example: "KONVENSIONAL", list: "JenisKoperasi" },
      { key: "cooperativeType", label: "Tipe Koperasi", required: true, width: 18, hint: "Default KSP", example: "KSP", fmt: "@" },
      { key: "modalDisetor", label: "Modal Disetor (Rp)", required: false, width: 20, hint: "Dasar batas pinjaman pengurus/pengawas 10%. Kosongkan jika belum ada", example: 50000000, fmt: "#,##0" },
      { key: "cutoffDate", label: "Tanggal Cut-off", required: true, width: 18, hint: "YYYY-MM-DD. Tanggal semua saldo yang dimigrasi. Sebaiknya akhir tahun buku", example: "2025-12-31", fmt: "@" },
      { key: "adminName", label: "Nama Admin", required: true, width: 26, hint: "Admin pertama (role Super Admin)", example: "Budi Santoso" },
      { key: "adminEmail", label: "Email Admin", required: true, width: 30, hint: "Dipakai login. Kata sandi diatur platform owner saat migrasi, JANGAN ditulis di file ini", example: "budi@contoh-makmur.id", fmt: "@" }
    ]
  },
  {
    name: "2_Unit",
    title: "Unit Usaha",
    purpose: "Minimal 1 unit. Unit pertama = unit default; semua anggota, simpanan, dan pinjaman masuk ke unit ini kecuali kolom Unit diisi.",
    required: true,
    cols: [
      { key: "unitCode", label: "Kode Unit", required: true, width: 14, hint: "Kode pendek buatan Anda untuk dirujuk sheet lain (U1, U2...)", example: "U1", fmt: "@" },
      { key: "type", label: "Tipe Unit", required: true, width: 16, hint: "Pilih dari daftar", example: "KSP", list: "TipeUnit" },
      { key: "name", label: "Nama Unit", required: true, width: 36, hint: "Nama unit usaha", example: "Simpan Pinjam" }
    ]
  },
  {
    name: "3_Anggota",
    title: "Anggota",
    purpose: "Satu baris per anggota. NIK adalah kunci penghubung ke sheet Simpanan dan Pinjaman.",
    required: true,
    cols: [
      { key: "legacyNo", label: "No. Anggota Lama", required: false, width: 18, hint: "Nomor di sistem lama, hanya untuk jejak audit. Tidak dipakai sistem", example: "A-0001", fmt: "@" },
      { key: "fullName", label: "Nama Lengkap", required: true, width: 30, hint: "Min. 2 karakter", example: "Siti Aminah" },
      { key: "nik", label: "NIK", required: true, width: 20, hint: "16 digit angka, format TEKS. Harus unik", example: "3578012345670001", fmt: "@" },
      { key: "address", label: "Alamat", required: true, width: 40, hint: "Min. 10 karakter", example: "Jl. Melati No. 5, Surabaya" },
      { key: "birthPlace", label: "Tempat Lahir", required: true, width: 18, hint: "Min. 2 karakter", example: "Surabaya" },
      { key: "birthDate", label: "Tanggal Lahir", required: true, width: 16, hint: "YYYY-MM-DD", example: "1985-03-21", fmt: "@" },
      { key: "occupation", label: "Pekerjaan", required: true, width: 20, hint: "Min. 2 karakter", example: "Guru" },
      { key: "isPengurus", label: "Pengurus?", required: false, width: 12, hint: "YA/TIDAK. Default TIDAK", example: "TIDAK", list: "YaTidak" },
      { key: "isPengawas", label: "Pengawas?", required: false, width: 12, hint: "YA/TIDAK. Default TIDAK", example: "TIDAK", list: "YaTidak" },
      { key: "commodity", label: "Komoditas (khusus pasar)", required: false, width: 22, hint: "Hanya koperasi pasar, mis. Sayur", example: "" },
      { key: "isActive", label: "Aktif?", required: false, width: 10, hint: "YA/TIDAK. Default YA", example: "YA", list: "YaTidak" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = unit pertama", example: "", fmt: "@" }
    ]
  },
  {
    name: "4_Produk_Simpanan",
    title: "Produk Simpanan",
    purpose: "Jenis simpanan koperasi (Pokok, Wajib, Sukarela, dst). Satu baris per produk.",
    required: true,
    cols: [
      { key: "code", label: "Kode Produk", required: true, width: 14, hint: "Kode buatan Anda, dirujuk sheet 5", example: "SP", fmt: "@" },
      { key: "name", label: "Nama Produk", required: true, width: 26, hint: "Min. 2 karakter", example: "Simpanan Pokok" },
      { key: "type", label: "Tipe", required: true, width: 14, hint: "POKOK / WAJIB / SUKARELA", example: "POKOK", list: "TipeSimpanan" },
      { key: "rateType", label: "Jenis Imbal", required: true, width: 16, hint: "BUNGA / BAGI_HASIL / MARGIN", example: "BUNGA", list: "JenisImbalanSimpanan" },
      { key: "rate", label: "Tarif (%)", required: true, width: 12, hint: "0 - 100. Isi 0 jika tanpa imbal", example: 0, fmt: "0.0000" },
      { key: "periodUnit", label: "Periode Imbal", required: true, width: 16, hint: "DAILY / MONTHLY / YEARLY", example: "YEARLY", list: "PeriodeSimpanan" }
    ]
  },
  {
    name: "5_Saldo_Simpanan",
    title: "Saldo Simpanan Anggota",
    purpose: "Saldo per anggota per produk pada tanggal cut-off. Satu baris per rekening simpanan.",
    required: true,
    cols: [
      { key: "nik", label: "NIK Anggota", required: true, width: 20, hint: "Harus ada di sheet 3_Anggota", example: "3578012345670001", fmt: "@" },
      { key: "productCode", label: "Kode Produk", required: true, width: 14, hint: "Harus ada di sheet 4", example: "SP", fmt: "@" },
      { key: "balance", label: "Saldo (Rp)", required: true, width: 18, hint: "Maks. 2 desimal, tidak negatif", example: 100000, fmt: "#,##0.00" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = unit pertama", example: "", fmt: "@" }
    ],
    extraNote: "Tanggal cut-off diisi sekali di sheet PETUNJUK (sel Tanggal Cut-off), bukan per baris."
  },
  {
    name: "6_Produk_Pinjaman",
    title: "Produk Pinjaman",
    purpose: "Jenis pinjaman/pembiayaan koperasi. Satu baris per produk.",
    required: true,
    cols: [
      { key: "code", label: "Kode Produk", required: true, width: 14, hint: "Kode buatan Anda, dirujuk sheet 7", example: "PJ", fmt: "@" },
      { key: "name", label: "Nama Produk", required: true, width: 26, hint: "Min. 2 karakter", example: "Pinjaman Reguler" },
      { key: "type", label: "Jenis", required: true, width: 16, hint: "SYARIAH / KONVENSIONAL", example: "KONVENSIONAL", list: "JenisKoperasi" },
      { key: "rateType", label: "Jenis Imbal", required: true, width: 16, hint: "BUNGA / BAGI_HASIL / MARGIN / HARIAN", example: "BUNGA", list: "JenisImbalan" },
      { key: "rate", label: "Tarif (%/tahun)", required: true, width: 14, hint: "0 - 100", example: 12, fmt: "0.0000" },
      { key: "maxTermMonths", label: "Tenor Maks. (bulan)", required: true, width: 18, hint: "1 - 360", example: 36, fmt: "0" },
      { key: "installmentFrequency", label: "Frekuensi Angsuran", required: true, width: 18, hint: "MONTHLY / WEEKLY / DAILY", example: "MONTHLY", list: "FrekuensiAngsuran" },
      { key: "maxInstallments", label: "Maks. Jumlah Angsuran", required: false, width: 20, hint: "Hanya DAILY/WEEKLY", example: "", fmt: "0" }
    ]
  },
  {
    name: "7_Pinjaman",
    title: "Pinjaman Berjalan",
    purpose: "Satu baris per pinjaman yang masih punya sisa kewajiban (atau perlu dicatat riwayatnya). Nilai diambil APA ADANYA dari sistem lama, tidak dihitung ulang.",
    required: true,
    cols: [
      { key: "loanRef", label: "Kode Pinjaman", required: true, width: 16, hint: "Kode buatan Anda, unik, dirujuk sheet 8", example: "L-001", fmt: "@" },
      { key: "nik", label: "NIK Anggota", required: true, width: 20, hint: "Harus ada di sheet 3_Anggota", example: "3578012345670001", fmt: "@" },
      { key: "productCode", label: "Kode Produk", required: true, width: 14, hint: "Harus ada di sheet 6", example: "PJ", fmt: "@" },
      { key: "principalAmount", label: "Pokok Awal (Rp)", required: true, width: 18, hint: "Plafon saat dicairkan", example: 10000000, fmt: "#,##0.00" },
      { key: "totalAmount", label: "Total Kewajiban Awal (Rp)", required: true, width: 22, hint: "Pokok + seluruh imbal sejak awal", example: 11200000, fmt: "#,##0.00" },
      { key: "remainingAmount", label: "Sisa Kewajiban (Rp)", required: true, width: 20, hint: "Sisa pokok + imbal yang harus dibayar per cut-off. 0 jika lunas", example: 7466667, fmt: "#,##0.00" },
      { key: "remainingPrincipal", label: "Sisa Pokok (Rp)", required: true, width: 18, hint: "Bagian pokok dari sisa kewajiban. Ini yang jadi saldo Piutang Pinjaman di buku besar", example: 6666667, fmt: "#,##0.00" },
      { key: "termMonths", label: "Tenor (bulan)", required: true, width: 14, hint: "Jumlah bulan awal", example: 12, fmt: "0" },
      { key: "installmentAmount", label: "Angsuran per Periode (Rp)", required: true, width: 22, hint: "Besar angsuran tetap", example: 933333.33, fmt: "#,##0.00" },
      { key: "disbursedAt", label: "Tanggal Cair", required: true, width: 16, hint: "YYYY-MM-DD", example: "2026-03-15", fmt: "@" },
      { key: "installmentFrequency", label: "Frekuensi Angsuran", required: false, width: 18, hint: "Default MONTHLY", example: "MONTHLY", list: "FrekuensiAngsuran" },
      { key: "installmentCount", label: "Jumlah Angsuran", required: false, width: 16, hint: "Wajib untuk DAILY/WEEKLY", example: "", fmt: "0" },
      { key: "rate", label: "Tarif Efektif (%/tahun)", required: false, width: 20, hint: "Kosong = ikut produk", example: "", fmt: "0.0000" },
      { key: "status", label: "Status", required: false, width: 14, hint: "Default ACTIVE", example: "ACTIVE", list: "StatusPinjaman" },
      { key: "kolCategory", label: "Kolektibilitas", required: false, width: 18, hint: "Default LANCAR", example: "LANCAR", list: "KOL" },
      { key: "daysOverdue", label: "Hari Tunggakan", required: false, width: 16, hint: "Default 0", example: 0, fmt: "0" },
      { key: "notes", label: "Catatan", required: false, width: 34, hint: "Mis. asal data, nomor kontrak lama", example: "Migrasi dari sistem lama, kontrak 2026/03/015" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = unit pertama", example: "", fmt: "@" }
    ]
  },
  {
    name: "8_Jadwal_Angsuran",
    title: "Jadwal Angsuran (opsional)",
    purpose: "Rincian jadwal tiap pinjaman, termasuk yang sudah dibayar. Tanpa sheet ini, sistem membuat jadwal baru dari sisa kewajiban. Isi bila ingin riwayat jatuh tempo tetap akurat.",
    required: false,
    cols: [
      { key: "loanRef", label: "Kode Pinjaman", required: true, width: 16, hint: "Harus ada di sheet 7", example: "L-001", fmt: "@" },
      { key: "seq", label: "Angsuran Ke-", required: true, width: 14, hint: "1, 2, 3, ... berurutan", example: 1, fmt: "0" },
      { key: "dueDate", label: "Jatuh Tempo", required: true, width: 16, hint: "YYYY-MM-DD", example: "2026-04-15", fmt: "@" },
      { key: "principalDue", label: "Pokok Tagihan (Rp)", required: true, width: 20, hint: "", example: 833333.33, fmt: "#,##0.00" },
      { key: "interestDue", label: "Imbal Tagihan (Rp)", required: true, width: 20, hint: "", example: 100000, fmt: "#,##0.00" },
      { key: "principalPaid", label: "Pokok Terbayar (Rp)", required: false, width: 20, hint: "Default 0", example: 833333.33, fmt: "#,##0.00" },
      { key: "interestPaid", label: "Imbal Terbayar (Rp)", required: false, width: 20, hint: "Default 0", example: 100000, fmt: "#,##0.00" },
      { key: "paidOffAt", label: "Tanggal Lunas", required: false, width: 16, hint: "YYYY-MM-DD, kosong jika belum lunas", example: "2026-04-14", fmt: "@" }
    ]
  },
  {
    name: "9_Saldo_Awal_Jurnal",
    title: "Saldo Awal Akuntansi",
    purpose: "Neraca saldo (trial balance) LENGKAP per cut-off dari buku besar sistem lama, semua akun termasuk simpanan dan piutang. Sistem menghitung sendiri selisih terhadap jurnal otomatis dari sheet 5 dan 7. Lihat aturan C di PETUNJUK.",
    required: true,
    cols: [
      { key: "accountCode", label: "Kode Akun", required: true, width: 14, hint: "Lihat sheet Referensi_COA", example: "1-1000", fmt: "@" },
      { key: "accountName", label: "Nama Akun (info)", required: false, width: 34, hint: "Hanya untuk dibaca, tidak diproses", example: "Kas" },
      { key: "debit", label: "Debit (Rp)", required: false, width: 20, hint: "Isi salah satu: debit ATAU kredit", example: 15000000, fmt: "#,##0.00" },
      { key: "credit", label: "Kredit (Rp)", required: false, width: 20, hint: "", example: "", fmt: "#,##0.00" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = tingkat koperasi (belum dialokasikan)", example: "", fmt: "@" }
    ],
    extraNote: "Total Debit harus sama dengan total Kredit. Sistem menolak file yang tidak seimbang."
  },
  {
    name: "10_Akun_Tambahan",
    title: "Akun Tambahan (opsional)",
    purpose: "Hanya jika koperasi punya akun di luar COA standar. Akun standar sudah dibuat otomatis (lihat Referensi_COA).",
    required: false,
    cols: [
      { key: "code", label: "Kode Akun", required: true, width: 14, hint: "Unik per koperasi", example: "5-2900", fmt: "@" },
      { key: "name", label: "Nama Akun", required: true, width: 34, hint: "", example: "Beban Lain-lain" },
      { key: "category", label: "Kategori", required: true, width: 16, hint: "ASET / KEWAJIBAN / EKUITAS / PENDAPATAN / BEBAN", example: "BEBAN" },
      { key: "normalBalance", label: "Saldo Normal", required: true, width: 16, hint: "DEBIT / KREDIT", example: "DEBIT" },
      { key: "parentCode", label: "Kode Akun Induk", required: false, width: 16, hint: "Kosong = tingkat atas", example: "", fmt: "@" },
      { key: "isCashEquivalent", label: "Setara Kas?", required: false, width: 14, hint: "YA/TIDAK", example: "TIDAK", list: "YaTidak" }
    ]
  }
];

/** Sheets that differ when the source is a report rather than a ledger. */
const LAPORAN_SHEETS: Record<string, SheetDef | null> = {
  "5_Saldo_Simpanan": {
    ...SHEETS.find((s) => s.name === "5_Saldo_Simpanan")!,
    purpose: "Saldo simpanan per anggota per produk dari LAMPIRAN RAT (daftar simpanan anggota). Satu baris per rekening simpanan. Jumlahnya harus sama dengan akun simpanan di Neraca."
  },
  "7_Pinjaman": {
    name: "7_Pinjaman",
    title: "Pinjaman (ringkas)",
    purpose: "Sisa pembiayaan per anggota dari lampiran RAT. Laporan tidak memuat plafon, tenor, atau tanggal cair, jadi sistem membuat nilai pengganti dan menandainya di Catatan. KOL dan jatuh tempo TIDAK akurat sampai kontrak asli dimasukkan.",
    required: true,
    cols: [
      { key: "loanRef", label: "Kode Pinjaman", required: true, width: 16, hint: "Kode buatan Anda, unik", example: "L-001", fmt: "@" },
      { key: "nik", label: "NIK Anggota", required: true, width: 20, hint: "Harus ada di sheet 3_Anggota", example: "3578012345670001", fmt: "@" },
      { key: "productCode", label: "Kode Produk", required: true, width: 14, hint: "Harus ada di sheet 6", example: "PJ", fmt: "@" },
      { key: "remainingPrincipal", label: "Sisa Pokok (Rp)", required: true, width: 18, hint: "Sisa pokok pembiayaan per cut-off, dari lampiran RAT. Menjadi saldo Piutang", example: 6666667, fmt: "#,##0.00" },
      { key: "remainingAmount", label: "Sisa Kewajiban (Rp)", required: false, width: 20, hint: "Sisa pokok + imbal/infaq. Kosong = sama dengan Sisa Pokok", example: "", fmt: "#,##0.00" },
      { key: "termMonths", label: "Perkiraan Sisa Tenor (bulan)", required: true, width: 22, hint: "Perkiraan Anda. Angsuran dibagi rata selama tenor ini mulai bulan setelah cut-off", example: 8, fmt: "0" },
      { key: "installmentAmount", label: "Angsuran per Bulan (Rp)", required: false, width: 22, hint: "Kosong = Sisa Kewajiban dibagi Sisa Tenor", example: "", fmt: "#,##0.00" },
      { key: "kolCategory", label: "Kolektibilitas", required: false, width: 18, hint: "Default LANCAR. Isi MACET dst. hanya bila laporan menyebutnya", example: "LANCAR", list: "KOL" },
      { key: "notes", label: "Catatan", required: false, width: 38, hint: "Sistem otomatis menambah awalan 'Migrasi dari laporan RAT: tenor dan tanggal cair estimasi.'", example: "" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = unit pertama", example: "", fmt: "@" }
    ]
  },
  "8_Jadwal_Angsuran": null,
  "9_Saldo_Awal_Jurnal": {
    name: "9_Neraca",
    title: "Neraca",
    purpose: "Salin tiap baris Neraca (Aset, Kewajiban, Ekuitas) per cut-off. Satu baris per akun yang tampil di Neraca. Pilih Kode Akun SISKOP dari sheet Referensi_COA untuk tiap baris.",
    required: true,
    cols: [
      { key: "reportName", label: "Nama Akun di Neraca", required: true, width: 38, hint: "Persis seperti tertulis di laporan, untuk jejak audit", example: "Kas / Bank Jatim" },
      { key: "accountCode", label: "Kode Akun SISKOP", required: true, width: 16, hint: "Lihat Referensi_COA. Beberapa baris neraca boleh dipetakan ke akun yang sama", example: "1-1000", fmt: "@" },
      { key: "amount", label: "Jumlah (Rp)", required: true, width: 20, hint: "Angka seperti di Neraca. Positif = sesuai saldo normal akun. NEGATIF untuk pengurang (mis. penyisihan piutang, atau rugi tahun berjalan)", example: 15000000, fmt: "#,##0.00;-#,##0.00" },
      { key: "unitCode", label: "Kode Unit", required: false, width: 12, hint: "Kosong = tingkat koperasi (neraca konsolidasi)", example: "", fmt: "@" }
    ],
    extraNote: "Sistem menentukan debit/kredit dari Saldo Normal akun SISKOP. Total Aset harus sama dengan Kewajiban + Ekuitas; bila tidak, file ditolak."
  }
};

const sheetsFor = (mode: Mode): SheetDef[] =>
  mode === "SISTEM"
    ? SHEETS
    : SHEETS.flatMap((s) => (s.name in LAPORAN_SHEETS ? (LAPORAN_SHEETS[s.name] ? [LAPORAN_SHEETS[s.name]!] : []) : [s]));

/** The data sheets of a template, in workbook order. */
export const templateSheets = sheetsFor;

async function buildWorkbook(mode: Mode): Promise<ExcelJS.Workbook> {
  const SHEETSM = sheetsFor(mode);
  const wb = new ExcelJS.Workbook();
  wb.creator = "SISKOP";
  wb.created = new Date();

  const style = (cell: ExcelJS.Cell, fill: string, bold = true, color = "FFFFFFFF") => {
    cell.font = { bold, color: { argb: color } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", wrapText: true };
  };

  // ── PETUNJUK ────────────────────────────────────────────────────────────────
  const guide = wb.addWorksheet("PETUNJUK", { properties: { tabColor: { argb: NAVY } } });
  guide.columns = [{ width: 4 }, { width: 28 }, { width: 100 }];
  const put = (row: number, a: string, b = "", opt: { head?: boolean; sub?: boolean } = {}) => {
    guide.getCell(row, 2).value = a;
    guide.getCell(row, 3).value = b;
    guide.getCell(row, 3).alignment = { wrapText: true, vertical: "top" };
    guide.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    if (opt.head) {
      style(guide.getCell(row, 2), NAVY);
      style(guide.getCell(row, 3), NAVY);
    } else if (opt.sub) guide.getCell(row, 2).font = { bold: true };
  };
  let r = 1;
  guide.getCell(r, 2).value =
    mode === "SISTEM"
      ? `TEMPLATE MIGRASI KOPERASI KE SISKOP - DARI DATA SISTEM LAMA  (versi ${VERSION})`
      : `TEMPLATE MIGRASI KOPERASI KE SISKOP - DARI LAPORAN (NERACA, RAT)  (versi ${VERSION})`;
  guide.getCell(r, 2).font = { bold: true, size: 16, color: { argb: NAVY } };
  r += 2;
  put(r++, "Identitas Migrasi", "", { head: true });
  put(r++, "Nama Koperasi", "(diisi admin)");
  put(
    r++,
    "Tanggal Cut-off",
    mode === "SISTEM"
      ? "(isi di sheet 1_Koperasi, kolom cutoffDate, format YYYY-MM-DD) Tanggal saldo yang dimigrasi. Semua saldo di sheet 5, 7, dan 9 harus per tanggal ini."
      : "(isi di sheet 1_Koperasi, kolom cutoffDate, format YYYY-MM-DD) Tanggal Neraca. Sebaiknya akhir tahun buku yang sudah ditutup dan disahkan RAT (mis. 2025-12-31). Neraca dan semua lampiran harus per tanggal yang sama."
  );
  const cutoffRow = r - 1;
  guide.getCell(cutoffRow, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  guide.getCell(cutoffRow, 3).numFmt = "@";
  guide.getCell(r - 2, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  put(r++, "Disiapkan oleh", "(nama admin koperasi)");
  guide.getCell(r - 1, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  r++;

  put(r++, "A. Prosedur Penggunaan", "", { head: true });
  const steps: [string, string][] = [
    ["1. Unduh template", "Gunakan file ini apa adanya. Jangan mengubah nama sheet, urutan sheet, atau teks pada baris judul kolom (baris 1). Sistem membaca kolom berdasarkan judul tersebut."],
    ["2. Isi PETUNJUK", "Isi Nama Koperasi dan Disiapkan oleh pada kotak kuning di atas. Tanggal Cut-off diisi di sheet 1_Koperasi."],
    ["3. Isi sheet berurutan", "Kerjakan dari sheet 1 sampai 10 (yang ada di file ini). Sheet yang tertulis WAJIB harus berisi data. Sheet bertanda (opsional) boleh dibiarkan kosong. Urutan penting karena sheet belakang merujuk kode di sheet depan."],
    ["4. Pahami warna judul", "Biru tua = kolom WAJIB diisi. Abu-abu = kolom opsional. Baris 2 berisi petunjuk isi, baris 3 berisi contoh. HAPUS baris 2 dan 3 sebelum diunggah, atau biarkan; sistem melewatinya karena berawalan tanda '#'."],
    ["5. Isi data mulai baris 4", "Satu baris = satu data. Jangan menyisipkan baris judul baru, sel digabung, atau rumus. Gunakan nilai, bukan rumus."],
    ["6. Format data", "Tanggal: YYYY-MM-DD (mis. 2026-03-21), kolom berformat TEKS. NIK: 16 digit, berformat TEKS (jangan sampai berubah jadi 3.57E+15). Uang: angka biasa tanpa 'Rp', tanpa titik ribuan, maksimal 2 desimal. Kolom bergaris tarik-turun (dropdown): pilih dari daftar, jangan diketik bebas."],
    ["7. Cek sendiri sebelum kirim", "Lihat bagian C (Aturan Rekonsiliasi). Hitung total saldo simpanan dan total sisa pinjaman, cocokkan dengan buku besar sistem lama."],
    ["8. Serahkan ke platform owner", "Kirim file lewat jalur aman yang disepakati. File ini memuat data pribadi anggota (NIK, alamat). Jangan kirim lewat grup chat umum. JANGAN menulis kata sandi di file ini."],
    ["9. Platform owner mengunggah", "Platform owner membuka menu Migrasi Koperasi di Panel Platform, mengunggah file, dan menjalankan PRATINJAU (dry run). Pratinjau menampilkan jumlah baris per sheet, daftar kesalahan, dan total saldo. Tidak ada data yang tersimpan pada tahap ini."],
    ["10. Perbaiki & ulangi", "Jika ada kesalahan, platform owner mengirim daftar kesalahan (sheet, baris, kolom, alasan). Admin memperbaiki file lalu diunggah ulang. Ulangi sampai pratinjau bersih."],
    ["11. Eksekusi", "Setelah pratinjau bersih dan admin menyetujui totalnya, platform owner menekan EKSEKUSI. Seluruh data masuk dalam satu transaksi: berhasil semua atau tidak sama sekali."],
    ["12. Verifikasi pasca-migrasi", "Admin login, lalu cocokkan: jumlah anggota, total saldo simpanan, total sisa pinjaman, dan Neraca per tanggal cut-off dengan sistem lama. Selisih dilaporkan ke platform owner sebelum koperasi mulai bertransaksi."]
  ];
  if (mode === "LAPORAN") {
    steps[6] = ["7. Cek sendiri sebelum kirim", "Lihat bagian C. Jumlahkan sheet 5 per tipe simpanan dan sheet 7, lalu cocokkan dengan akun terkait di Neraca. Selisih harus dijelaskan sebelum file dikirim."];
    steps[11] = ["12. Verifikasi pasca-migrasi", "Admin login, buka Neraca per tanggal cut-off, dan cocokkan baris demi baris dengan Neraca RAT. Cocokkan juga jumlah anggota dan total simpanan dengan lampiran RAT. Selisih dilaporkan ke platform owner sebelum koperasi mulai bertransaksi."];
}
for (const [a, b] of steps) put(r++, a, b, {});
r++;

if (mode === "LAPORAN") {
  put(r++, "Dokumen yang harus disiapkan", "", { head: true });
  put(r++, "1. Neraca", "Neraca per tanggal cut-off, sudah disahkan RAT. Sumber sheet 9_Neraca.");
  put(r++, "2. Lampiran simpanan", "Daftar simpanan per anggota (pokok, wajib, sukarela, dst). Sumber sheet 5. Total harus sama dengan akun simpanan di Neraca.");
  put(r++, "3. Lampiran pembiayaan", "Daftar sisa pembiayaan/pinjaman per anggota. Sumber sheet 7. Total pokok harus sama dengan Piutang di Neraca.");
  put(r++, "4. Data identitas anggota", "Buku anggota atau data kepegawaian: NIK 16 digit, alamat, tempat dan tanggal lahir, pekerjaan. Laporan tidak memuat ini, tetapi SISKOP mewajibkannya (NIK unik, dipakai login portal anggota). Jangan mengarang NIK sementara.");
  put(r++, "5. Profil koperasi", "Nomor badan hukum, alamat, daftar unit usaha, dan tarif tiap produk simpanan/pinjaman (tarif jarang tertulis di laporan; konfirmasi ke pengurus).");
  r++;
}

put(r++, "B. Daftar Sheet", "", { head: true });
for (const s of SHEETSM) put(r++, s.name, `${s.required ? "WAJIB" : "opsional"}. ${s.purpose}`);
put(r++, "Referensi_*", "Daftar pilihan dan COA standar. Hanya untuk dibaca; tidak perlu diisi.");
r++;

put(r++, "C. Aturan Rekonsiliasi (WAJIB dipahami)", "", { head: true });
if (mode === "SISTEM") {
  put(r++, "Sheet 9 = neraca saldo lengkap", "Isi SEMUA akun buku besar sistem lama per cut-off, termasuk Simpanan Pokok/Wajib/Sukarela dan Piutang Pinjaman. Sheet 9 harus seimbang (total debit = total kredit).");
} else {
  put(r++, "Sheet 9 = Neraca apa adanya", "Salin SEMUA baris Neraca, termasuk simpanan dan piutang. Total Aset harus sama dengan Kewajiban + Ekuitas. Jumlah ditulis seperti di laporan; pengurang (penyisihan piutang, akumulasi penyusutan) ditulis NEGATIF.");
  put(r++, "Pilih akhir tahun buku", "Neraca setelah penutupan tahun tidak memuat pendapatan dan beban; laba tahun itu sudah menjadi SHU di ekuitas (akun 3-3100 SHU Tahun Lalu Belum Dibagi, atau akun bagian SHU yang sudah dibagi). Cut-off di tengah tahun membuat laba rugi berjalan hanya tampil sebagai satu angka SHU Tahun Berjalan (3-3000), tanpa rincian pendapatan/beban.");
  put(r++, "Pemetaan akun", "Nama akun di Neraca lama jarang sama dengan COA SISKOP. Pilih Kode Akun dari Referensi_COA untuk tiap baris. Akun yang tidak punya padanan: tambahkan di sheet 10 lalu rujuk kodenya.");
  put(r++, "Neraca konsolidasi", "Neraca laporan tidak dipecah per unit usaha. Biarkan Kode Unit kosong; saldo masuk ke ember 'tidak dialokasikan'. Rincian per unit tidak tersedia dari laporan.");
  put(r++, "Pinjaman bersifat perkiraan", "Laporan hanya memberi sisa. Tenor, angsuran, dan tanggal cair di sheet 7 adalah estimasi; sistem menandainya di Catatan. Jadwal angsuran dan KOL baru akurat setelah pengurus melengkapi kontrak asli.");
}
put(r++, "Anti-ganda otomatis", "Saldo simpanan (sheet 5) dan sisa pokok pinjaman (sheet 7) dijurnal otomatis oleh sistem. Sistem lalu menghitung selisih antara sheet 9 dan jurnal otomatis itu per akun, dan hanya memposting selisihnya sebagai satu jurnal 'Saldo Awal Migrasi'. Admin tidak perlu mengurangi apa pun secara manual.");
put(r++, "Rekonsiliasi buku pembantu", "Pratinjau membandingkan total sheet 5 per tipe simpanan dengan akun simpanan di sheet 9, dan total Sisa Pokok sheet 7 dengan akun Piutang Pinjaman di sheet 9. Selisih tampil sebagai PERINGATAN dan harus dijelaskan admin sebelum eksekusi.");
put(r++, "Satu NIK satu anggota", "NIK tidak boleh dobel. Anggota ganda di sistem lama harus digabung sebelum diisi.");
put(r++, "Anggota tanpa simpanan pokok", "Sistem menolak pinjaman untuk anggota yang tidak punya simpanan Pokok aktif. Pastikan setiap anggota di sheet 7 punya baris Pokok di sheet 5.");
put(r++, "Pengurus/Pengawas", "Pinjaman pengurus/pengawas dibatasi 10% dari Modal Disetor (Permenkop UKM 8/2023). Pada migrasi data lama, pelanggaran batas ditampilkan sebagai PERINGATAN, bukan penolakan, karena pinjaman sudah berjalan.");
put(r++, "Pinjaman lunas", "Pinjaman yang sudah lunas sebelum cut-off tidak perlu dimasukkan kecuali ingin riwayat. Jika dimasukkan, isi Status = COMPLETED dan Sisa Kewajiban = 0.");

for (let i = 1; i <= r; i++) guide.getRow(i).alignment = { wrapText: true, vertical: "top" };
guide.views = [{ showGridLines: false }];

// ── Referensi lists ──────────────────────────────────────────────────────────
const ref = wb.addWorksheet("Referensi_Pilihan", { properties: { tabColor: { argb: GREY } } });
const listRef: Record<string, string> = {};
Object.entries(LISTS).forEach(([name, values], i) => {
  const colIdx = i + 1;
  ref.getCell(1, colIdx).value = name;
  style(ref.getCell(1, colIdx), GREY);
  values.forEach((v, j) => (ref.getCell(j + 2, colIdx).value = v));
  ref.getColumn(colIdx).width = 22;
  const letter = ref.getColumn(colIdx).letter;
  listRef[name] = `Referensi_Pilihan!$${letter}$2:$${letter}$${values.length + 1}`;
});

// ── Data sheets ──────────────────────────────────────────────────────────────
for (const def of SHEETSM) {
  const ws = wb.addWorksheet(def.name, { properties: { tabColor: { argb: def.required ? NAVY : GREY } } });
  def.cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    const head = ws.getCell(1, i + 1);
    // Header text is the machine key: the importer matches columns on this row.
    head.value = c.key;
    style(head, c.required ? NAVY : GREY);
    const hint = ws.getCell(2, i + 1);
    hint.value = `# ${c.required ? "WAJIB" : "opsional"} - ${c.label}${c.hint ? ": " + c.hint : ""}`;
    hint.font = { italic: true, size: 9, color: { argb: GREY } };
    hint.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    hint.alignment = { wrapText: true, vertical: "top" };
    const ex = ws.getCell(3, i + 1);
    ex.value = c.example === "" ? null : (c.example as ExcelJS.CellValue);
    ex.font = { italic: true, color: { argb: GREY } };
    // Importer ignores any row whose first cell starts with '#'; keep that true for the example row too.
    if (i === 0) ex.value = `#${c.example}`;
    if (c.fmt) {
      for (let rr = 3; rr <= 1003; rr++) ws.getCell(rr, i + 1).numFmt = c.fmt;
    }
    if (c.list) {
      for (let rr = 4; rr <= 1003; rr++) {
        ws.getCell(rr, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [listRef[c.list]], showErrorMessage: true, errorTitle: "Nilai tidak valid", error: "Pilih dari daftar." };
      }
    }
  });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 64;
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length } };
  if (def.extraNote) {
    const nc = def.cols.length + 2;
    ws.getCell(1, nc).value = "Catatan";
    ws.getCell(1, nc).font = { bold: true };
    ws.getCell(2, nc).value = def.extraNote;
    ws.getColumn(nc).width = 60;
    ws.getCell(2, nc).alignment = { wrapText: true, vertical: "top" };
  }
}

// ── Referensi_COA ────────────────────────────────────────────────────────────
const coa = wb.addWorksheet("Referensi_COA", { properties: { tabColor: { argb: GREY } } });
const coaHead = ["Kode", "Nama Akun", "Kategori", "Saldo Normal", "Sub-Ekuitas", "Header?", "Catatan"];
coaHead.forEach((h, i) => {
  coa.getCell(1, i + 1).value = h;
  style(coa.getCell(1, i + 1), GREY);
});
COA_TEMPLATE.forEach((a, i) => {
  const note = a.unitType ? `Hanya jika ada unit ${a.unitType}` : a.multiUnitOnly ? "Hanya koperasi multi-unit" : "";
  [a.code, a.name, a.category, a.normalBalance, a.equityClass ?? "", a.isHeader ? "YA" : "", note].forEach((v, j) => (coa.getCell(i + 2, j + 1).value = v));
  coa.getCell(i + 2, 1).numFmt = "@";
  if (a.isHeader) coa.getRow(i + 2).font = { bold: true };
});
[12, 44, 14, 14, 20, 10, 32].forEach((w, i) => (coa.getColumn(i + 1).width = w));
coa.views = [{ state: "frozen", ySplit: 1 }];

return wb;
}

export async function buildTemplate(mode: Mode): Promise<Buffer> {
  const wb = await buildWorkbook(mode);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
