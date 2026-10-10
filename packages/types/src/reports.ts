import type { EquityClass } from "./accounting.js";

// RPT-01/RPT-02 — hand-aggregated savings/loan summary reports (predates the
// ledger). Kept alongside the ledger-derived regulatory reports below; see
// Docs/specs/2026-07-22-pelaporan-regulasi-design.md §12 ("Changes to today's
// RPT-01/RPT-02 aggregate financial/RAT reports (unchanged)").
export interface FinancialReport {
  periode: { start: string; end: string };
  simpananPerJenis: { name: string; type: string; totalBalance: string; count: number }[];
  transaksiSimpanan: {
    deposit: { total: string; count: number };
    withdrawal: { total: string; count: number };
  };
  pinjaman: {
    dicairkan: { total: string; count: number };
    angsuranDiterima: { total: string; totalDenda: string; count: number };
  };
  saldoAkhirSimpanan: string;
  sisaPinjamanOutstanding: string;
}

export interface RATReport {
  tahun: number;
  keanggotaan: { awalTahun: number; akhirTahun: number; pertumbuhan: number };
  simpanan: { jenis: string; type: string; totalSaldo: string; jumlahRekening: number }[];
  pinjaman: { diberikan: { total: string; count: number }; lunas: number };
  kolDistribution: { category: string; count: number; percentage: string }[];
}

// ── Regulatory reports (Permenkop UKM No. 2/2024) — ledger-derived ───────────

export interface NeracaItem {
  accountId: string | null;
  code: string | null;
  name: string;
  balance: string;
  isComputed: boolean;
  /** EKUITAS lines only (the computed unclosed-SHU line is SHU); null elsewhere or when unclassified. */
  equityClass: EquityClass | null;
  /** Depth in the chart of accounts, roots = 1. Drives indentation in the UI. */
  level: number;
  parentId: string | null;
  /**
   * A header row is a group (Aset Tetap, ...): `balance` is its descendants rolled up,
   * and it is not added into the section total (its children already are).
   */
  isHeader: boolean;
  /** Opposite-normal-balance account (e.g. Penyisihan Piutang): `balance` is negative, reducing the section. */
  isContra: boolean;
}

export interface NeracaSection {
  items: NeracaItem[];
  total: string;
}

export interface Neraca {
  asOfDate: string;
  aset: NeracaSection;
  kewajiban: NeracaSection;
  ekuitas: NeracaSection;
  totalKewajibanDanEkuitas: string;
  balanced: boolean;
  /**
   * Subtotal of the ekuitas lines that are Modal Sendiri (Permenkop UKM 8/2023
   * Pasal 1 angka 23). Ledger only: an opening-balance adjustment sits outside
   * the Neraca so it stays balanced.
   */
  modalSendiri: string;
}

// ── Laporan Perubahan Ekuitas (Permenkop UKM 2/2024 lampiran) ────────────────

/** An equity class column, or the column for EKUITAS accounts not classified yet. */
export type PerubahanEkuitasColumnKey = EquityClass | "BELUM_DIKLASIFIKASI";

export type PerubahanEkuitasRowKey = "SALDO_AWAL" | "PENAMBAHAN" | "PENGURANGAN" | "SHU_PERIODE_BERJALAN" | "SALDO_AKHIR";

export interface PerubahanEkuitasRow {
  key: PerubahanEkuitasRowKey;
  label: string;
  /** Keyed by every column in `columns`. PENGURANGAN values are positive amounts. */
  values: Record<string, string>;
  total: string;
}

export interface PerubahanEkuitas {
  periode: { from: string; to: string };
  columns: { key: PerubahanEkuitasColumnKey; label: string }[];
  rows: PerubahanEkuitasRow[];
  /** Includes the opening-balance adjustment, unlike the columns (ledger only). */
  modalSendiri: { awal: string; akhir: string; penyesuaianSaldoAwal: string };
}

export interface ArusKasRincian {
  label: string;
  amount: string;
}

export interface ArusKasSection {
  rincian: ArusKasRincian[];
  total: string;
}

export interface ArusKas {
  periode: { from: string; to: string };
  saldoKasAwal: string;
  aktivitasOperasi: ArusKasSection;
  aktivitasInvestasi: ArusKasSection;
  aktivitasPendanaan: ArusKasSection;
  kenaikanPenurunanKasBersih: string;
  saldoKasAkhir: string;
  saldoKasAkhirAktual: string;
  balanced: boolean;
  catatan?: string;
}

export interface LabaRugiItem {
  accountId: string;
  code: string;
  name: string;
  anggota: string;
  bukanAnggota: string;
  total: string;
  level: number;
  parentId: string | null;
  isHeader: boolean;
  /** Opposite-normal-balance account (e.g. Retur Penjualan): `total` is negative, reducing the section. */
  isContra: boolean;
}

export interface LabaRugiSection {
  items: LabaRugiItem[];
  total: string;
}

export interface LaporanHasilUsaha {
  periode: { from: string; to: string };
  pendapatan: LabaRugiSection;
  beban: LabaRugiSection;
  shuBerjalan: string;
}

export interface ShuAlokasiBucket {
  percent: number;
  total: string;
}

export interface ShuAlokasi {
  jasaSimpanan: ShuAlokasiBucket;
  jasaPinjaman: ShuAlokasiBucket;
  cadangan: ShuAlokasiBucket;
  lainnya: ShuAlokasiBucket;
}

export interface ShuAnggotaRow {
  no: number;
  memberId: string;
  memberCode: string;
  fullName: string;
  avgSavingsBalance: string;
  interestPaid: string;
  jasaSimpanan: string;
  /** Presentational split of jasaSimpanan by the member's own Pokok/SW savings balance. */
  shuPokokWajib: string;
  /** Presentational split of jasaSimpanan by the member's own Sukarela savings balance. */
  shuSukarela: string;
  jasaPinjaman: string;
  totalShu: string;
}

export interface ShuDistribution {
  periode: { from: string; to: string };
  shuBerjalan: string;
  alokasi: ShuAlokasi | null;
  anggota: ShuAnggotaRow[];
  totalDibagikanKeAnggota?: string;
  catatan?: string;
}

export type CalkSection = "UMUM" | "DASAR_PENYUSUNAN" | "KEBIJAKAN_AKUNTANSI" | "INFORMASI_TAMBAHAN";

export interface CalkNarrativeEntry {
  content: string;
  updatedAt: string | null;
}

export interface CalkMutasiItem {
  accountId: string | null;
  code: string | null;
  name: string;
  saldoAwal: string;
  saldoAkhir: string;
  mutasi: string;
}

export interface Calk {
  periode: { from: string; to: string };
  narasi: Record<CalkSection, CalkNarrativeEntry>;
  rincianAset: CalkMutasiItem[];
  rincianKewajiban: CalkMutasiItem[];
  rincianEkuitas: CalkMutasiItem[];
  rincianPendapatan: LabaRugiItem[];
  rincianBeban: LabaRugiItem[];
  shuBerjalan: string;
  permodalan: CalkPermodalan;
}

/** Modal Sendiri as of the period end, and whether it triggers Permenkop UKM 2/2024 Pasal 12. */
export interface CalkPermodalan {
  modalSendiri: string;
  penyesuaianSaldoAwal: string;
  /** Ledger amount per Modal Sendiri class; classes with no balance are left out. */
  komposisi: { equityClass: EquityClass; amount: string }[];
  ambangAudit: string;
  wajibAudit: boolean;
}

export interface UpsertCalkNarrativeRequest {
  section: CalkSection;
  content: string;
}

export const CALK_SECTION_LABEL: Record<CalkSection, string> = {
  UMUM: "Umum",
  DASAR_PENYUSUNAN: "Dasar Penyusunan Laporan Keuangan",
  KEBIJAKAN_AKUNTANSI: "Ikhtisar Kebijakan Akuntansi",
  INFORMASI_TAMBAHAN: "Informasi Tambahan"
};

export interface ShuDistributionConfig {
  jasaSimpananPercent: string;
  jasaPinjamanPercent: string;
  cadanganPercent: string;
  lainnyaPercent: string;
  updatedAt: string;
}

export interface UpsertShuDistributionConfigRequest {
  jasaSimpananPercent: number;
  jasaPinjamanPercent: number;
  cadanganPercent: number;
  lainnyaPercent: number;
}

// ── Koperasi pasar plan F7 — Laporan ──────────────────────────────────────────

export interface RekapHarianKolektorRow {
  collectorId: string;
  collectorName: string;
  /** Sum of what's due today across this kolektor's binaan (loan installments + open charges) — null for a past date, not reconstructible after the fact. */
  target: string | null;
  /** Today's CollectionBatch.expectedTotal — what the kolektor recorded as collected in the field. */
  tertagih: string;
  /** CollectionBatch.receivedTotal — what was actually counted in at verification; null until then. */
  disetor: string | null;
  /** disetor − tertagih (CollectionBatch.variance); null until verified. */
  selisih: string | null;
  status: "TIDAK_ADA_SETORAN" | "OPEN" | "SUBMITTED" | "VERIFIED";
}

export interface RekapHarianKolektor {
  date: string;
  rows: RekapHarianKolektorRow[];
}

export interface RekapHarianKolektorQuery {
  /** `YYYY-MM-DD`; defaults to today. `target` is only ever computed for today. */
  date?: string;
}

export interface TunggakanAngsuranRow {
  loanId: string;
  memberId: string;
  memberName: string;
  collectorId: string | null;
  collectorName: string | null;
  marketName: string | null;
  block: string | null;
  stallCode: string | null;
  installmentSeq: number;
  dueDate: string;
  amountDue: string;
  daysOverdue: number;
}

export interface TunggakanAngsuranQuery {
  collectorId?: string;
  marketId?: string;
  block?: string;
}

export interface TunggakanSewaRetribusiRow {
  chargeId: string;
  memberId: string;
  memberName: string;
  marketName: string;
  block: string | null;
  stallCode: string;
  kind: "SEWA" | "RETRIBUSI";
  dueDate: string;
  amountDue: string;
  daysOverdue: number;
}

export interface TunggakanSewaRetribusiQuery {
  marketId?: string;
  block?: string;
  memberId?: string;
}

// ── Accounting books: Jurnal Umum / Penyesuaian, Neraca Saldo, Buku Besar ─────

/** unitId value for the tenant-level "unallocated" bucket (entries that belong to no single unit). */
export const UNALLOCATED_UNIT = "unallocated";

/** A record with its own detail page that a ledger line came from. Other sources (manual entries, Toko sales) have none. */
export interface SourceRef {
  kind: "LOAN" | "SAVING";
  id: string;
}

export interface JurnalLineRow {
  lineId: string;
  entryId: string;
  entryNo: number | null;
  /** YYYY-MM-DD, Asia/Jakarta business date. */
  entryDate: string;
  description: string;
  entryType: "UMUM" | "PENYESUAIAN" | "PENUTUP";
  sourceType: string;
  sourceId: string | null;
  sourceRef: SourceRef | null;
  unitId: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

/** Jurnal Umum and Jurnal Penyesuaian share this shape; rows are one page, totals cover the whole filter. */
export interface JurnalReport {
  periode: { from: string; to: string };
  rows: JurnalLineRow[];
  totalDebit: string;
  totalCredit: string;
  /** Σ debit = Σ credit over the whole filtered range. */
  balanced: boolean;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  category: "ASET" | "KEWAJIBAN" | "EKUITAS" | "PENDAPATAN" | "BEBAN";
  normalBalance: "DEBIT" | "KREDIT";
  level: number;
  parentId: string | null;
  isHeader: boolean;
  isContra: boolean;
  /** Balance before the period, signed by the account's normal side (negative = abnormal). */
  saldoAwal: string;
  mutasiDebit: string;
  mutasiKredit: string;
  /** saldoAwal + movement on the normal side. */
  saldoAkhir: string;
}

export interface TrialBalance {
  periode: { from: string; to: string };
  rows: TrialBalanceRow[];
  /**
   * Totals over posting accounts only (headers roll up their children and would double count).
   * Closing balances are split by normal side: they must match for a balanced ledger.
   */
  totals: { mutasiDebit: string; mutasiKredit: string; saldoAkhirDebit: string; saldoAkhirKredit: string };
  balanced: boolean;
}

export interface BukuBesarLine {
  lineId: string;
  entryId: string;
  entryNo: number | null;
  entryDate: string;
  description: string;
  entryType: "UMUM" | "PENYESUAIAN" | "PENUTUP";
  sourceType: string;
  sourceId: string | null;
  sourceRef: SourceRef | null;
  debit: string;
  credit: string;
  /** Running balance on the account's normal side, after this line. */
  saldo: string;
}

export interface BukuBesarAccount {
  periode: { from: string; to: string };
  account: { id: string; code: string; name: string; normalBalance: "DEBIT" | "KREDIT" };
  saldoAwal: string;
  lines: BukuBesarLine[];
  totalDebit: string;
  totalCredit: string;
  saldoAkhir: string;
}
