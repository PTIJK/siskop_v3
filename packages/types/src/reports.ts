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
  memberId: string;
  memberCode: string;
  fullName: string;
  avgSavingsBalance: string;
  interestPaid: string;
  jasaSimpanan: string;
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
