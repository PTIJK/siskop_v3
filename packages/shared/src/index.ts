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

export enum DomainStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
}

export enum AccountCategory {
  ASET = 'ASET',
  KEWAJIBAN = 'KEWAJIBAN',
  EKUITAS = 'EKUITAS',
  PENDAPATAN = 'PENDAPATAN',
  BEBAN = 'BEBAN',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  KREDIT = 'KREDIT',
}

export enum MappingSourceType {
  SAVING_CONFIG = 'SAVING_CONFIG',
  LOAN_CONFIG = 'LOAN_CONFIG',
  SYSTEM = 'SYSTEM',
}

export enum MappingTransactionKind {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  DISBURSEMENT = 'DISBURSEMENT',
  PAYMENT_PRINCIPAL = 'PAYMENT_PRINCIPAL',
  PAYMENT_INTEREST = 'PAYMENT_INTEREST',
  PAYMENT_PENALTY = 'PAYMENT_PENALTY',
}

// ── Permission Types ─────────────────────────────────────────────────────────

export interface Permissions {
  dashboard: { read: boolean };
  members: { create: boolean; read: boolean; update: boolean; delete: boolean };
  savings: { create: boolean; read: boolean; update: boolean; delete: boolean };
  loans: { create: boolean; read: boolean; update: boolean; delete: boolean };
  reports: { read: boolean; export: boolean; update: boolean };
  config: { read: boolean; update: boolean };
  users: { create: boolean; read: boolean; update: boolean; delete: boolean };
  roles: { create: boolean; read: boolean; update: boolean; delete: boolean };
  accounting?: { create: boolean; read: boolean; update: boolean; delete: boolean };
}

// ── Auth / User Types ────────────────────────────────────────────────────────

export interface AuthRole {
  id: string;
  name: string;
  permissions: Permissions;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  tenantId: string;
  roleId: string;
  role: AuthRole;
  isPlatformAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPackage {
  id: string;
  name: string;
  price: string;
  modules: string[];
  maxUsers: number;
  maxMembers: number;
  maxSavingConfigs: number | null;
  whitelabelEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  address: string;
  registrationNo: string;
  type: TenantType;
  cooperativeType: string;
  isActive: boolean;
  logoUrl?: string | null;
  packageId?: string | null;
  package?: SubscriptionPackage | null;
  nextBillingDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavingConfig {
  id: string;
  tenantId: string;
  name: string;
  type: SavingType;
  rateType: RateType;
  rate: string;
  periodUnit: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface WhitelabelConfig {
  id: string;
  tenantId: string;
  customDomain?: string | null;
  domainStatus: DomainStatus;
  primaryColor?: string | null;
  hideBranding: boolean;
  emailSenderName?: string | null;
  emailSenderAddress?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Account {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  parentId?: string | null;
  isHeader: boolean;
  isDefault: boolean;
  isActive: boolean;
  isCashEquivalent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountMapping {
  id: string;
  tenantId: string;
  sourceType: MappingSourceType;
  sourceId?: string | null;
  transactionKind: MappingTransactionKind;
  debitAccountId: string;
  debitAccount?: Account;
  creditAccountId: string;
  creditAccount?: Account;
  createdAt: string;
  updatedAt: string;
}

// ── Loan Calculation ─────────────────────────────────────────────────────────

export interface LoanCalculation {
  monthlyPayment: number;
  totalAmount: number;
  totalInterest: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hitungAngsuranKonvensional(
  principal: number,
  annualRate: number,
  termMonths: number
): LoanCalculation {
  if (annualRate === 0) {
    return {
      monthlyPayment: round2(principal / termMonths),
      totalAmount: principal,
      totalInterest: 0,
    };
  }
  const monthlyRate = annualRate / 12 / 100;
  const monthlyPayment =
    (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));
  const totalAmount = monthlyPayment * termMonths;
  return {
    monthlyPayment: round2(monthlyPayment),
    totalAmount: round2(totalAmount),
    totalInterest: round2(totalAmount - principal),
  };
}

export function hitungAngsuranSyariah(
  principal: number,
  annualRate: number,
  termMonths: number
): LoanCalculation {
  const totalInterest = principal * (annualRate / 100) * (termMonths / 12);
  const totalAmount = principal + totalInterest;
  const monthlyPayment = totalAmount / termMonths;
  return {
    monthlyPayment: round2(monthlyPayment),
    totalAmount: round2(totalAmount),
    totalInterest: round2(totalInterest),
  };
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

export function formatTanggalPendek(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatRupiahSingkat(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return 'Rp 0';
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(1)}M`;
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(1)}jt`;
  if (num >= 1_000) return `Rp ${(num / 1_000).toFixed(0)}rb`;
  return formatRupiah(num);
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
