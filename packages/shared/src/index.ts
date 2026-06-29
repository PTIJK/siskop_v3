// ── Enums ────────────────────────────────────────────────────────────────────
// Mirror Prisma enums so the shared package has no dependency on @prisma/client

export enum TenantType {
  SYARIAH = 'SYARIAH',
  KONVENSIONAL = 'KONVENSIONAL',
}

export enum SavingType {
  POKOK = 'POKOK',
  WAJIB = 'WAJIB',
  SUKARELA = 'SUKARELA',
}

export enum RateType {
  BUNGA = 'BUNGA',
  BAGI_HASIL = 'BAGI_HASIL',
  MARGIN = 'MARGIN',
}

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

export enum LoanType {
  SYARIAH = 'SYARIAH',
  KONVENSIONAL = 'KONVENSIONAL',
}

export enum LoanStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  DEFAULTED = 'DEFAULTED',
}

export enum KOLCategory {
  LANCAR = 'LANCAR',
  DALAM_PERHATIAN = 'DALAM_PERHATIAN',
  KURANG_LANCAR = 'KURANG_LANCAR',
  DIRAGUKAN = 'DIRAGUKAN',
  MACET = 'MACET',
}

// ── Permission Types ─────────────────────────────────────────────────────────

export interface Permissions {
  dashboard: { read: boolean };
  members: { create: boolean; read: boolean; update: boolean; delete: boolean };
  savings: { create: boolean; read: boolean; update: boolean; delete: boolean };
  loans: { create: boolean; read: boolean; update: boolean; delete: boolean };
  reports: { read: boolean; export: boolean };
  config: { read: boolean; update: boolean };
  users: { create: boolean; read: boolean; update: boolean; delete: boolean };
  roles: { create: boolean; read: boolean; update: boolean; delete: boolean };
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatRupiah(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatTanggalIndonesia(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

// ── API response shape (for frontend consumption) ────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
