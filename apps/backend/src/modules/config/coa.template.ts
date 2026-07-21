import { AccountCategory } from '@siskop/shared';

/** Standard COA template (Design Spec §4) — seeded on tenant request, editable after seeding. */
export const DEFAULT_COA_TEMPLATE: Array<{
  code: string;
  name: string;
  category: AccountCategory;
  isHeader?: boolean;
}> = [
  { code: '1-1000', name: 'Kas', category: AccountCategory.ASET },
  { code: '1-1010', name: 'Bank', category: AccountCategory.ASET },
  { code: '1-1100', name: 'Piutang Pinjaman Anggota', category: AccountCategory.ASET },
  { code: '1-1190', name: 'Penyisihan Kerugian Piutang', category: AccountCategory.ASET },
  { code: '1-2000', name: 'Aset Tetap', category: AccountCategory.ASET, isHeader: true },
  { code: '2-1000', name: 'Simpanan Sukarela — Anggota', category: AccountCategory.KEWAJIBAN },
  { code: '2-1100', name: 'Utang Usaha', category: AccountCategory.KEWAJIBAN },
  { code: '3-1000', name: 'Simpanan Pokok', category: AccountCategory.EKUITAS },
  { code: '3-1100', name: 'Simpanan Wajib', category: AccountCategory.EKUITAS },
  { code: '3-2000', name: 'Cadangan / Modal Penyertaan', category: AccountCategory.EKUITAS },
  { code: '3-3000', name: 'SHU Tahun Berjalan', category: AccountCategory.EKUITAS },
  { code: '3-3100', name: 'SHU Tahun Lalu Belum Dibagi', category: AccountCategory.EKUITAS },
  { code: '4-1000', name: 'Pendapatan Bunga/Margin Pinjaman', category: AccountCategory.PENDAPATAN },
  { code: '4-2000', name: 'Pendapatan Jasa Administrasi', category: AccountCategory.PENDAPATAN },
  { code: '4-9000', name: 'Pendapatan Lain-lain', category: AccountCategory.PENDAPATAN },
  { code: '5-1000', name: 'Beban Bunga/Bagi Hasil Simpanan', category: AccountCategory.BEBAN },
  { code: '5-2000', name: 'Beban Operasional — Gaji', category: AccountCategory.BEBAN },
  { code: '5-2100', name: 'Beban Sewa', category: AccountCategory.BEBAN },
  { code: '5-3000', name: 'Beban Penyisihan Kerugian Piutang', category: AccountCategory.BEBAN },
  { code: '5-9000', name: 'Beban Lain-lain', category: AccountCategory.BEBAN },
];

/** Category-prefix convention (Design Spec §4) — enforced at write time. */
export const CATEGORY_PREFIX: Record<AccountCategory, string> = {
  [AccountCategory.ASET]: '1-',
  [AccountCategory.KEWAJIBAN]: '2-',
  [AccountCategory.EKUITAS]: '3-',
  [AccountCategory.PENDAPATAN]: '4-',
  [AccountCategory.BEBAN]: '5-',
};

/** Normal balance side is fully determined by category. */
export const CATEGORY_NORMAL_BALANCE: Record<AccountCategory, 'DEBIT' | 'KREDIT'> = {
  [AccountCategory.ASET]: 'DEBIT',
  [AccountCategory.KEWAJIBAN]: 'KREDIT',
  [AccountCategory.EKUITAS]: 'KREDIT',
  [AccountCategory.PENDAPATAN]: 'KREDIT',
  [AccountCategory.BEBAN]: 'DEBIT',
};

/**
 * Expected debit/credit category shape per transaction kind (Design Spec §8).
 * Validated at mapping write time so a backwards mapping can't silently corrupt
 * reports once the Phase 2 posting engine exists.
 */
export const EXPECTED_MAPPING_SHAPE: Record<
  string,
  { debit: AccountCategory[]; credit: AccountCategory[] }
> = {
  DEPOSIT: {
    debit: [AccountCategory.ASET],
    credit: [AccountCategory.EKUITAS, AccountCategory.KEWAJIBAN],
  },
  WITHDRAWAL: {
    debit: [AccountCategory.EKUITAS, AccountCategory.KEWAJIBAN],
    credit: [AccountCategory.ASET],
  },
  DISBURSEMENT: {
    debit: [AccountCategory.ASET],
    credit: [AccountCategory.ASET],
  },
  PAYMENT_PRINCIPAL: {
    debit: [AccountCategory.ASET],
    credit: [AccountCategory.ASET],
  },
  PAYMENT_INTEREST: {
    debit: [AccountCategory.ASET],
    credit: [AccountCategory.PENDAPATAN],
  },
  PAYMENT_PENALTY: {
    debit: [AccountCategory.ASET],
    credit: [AccountCategory.PENDAPATAN],
  },
};

/** Which transaction kinds apply to which source type — used for the completeness indicator. */
export const SAVING_CONFIG_KINDS = ['DEPOSIT', 'WITHDRAWAL'] as const;
export const LOAN_CONFIG_KINDS = [
  'DISBURSEMENT',
  'PAYMENT_PRINCIPAL',
  'PAYMENT_INTEREST',
  'PAYMENT_PENALTY',
] as const;
