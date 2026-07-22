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

export type CalkSection = 'UMUM' | 'DASAR_PENYUSUNAN' | 'KEBIJAKAN_AKUNTANSI' | 'INFORMASI_TAMBAHAN';

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

export const CALK_SECTION_LABEL: Record<CalkSection, string> = {
  UMUM: 'Umum',
  DASAR_PENYUSUNAN: 'Dasar Penyusunan Laporan Keuangan',
  KEBIJAKAN_AKUNTANSI: 'Ikhtisar Kebijakan Akuntansi',
  INFORMASI_TAMBAHAN: 'Informasi Tambahan',
};

export function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message ?? fallback;
}

export function defaultPeriodFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function defaultPeriodTo(): string {
  return new Date().toISOString().split('T')[0];
}
