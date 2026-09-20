import type { AccountCategory, NormalBalance } from "@prisma/client";

export interface AccountSeed {
  key: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  isHeader?: boolean;
  isCashEquivalent?: boolean;
  parentKey?: string;
  /**
   * When set, the account only belongs to tenants that have an active
   * CooperativeUnit of this type. Left out of the base template so a pure KSP
   * doesn't get zero-balance Toko lines cluttering its Neraca/Laba Rugi.
   */
  unitType?: "KONSUMEN";
}

// Standard COA template — Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md §4.
// Single source of truth for both prisma/seed.ts (demo/dev tenants) and
// modules/config/service.ts#generateStandardCoa (the in-app "generate standard
// COA" button) — without accounts + mappings, every transaction's JournalEntry
// posts as UNPOSTED_MISSING_MAPPING and the regulatory reports come up empty.
export const COA_TEMPLATE: AccountSeed[] = [
  { key: "kas", code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true },
  { key: "bank", code: "1-1010", name: "Bank", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true },
  { key: "piutang_pinjaman", code: "1-1100", name: "Piutang Pinjaman Anggota", category: "ASET", normalBalance: "DEBIT" },
  {
    key: "penyisihan_piutang",
    code: "1-1190",
    name: "Penyisihan Kerugian Piutang",
    category: "ASET",
    normalBalance: "KREDIT" // contra-asset — credit-normal, reduces Piutang Pinjaman Anggota
  },
  { key: "aset_tetap", code: "1-2000", name: "Aset Tetap", category: "ASET", normalBalance: "DEBIT", isHeader: true },
  { key: "simpanan_sukarela", code: "2-1000", name: "Simpanan Sukarela — Anggota", category: "KEWAJIBAN", normalBalance: "KREDIT" },
  { key: "utang_usaha", code: "2-1100", name: "Utang Usaha", category: "KEWAJIBAN", normalBalance: "KREDIT" },
  { key: "simpanan_pokok", code: "3-1000", name: "Simpanan Pokok", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "simpanan_wajib", code: "3-1100", name: "Simpanan Wajib", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "cadangan", code: "3-2000", name: "Cadangan / Modal Penyertaan", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "shu_berjalan", code: "3-3000", name: "SHU Tahun Berjalan", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "shu_lalu", code: "3-3100", name: "SHU Tahun Lalu Belum Dibagi", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "pendapatan_bunga", code: "4-1000", name: "Pendapatan Bunga/Margin Pinjaman", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "pendapatan_admin", code: "4-2000", name: "Pendapatan Jasa Administrasi", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "pendapatan_lain", code: "4-9000", name: "Pendapatan Lain-lain", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "beban_bunga_simpanan", code: "5-1000", name: "Beban Bunga/Bagi Hasil Simpanan", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_gaji", code: "5-2000", name: "Beban Operasional — Gaji", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_sewa", code: "5-2100", name: "Beban Sewa", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_penyisihan", code: "5-3000", name: "Beban Penyisihan Kerugian Piutang", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_lain", code: "5-9000", name: "Beban Lain-lain", category: "BEBAN", normalBalance: "DEBIT" },

  // ── Toko (KONSUMEN unit) — only generated for tenants that have one ─────────
  // Codes deliberately avoid 4-2000 / 5-1000 (already Pendapatan Jasa
  // Administrasi / Beban Bunga Simpanan above). 1-1150 and 1-1300 match what
  // prisma/seed-ksu-demo.ts has always used for these two accounts.
  {
    key: "piutang_anggota_toko",
    code: "1-1150",
    name: "Piutang Anggota (Toko)",
    category: "ASET",
    normalBalance: "DEBIT",
    unitType: "KONSUMEN"
  },
  {
    key: "persediaan",
    code: "1-1300",
    name: "Persediaan Barang Dagang",
    category: "ASET",
    normalBalance: "DEBIT",
    unitType: "KONSUMEN"
  },
  {
    key: "penjualan_toko",
    code: "4-3000",
    name: "Penjualan Barang Dagang",
    category: "PENDAPATAN",
    normalBalance: "KREDIT",
    unitType: "KONSUMEN"
  },
  {
    key: "hpp",
    code: "5-4000",
    name: "Harga Pokok Penjualan",
    category: "BEBAN",
    normalBalance: "DEBIT",
    unitType: "KONSUMEN"
  }
];

export interface SystemMappingSeed {
  transactionKind: "SALE_REVENUE" | "SALE_COGS" | "SALE_RECEIVABLE" | "MEMBER_CREDIT_REPAYMENT";
  /** `COA_TEMPLATE` keys. */
  debitKey: string;
  creditKey: string;
}

// Tenant-wide SYSTEM mappings (sourceType "SYSTEM", no sourceId) that
// lib/journal.ts#postPosSale / postMemberCreditRepayment resolve at posting
// time. Same pairings prisma/seed-ksu-demo.ts has always set up by hand.
export const SYSTEM_MAPPING_TEMPLATE: SystemMappingSeed[] = [
  { transactionKind: "SALE_REVENUE", debitKey: "kas", creditKey: "penjualan_toko" },
  { transactionKind: "SALE_COGS", debitKey: "hpp", creditKey: "persediaan" },
  { transactionKind: "SALE_RECEIVABLE", debitKey: "piutang_anggota_toko", creditKey: "penjualan_toko" },
  { transactionKind: "MEMBER_CREDIT_REPAYMENT", debitKey: "kas", creditKey: "piutang_anggota_toko" }
];
