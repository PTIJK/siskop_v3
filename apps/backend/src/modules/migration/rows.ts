import { Prisma } from "@prisma/client";
import { z, type ZodTypeAny } from "zod";
import { CooperativeType, type MigrationIssue, type MigrationMode } from "@siskop/types";
import { memberFieldsSchema } from "../members/schema.js";
import { createLoanConfigSchema } from "../loans/schema.js";
import { createSavingConfigSchema } from "../savings/schema.js";
import { slugSchema } from "../tenants/provision.js";
import type { ReadResult, SheetRow } from "./workbook.js";

const MONEY = /^-?\d+(\.\d{1,2})?$/;
const money = z
  .string()
  .regex(MONEY, "Angka dengan maksimal 2 desimal, tanpa 'Rp' atau titik ribuan")
  .transform((v) => new Prisma.Decimal(v));
const moneyOpt = money.optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD");
const yn = z.enum(["YA", "TIDAK"]).transform((v) => v === "YA");
const int = z.coerce.number().int();

export const koperasiRow = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  registrationNo: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  cooperativeType: z.string().min(1).default("KSP"),
  cutoffDate: ymd,
  modalDisetor: moneyOpt,
  adminName: z.string().min(1),
  adminEmail: z.string().email()
});
export const unitRow = z.object({ unitCode: z.string().min(1), type: z.nativeEnum(CooperativeType), name: z.string().min(1) });
export const memberRow = memberFieldsSchema.extend({
  legacyNo: z.string().optional(),
  isPengurus: yn.default("TIDAK"),
  isPengawas: yn.default("TIDAK"),
  commodity: z.string().optional(),
  isActive: yn.default("YA"),
  unitCode: z.string().optional()
});
export const savingProductRow = createSavingConfigSchema.extend({ code: z.string().min(1) });
export const savingBalanceRow = z.object({
  nik: z.string().min(1),
  productCode: z.string().min(1),
  balance: money,
  unitCode: z.string().optional()
});
export const loanProductRow = createLoanConfigSchema.extend({ code: z.string().min(1) });

const loanCommon = {
  loanRef: z.string().min(1),
  nik: z.string().min(1),
  productCode: z.string().min(1),
  remainingPrincipal: money,
  termMonths: int.min(1),
  kolCategory: z.enum(["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"]).default("LANCAR"),
  notes: z.string().optional(),
  unitCode: z.string().optional(),
  installmentAmount: moneyOpt
};
export const loanRowSistem = z.object({
  ...loanCommon,
  principalAmount: money,
  totalAmount: money,
  remainingAmount: money,
  disbursedAt: ymd,
  installmentFrequency: z.enum(["MONTHLY", "WEEKLY", "DAILY"]).default("MONTHLY"),
  installmentCount: int.min(1).optional(),
  rate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "DEFAULTED"]).default("ACTIVE"),
  daysOverdue: int.min(0).default(0)
});
export const loanRowLaporan = z.object({ ...loanCommon, remainingAmount: moneyOpt });
export const scheduleRow = z.object({
  loanRef: z.string().min(1),
  seq: int.min(1),
  dueDate: ymd,
  principalDue: money,
  interestDue: money,
  principalPaid: money.default("0"),
  interestPaid: money.default("0"),
  paidOffAt: ymd.optional()
});
export const trialRowSistem = z.object({ accountCode: z.string().min(1), debit: moneyOpt, credit: moneyOpt, unitCode: z.string().optional() });
export const trialRowLaporan = z.object({
  reportName: z.string().min(1),
  accountCode: z.string().min(1),
  amount: money,
  unitCode: z.string().optional()
});
export const extraAccountRow = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN"]),
  normalBalance: z.enum(["DEBIT", "KREDIT"]),
  parentCode: z.string().optional(),
  isCashEquivalent: yn.default("TIDAK")
});

type WithRow<T> = T & { _row: number };

export interface LoanRow {
  _row: number;
  loanRef: string;
  nik: string;
  productCode: string;
  unitCode?: string;
  principalAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  remainingPrincipal: Prisma.Decimal;
  termMonths: number;
  installmentAmount: Prisma.Decimal | null;
  disbursedAt: string;
  installmentFrequency: "MONTHLY" | "WEEKLY" | "DAILY";
  installmentCount?: number;
  rate?: number;
  status: "ACTIVE" | "COMPLETED" | "DEFAULTED";
  kolCategory: "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET";
  daysOverdue: number;
  notes: string | null;
  /** True when plafon/tanggal cair/total are substitutes derived from a report. */
  estimated: boolean;
}
export type MemberRow = WithRow<z.infer<typeof memberRow>>;
export interface TrialRow {
  _row: number;
  accountCode: string;
  /** SISTEM: raw debit/credit columns. */
  debit?: Prisma.Decimal;
  credit?: Prisma.Decimal;
  /** LAPORAN: signed amount, positive = account's normal balance. */
  amount?: Prisma.Decimal;
  unitCode?: string;
}

export interface ParsedData {
  mode: MigrationMode;
  koperasi: WithRow<z.infer<typeof koperasiRow>>;
  units: WithRow<z.infer<typeof unitRow>>[];
  members: MemberRow[];
  savingProducts: WithRow<z.infer<typeof savingProductRow>>[];
  savings: WithRow<z.infer<typeof savingBalanceRow>>[];
  loanProducts: WithRow<z.infer<typeof loanProductRow>>[];
  loans: LoanRow[];
  schedule: WithRow<z.infer<typeof scheduleRow>>[];
  trial: TrialRow[];
  extraAccounts: WithRow<z.infer<typeof extraAccountRow>>[];
}

function parseSheet<S extends ZodTypeAny>(
  sheet: string,
  rows: SheetRow[] | undefined,
  schema: S,
  issues: MigrationIssue[]
): WithRow<z.output<S>>[] {
  const out: WithRow<z.output<S>>[] = [];
  for (const r of rows ?? []) {
    // Null cells become undefined so zod defaults and optionals apply.
    const clean = Object.fromEntries(Object.entries(r.v).filter(([, x]) => x !== null));
    const res = schema.safeParse(clean);
    if (res.success) out.push({ ...(res.data as object), _row: r.row } as WithRow<z.output<S>>);
    else {
      for (const i of res.error.issues) {
        issues.push({ severity: "error", sheet, row: r.row, column: String(i.path[0] ?? "") || null, message: i.message });
      }
    }
  }
  return out;
}

export function parseRows(read: ReadResult): { data: ParsedData | null; issues: MigrationIssue[] } {
  const issues = [...read.issues];
  if (!read.mode) return { data: null, issues };
  const s = read.sheets;
  const koperasi = parseSheet("1_Koperasi", s["1_Koperasi"], koperasiRow, issues);
  if ((s["1_Koperasi"]?.length ?? 0) > 1) {
    issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: null, message: "Hanya boleh 1 baris data." });
  }
  // Without a valid koperasi row there is no cutoff or tenant to import into.
  if (koperasi.length === 0) return { data: null, issues };
  const cutoff = koperasi[0]!.cutoffDate;

  const loans: LoanRow[] =
    read.mode === "SISTEM"
      ? parseSheet("7_Pinjaman", s["7_Pinjaman"], loanRowSistem, issues).map((l) => ({
          ...l,
          installmentAmount: l.installmentAmount ?? null,
          notes: l.notes ?? null,
          estimated: false
        }))
      : parseSheet("7_Pinjaman", s["7_Pinjaman"], loanRowLaporan, issues).map((l) => {
          const remainingAmount = l.remainingAmount ?? l.remainingPrincipal;
          return {
            ...l,
            principalAmount: remainingAmount,
            totalAmount: remainingAmount,
            remainingAmount,
            disbursedAt: cutoff,
            installmentFrequency: "MONTHLY" as const,
            status: "ACTIVE" as const,
            daysOverdue: 0,
            installmentAmount: l.installmentAmount ?? null,
            notes: ["Migrasi dari laporan RAT: tenor dan tanggal cair estimasi.", l.notes].filter(Boolean).join(" "),
            estimated: true
          };
        });

  const trial: TrialRow[] =
    read.mode === "SISTEM"
      ? parseSheet("9_Saldo_Awal_Jurnal", s["9_Saldo_Awal_Jurnal"], trialRowSistem, issues)
      : parseSheet("9_Neraca", s["9_Neraca"], trialRowLaporan, issues).map((t) => ({
          _row: t._row,
          accountCode: t.accountCode,
          amount: t.amount,
          unitCode: t.unitCode
        }));

  return {
    issues,
    data: {
      mode: read.mode,
      koperasi: koperasi[0]!,
      units: parseSheet("2_Unit", s["2_Unit"], unitRow, issues),
      members: parseSheet("3_Anggota", s["3_Anggota"], memberRow, issues),
      savingProducts: parseSheet("4_Produk_Simpanan", s["4_Produk_Simpanan"], savingProductRow, issues),
      savings: parseSheet("5_Saldo_Simpanan", s["5_Saldo_Simpanan"], savingBalanceRow, issues),
      loanProducts: parseSheet("6_Produk_Pinjaman", s["6_Produk_Pinjaman"], loanProductRow, issues),
      loans,
      schedule: read.mode === "SISTEM" ? parseSheet("8_Jadwal_Angsuran", s["8_Jadwal_Angsuran"], scheduleRow, issues) : [],
      trial,
      extraAccounts: parseSheet("10_Akun_Tambahan", s["10_Akun_Tambahan"], extraAccountRow, issues)
    }
  };
}
